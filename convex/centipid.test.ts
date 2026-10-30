/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const token = "test-centipid-token-which-is-long-enough-for-the-http-route";

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function setupWorkspace() {
  const t = convexTest(schema, modules);
  const tokenHash = await sha256(token);
  await t.run(async ctx => {
    const ownerId = await ctx.db.insert("users", { name: "Test owner" });
    const businessId = await ctx.db.insert("businesses", {
      name: "Webhook test workspace",
      currency: "UGX",
      timezone: "Africa/Kampala",
      createdBy: ownerId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("centipidIntegrations", {
      businessId,
      tokenHash,
      active: true,
      createdBy: ownerId,
      createdAt: Date.now(),
    });
  });
  return t;
}

async function deliver(t: ReturnType<typeof convexTest>, event: string, data: Record<string, unknown>) {
  const response = await t.fetch(`/centipid?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, data }),
  });
  return response.json() as Promise<{ status: string; routed?: string }>;
}

describe("Centipid webhook event idempotency", () => {
  it("records payment and voucher sales that share a reference, but deduplicates each event retry", async () => {
    const t = await setupWorkspace();

    expect(await deliver(t, "payment.received", { amount: 1000, transaction_id: "shared-ref" }))
      .toMatchObject({ status: "success", routed: "payment" });
    expect(await deliver(t, "voutcher.redeemed", { amount: 2000, transaction_id: "shared-ref", voucher_code: "V-1" }))
      .toMatchObject({ status: "success", routed: "voucher" });
    expect(await deliver(t, "voucher.redeemed", { amount: 2000, transaction_id: "shared-ref", voucher_code: "V-1" }))
      .toMatchObject({ status: "duplicate" });

    const snapshot = await t.run(async ctx => ({
      entries: await ctx.db.query("entries").collect(),
      balances: await ctx.db.query("accountBalances").collect(),
      days: await ctx.db.query("dailyTotals").collect(),
      audits: await ctx.db.query("auditEvents").collect(),
    }));
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries.map(entry => [entry.kind, entry.account, entry.amountUgx]).sort()).toEqual([
      ["sale", "cash", 2000],
      ["sale", "mobile_money", 1000],
    ]);
    expect(snapshot.balances.map(balance => [balance.account, balance.balanceUgx]).sort()).toEqual([
      ["cash", 2000],
      ["mobile_money", 1000],
    ]);
    expect(snapshot.days).toHaveLength(1);
    expect(snapshot.days[0]).toMatchObject({ salesUgx: 3000, saleCount: 2, expensesUgx: 0 });
    expect(snapshot.audits.filter(event => event.action === "webhook.entry_created")).toHaveLength(2);
  });

  it("recognizes old payment receipts and does not post their sale a second time", async () => {
    const t = await setupWorkspace();
    const reference = "legacy-payment-ref";
    const legacyEventKey = await sha256(`sale:${reference}`);

    await t.run(async ctx => {
      const owner = await ctx.db.query("users").first();
      const business = await ctx.db.query("businesses").first();
      if (!owner || !business) throw new Error("Test workspace was not seeded.");
      const entryId = await ctx.db.insert("entries", {
        businessId: business._id,
        kind: "sale",
        amountUgx: 1500,
        occurredOn: "2026-10-28",
        account: "mobile_money",
        category: "Centipid hotspot sales",
        note: "Previously delivered payment",
        source: "webhook",
        idempotencyKey: `centipid:${legacyEventKey}`,
        state: "posted",
        createdBy: owner._id,
        createdAt: Date.now(),
      });
      await ctx.db.insert("accountBalances", { businessId: business._id, account: "mobile_money", balanceUgx: 1500, updatedAt: Date.now() });
      await ctx.db.insert("dailyTotals", { businessId: business._id, day: "2026-10-28", salesUgx: 1500, expensesUgx: 0, saleCount: 1, expenseCount: 0 });
      await ctx.db.insert("webhookReceipts", {
        businessId: business._id,
        eventKey: legacyEventKey,
        event: "payment.received",
        status: "success",
        routed: "payment",
        entryId,
        createdAt: Date.now(),
      });
    });

    expect(await deliver(t, "payment.received", { amount: 1500, transaction_id: reference }))
      .toMatchObject({ status: "duplicate" });
    const snapshot = await t.run(async ctx => ({
      entries: await ctx.db.query("entries").collect(),
      balance: await ctx.db.query("accountBalances").first(),
      day: await ctx.db.query("dailyTotals").first(),
    }));
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.balance?.balanceUgx).toBe(1500);
    expect(snapshot.day).toMatchObject({ salesUgx: 1500, saleCount: 1 });
  });

  it("uses distinct body hashes for events without references and deduplicates identical retries", async () => {
    const t = await setupWorkspace();
    const first = { amount: 700, customer: "Customer A" };
    const second = { amount: 900, customer: "Customer B" };

    expect(await deliver(t, "payment.received", first)).toMatchObject({ status: "success" });
    expect(await deliver(t, "payment.received", first)).toMatchObject({ status: "duplicate" });
    expect(await deliver(t, "payment.received", second)).toMatchObject({ status: "success" });

    const snapshot = await t.run(async ctx => ({
      entries: await ctx.db.query("entries").collect(),
      balance: await ctx.db.query("accountBalances").first(),
      day: await ctx.db.query("dailyTotals").first(),
    }));
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.balance?.balanceUgx).toBe(1600);
    expect(snapshot.day).toMatchObject({ salesUgx: 1600, saleCount: 2 });
  });
});
