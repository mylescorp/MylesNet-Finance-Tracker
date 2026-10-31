/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("workspace onboarding checklist", () => {
  it("requires both account balances to be verified and treats imports as optional", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Workspace owner" });
      const businessId = await ctx.db.insert("businesses", { name: "Starter workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt: Date.now() });
      return { userId, businessId };
    });
    const owner = t.withIdentity({ subject: userId });
    const first = await owner.query(api.onboarding.checklist, {});
    if (first.access !== "ready") throw new Error("Expected checklist access.");
    expect(first.tasks.find(task => task.id === "balances")?.state).toBe("action");
    expect(first.tasks.find(task => task.id === "closeout")?.state).toBe("action");
    expect(first.tasks.find(task => task.id === "imports")?.state).toBe("recommended");
    await t.run(async ctx => {
      await ctx.db.insert("reconciliations", { businessId, account: "cash", asOfDate: "2026-10-31", bookBalanceUgx: 0, countedBalanceUgx: 0, varianceUgx: 0, status: "matched", note: "Verified starting balance", idempotencyKey: "onboarding-reconciliation-check-1", createdBy: userId, createdAt: Date.now() });
    });
    const afterReconciliation = await owner.query(api.onboarding.checklist, {});
    if (afterReconciliation.access !== "ready") throw new Error("Expected checklist access after reconciliation.");
    expect(afterReconciliation.tasks.find(task => task.id === "balances")?.state).toBe("action");
    expect(afterReconciliation.tasks.find(task => task.id === "closeout")?.state).toBe("action");
    await t.run(async ctx => {
      await ctx.db.insert("reconciliations", { businessId, account: "mobile_money", asOfDate: "2026-10-31", bookBalanceUgx: 0, countedBalanceUgx: 0, varianceUgx: 0, status: "matched", note: "Verified starting balance", idempotencyKey: "onboarding-mobile-reconciliation-check-1", createdBy: userId, createdAt: Date.now() });
    });
    const bothAccountsReconciled = await owner.query(api.onboarding.checklist, {});
    if (bothAccountsReconciled.access !== "ready") throw new Error("Expected checklist access after both account reconciliations.");
    expect(bothAccountsReconciled.tasks.find(task => task.id === "balances")?.state).toBe("done");
    expect(bothAccountsReconciled.tasks.find(task => task.id === "closeout")?.state).toBe("done");
    await t.run(async ctx => {
      const cash = await ctx.db.query("reconciliations").withIndex("by_business_and_account_and_date", q => q.eq("businessId", businessId).eq("account", "cash")).unique();
      if (!cash) throw new Error("Expected a saved cash count.");
      await ctx.db.patch("reconciliations", cash._id, { status: "closed", reviewedBy: userId, reviewedByName: "Workspace owner", reviewedAt: Date.now(), reviewNote: "Matched count reviewed." });
    });
    const signedOff = await owner.query(api.onboarding.checklist, {});
    if (signedOff.access !== "ready") throw new Error("Expected checklist access after sign-off.");
    expect(signedOff.tasks.find(task => task.id === "balances")?.state).toBe("done");
    expect(signedOff.tasks.find(task => task.id === "closeout")?.state).toBe("done");
    await t.run(async ctx => {
      await ctx.db.insert("reconciliations", { businessId, account: "cash", asOfDate: "2026-11-01", bookBalanceUgx: 100, countedBalanceUgx: 0, varianceUgx: -100, status: "open", note: "New difference needs review", idempotencyKey: "onboarding-cash-new-open-check-1", createdBy: userId, createdAt: Date.now() });
    });
    const reopenedState = await owner.query(api.onboarding.checklist, {});
    if (reopenedState.access !== "ready") throw new Error("Expected checklist access after new reconciliation.");
    expect(reopenedState.tasks.find(task => task.id === "balances")?.state).toBe("action");
  });

  it("does not expose onboarding records without a signed-in workspace member", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.onboarding.checklist, {})).toEqual({ access: "restricted" });
  });
});
