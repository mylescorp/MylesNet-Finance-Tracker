/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("workspace currency safety", () => {
  it("locks currency changes when saved category budgets exist", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Budget owner" });
      const createdAt = Date.now();
      const businessId = await ctx.db.insert("businesses", { name: "Budget workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt });
      await ctx.db.insert("workspacePreferences", { businessId, expenseCategories: ["Supplies"], updatedBy: userId, updatedAt: createdAt });
      await ctx.db.insert("categoryBudgets", { businessId, category: "Supplies", monthlyBudgetUgx: 100_000, warningAtPercent: 80, active: true, createdBy: userId, createdAt, updatedBy: userId, updatedAt: createdAt });
      return { userId, businessId };
    });
    const owner = t.withIdentity({ subject: userId });
    await expect(owner.mutation(api.settings.update, {
      expectedSettingsUpdatedAt: await t.run(async ctx => (await ctx.db.query("businesses").first())!.createdAt),
      businessName: "Budget workspace", countryCode: "UG", currency: "USD", timezone: "Africa/Kampala", weekStartsOn: "monday", locale: "en-UG", dateFormat: "DD/MM/YYYY", fiscalYearStartMonth: 1,
      incomeCategories: ["Sales"], expenseCategories: ["Supplies"], highExpenseReviewUgx: 500_000, weakDaySalesUgx: 50_000, monthlySalesTargetUgx: 0, monthlyExpenseWarningUgx: 0, lowCashAlertUgx: 100_000, duplicateWindowDays: 1, requireEntryNote: false, negativeBalanceWarning: true, cashOpeningBalance: 0, mobileOpeningBalance: 0,
    })).rejects.toThrow("Currency is locked after financial activity");
    expect(await t.run(async ctx => (await ctx.db.get("businesses", businessId))?.currency)).toBe("UGX");
  });
});
