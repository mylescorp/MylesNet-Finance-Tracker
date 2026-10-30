/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupOwner() {
  const t = convexTest(schema, modules);
  const { userId, businessId } = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Budget owner" });
    const businessId = await ctx.db.insert("businesses", {
      name: "Category budget test workspace",
      currency: "UGX",
      timezone: "Africa/Kampala",
      createdBy: userId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt: Date.now() });
    await ctx.db.insert("workspacePreferences", { businessId, expenseCategories: ["Supplies", "Rent"], updatedBy: userId, updatedAt: Date.now() });
    for (const [kind, category, amountUgx, account, state, idempotencyKey] of [
      ["expense", "Supplies", 6000, "cash", "posted", "budget-test-cash"],
      ["expense", "Supplies", 4000, "mobile_money", "posted", "budget-test-mobile"],
      ["expense", "Supplies", 5000, "cash", "void", "budget-test-void"],
      ["expense", "Rent", 2000, "cash", "posted", "budget-test-rent"],
    ] as const) {
      await ctx.db.insert("entries", { businessId, kind, category, amountUgx, account, occurredOn: "2026-01-15", note: "Test expense", source: "manual", state, idempotencyKey, createdBy: userId, createdAt: Date.now() });
    }
    return { userId, businessId };
  });
  return { t, owner: t.withIdentity({ subject: userId }), businessId };
}

describe("category budget authorization and comparisons", () => {
  it("calculates posted expense actuals, applies category warning thresholds, and audits changes", async () => {
    const { t, owner, businessId } = await setupOwner();
    await owner.mutation(api.categoryBudgets.save, { category: "supplies", monthlyBudgetUgx: 10000, warningAtPercent: 80, active: true });
    const comparison = await owner.query(api.categoryBudgets.overview, { from: "2026-01-01", toExclusive: "2026-02-01" });
    const supplies = comparison.access === "ready" ? comparison.categories.find(row => row.category === "Supplies") : undefined;
    const rent = comparison.access === "ready" ? comparison.categories.find(row => row.category === "Rent") : undefined;
    expect(supplies).toMatchObject({ configured: true, monthlyBudgetUgx: 10000, warningAtPercent: 80, actualUgx: 10000, utilizationPercent: 100, status: "threshold_reached" });
    expect(rent).toMatchObject({ actualUgx: 2000, monthlyBudgetUgx: null, status: "not_set" });
    const cashOnly = await owner.query(api.categoryBudgets.overview, { from: "2026-01-01", toExclusive: "2026-02-01", account: "cash" });
    expect(cashOnly.access === "ready" && cashOnly.categories.find(row => row.category === "Supplies")?.actualUgx).toBe(6000);
    const audit = await t.run(async ctx => ctx.db.query("auditEvents").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "category_budget.created", summary: "Set Supplies monthly budget." });
    expect(audit[0].details).toContain("10000");
    expect(businessId).toBeTruthy();
  });

  it("marks multi-month ranges incomplete rather than presenting unqueried actuals as zero", async () => {
    const { owner } = await setupOwner();
    await owner.mutation(api.categoryBudgets.save, { category: "Supplies", monthlyBudgetUgx: 10000, warningAtPercent: 80, active: true });
    const comparison = await owner.query(api.categoryBudgets.overview, { from: "2026-01-31", toExclusive: "2026-02-02" });
    expect(comparison.access).toBe("ready");
    if (comparison.access === "ready") {
      expect(comparison.singleMonth).toBe(false);
      expect(comparison.complete).toBe(false);
      expect(comparison.categories.find(row => row.category === "Supplies")?.status).toBe("incomplete");
    }
  });

  it("archives budgets without deleting their audit history", async () => {
    const { t, owner } = await setupOwner();
    await owner.mutation(api.categoryBudgets.save, { category: "Supplies", monthlyBudgetUgx: 10000, warningAtPercent: 80, active: true });
    await owner.mutation(api.categoryBudgets.save, { category: "Supplies", monthlyBudgetUgx: 10000, warningAtPercent: 80, active: false });
    const comparison = await owner.query(api.categoryBudgets.overview, { from: "2026-01-01", toExclusive: "2026-02-01" });
    expect(comparison.access === "ready" && comparison.categories.find(row => row.category === "Supplies")).toMatchObject({ monthlyBudgetUgx: null, status: "not_set" });
    const audit = await t.run(async ctx => ctx.db.query("auditEvents").collect());
    expect(audit.map(row => row.action)).toEqual(["category_budget.created", "category_budget.archived"]);
    const records = await t.run(async ctx => ctx.db.query("categoryBudgets").collect());
    expect(records).toHaveLength(1);
    expect(records[0].active).toBe(false);
  });

  it("denies budget writes to a user without workspace settings permission", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Read-only user" });
      const businessId = await ctx.db.insert("businesses", { name: "Restricted workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
      await ctx.db.insert("memberships", { businessId, userId, role: "member", active: true, createdAt: Date.now() });
      return { userId, businessId };
    });
    const member = t.withIdentity({ subject: userId });
    const overview = await member.query(api.categoryBudgets.overview, { from: "2026-01-01", toExclusive: "2026-02-01" });
    expect(overview).toEqual({ access: "restricted" });
    await expect(member.mutation(api.categoryBudgets.save, { category: "Supplies", monthlyBudgetUgx: 10000, warningAtPercent: 80, active: true }))
      .rejects.toThrow("Your role cannot manage category budgets.");
    expect(await t.run(async ctx => ctx.db.query("categoryBudgets").collect())).toHaveLength(0);
    expect(businessId).toBeTruthy();
  });
});
