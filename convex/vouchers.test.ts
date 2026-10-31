/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("voucher batches", () => {
  it("tracks audited, idempotent redemption and void quantities without ledger entries", async () => {
    const t = convexTest(schema, modules);
    const { userId, deniedUserId, businessId, foreignBusinessId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Voucher manager" });
      const createdAt = Date.now();
      const businessId = await ctx.db.insert("businesses", { name: "Voucher workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt });
      const deniedUserId = await ctx.db.insert("users", { name: "No integration permission" });
      await ctx.db.insert("memberships", { businessId, userId: deniedUserId, role: "member", active: true, createdAt });
      const foreignUserId = await ctx.db.insert("users", { name: "Other workspace owner" });
      const foreignBusinessId = await ctx.db.insert("businesses", { name: "Other", currency: "UGX", timezone: "Africa/Kampala", createdBy: foreignUserId, createdAt });
      await ctx.db.insert("memberships", { businessId: foreignBusinessId, userId: foreignUserId, role: "owner", active: true, createdAt });
      return { userId, deniedUserId, businessId, foreignBusinessId };
    });
    const owner = t.withIdentity({ subject: userId });
    const batchId = await owner.mutation(api.vouchers.createBatch, { businessId, name: "Holiday vouchers", description: "", faceValueUgx: 5_000, issuedQuantity: 12, expiresOn: null });
    await expect(owner.mutation(api.vouchers.recordEvent, { businessId, batchId, eventType: "redemption", sourceReference: "sale-100", quantity: 3, reason: "Counter sale" })).resolves.toEqual({ duplicate: false });
    await expect(owner.mutation(api.vouchers.recordEvent, { businessId, batchId, eventType: "redemption", sourceReference: "sale-100", quantity: 3, reason: "Retry" })).resolves.toEqual({ duplicate: true });
    await owner.mutation(api.vouchers.recordEvent, { businessId, batchId, eventType: "void_stock", sourceReference: "void-1", quantity: 2, reason: "Damaged vouchers" });
    const rows = await owner.query(api.vouchers.list, { businessId });
    expect(rows[0]).toMatchObject({ _id: batchId, issuedQuantity: 12, redeemedQuantity: 3, voidedQuantity: 2 });
    await expect(owner.mutation(api.vouchers.recordEvent, { businessId, batchId, eventType: "redemption", sourceReference: "sale-101", quantity: 8, reason: "Over available quantity" })).rejects.toThrow("not have enough");
    await expect(t.withIdentity({ subject: deniedUserId }).query(api.vouchers.list, { businessId })).rejects.toThrow();
    await expect(owner.query(api.vouchers.list, { businessId: foreignBusinessId })).rejects.toThrow();
    const counts = await t.run(async ctx => ({ events: await ctx.db.query("voucherEvents").collect(), entries: await ctx.db.query("entries").collect(), audits: await ctx.db.query("auditEvents").collect() }));
    expect(counts.events).toHaveLength(2);
    expect(counts.entries).toHaveLength(0);
    expect(counts.audits.filter(a => a.action.startsWith("voucher."))).toHaveLength(3);
  });

  it("rejects fractional amounts and quantities", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Owner" });
      const createdAt = Date.now();
      const businessId = await ctx.db.insert("businesses", { name: "UGX", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt });
      return { userId, businessId };
    });
    await expect(t.withIdentity({ subject: userId }).mutation(api.vouchers.createBatch, { businessId, name: "Bad", description: "", faceValueUgx: 1.5, issuedQuantity: 2, expiresOn: null })).rejects.toThrow("whole number");
  });
});
