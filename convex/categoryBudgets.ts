import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hasPermission } from "./accessControl";
import { getSelectedWorkspace } from "./workspaceContext";

type Ctx = QueryCtx | MutationCtx;
const accountV = v.union(v.literal("cash"), v.literal("mobile_money"), v.literal("unallocated"));
const defaultExpenseCategories = ["Transport", "Supplies", "Utilities", "Rent", "Equipment", "Other expense"];

function safeAdd(a: number, b: number) {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw new Error("Category expense total exceeds the supported amount range.");
  return total;
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function inOneCalendarMonth(from: string, toExclusive: string) {
  const lastDay = new Date(Date.parse(`${toExclusive}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 7);
  return from.slice(0, 7) === lastDay;
}

async function readableWorkspace(ctx: Ctx) {
  const current = await getSelectedWorkspace(ctx);
  if (!current) return null;
  // Budget actuals are derived from expense records. Settings access alone must not
  // expose financial totals; management permissions remain enforced by save().
  const canView = await hasPermission(ctx, current.membership, "expenses.view");
  return canView ? current : null;
}

export const overview = query({
  args: { from: v.string(), toExclusive: v.string(), account: v.optional(accountV) },
  returns: v.union(
    v.object({ access: v.literal("restricted") }),
    v.object({
      access: v.literal("ready"), businessId: v.id("businesses"), canManage: v.boolean(), from: v.string(), toExclusive: v.string(), singleMonth: v.boolean(), complete: v.boolean(),
      categories: v.array(v.object({ category: v.string(), configured: v.boolean(), monthlyBudgetUgx: v.union(v.number(), v.null()), warningAtPercent: v.union(v.number(), v.null()), actualUgx: v.number(), utilizationPercent: v.union(v.number(), v.null()), status: v.union(v.literal("not_set"), v.literal("below_warning"), v.literal("threshold_reached"), v.literal("incomplete")) })),
    }),
  ),
  handler: async (ctx, args) => {
    if (!validDay(args.from) || !validDay(args.toExclusive) || args.from >= args.toExclusive) throw new Error("Choose a valid reporting date range.");
    const current = await readableWorkspace(ctx);
    if (!current) return { access: "restricted" as const };
    const canManage = await hasPermission(ctx, current.membership, "settings.update");
    const singleMonth = inOneCalendarMonth(args.from, args.toExclusive);
    const [preferences, budgets, expenseRows] = await Promise.all([
      ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique(),
      ctx.db.query("categoryBudgets").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(500),
      !singleMonth
        ? Promise.resolve([])
        : args.account
          ? ctx.db.query("entries").withIndex("by_business_and_kind_and_account_and_date", q => q.eq("businessId", current.business._id).eq("kind", "expense").eq("account", args.account!).gte("occurredOn", args.from).lt("occurredOn", args.toExclusive)).take(5001)
          : ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", current.business._id).eq("kind", "expense").gte("occurredOn", args.from).lt("occurredOn", args.toExclusive)).take(5001),
    ]);
    const complete = singleMonth && expenseRows.length <= 5000;
    const configuredCategories = preferences?.expenseCategories ?? defaultExpenseCategories;
    const postedExpenseRows = expenseRows.slice(0, 5000).filter(row => row.state === "posted");
    const categoryNames: string[] = [];
    const categoryByKey = new Map<string, string>();
    for (const category of [...configuredCategories, ...budgets.map(row => row.category), ...postedExpenseRows.map(row => row.category)]) {
      const key = category.toLowerCase();
      if (!categoryByKey.has(key)) {
        categoryByKey.set(key, category);
        categoryNames.push(category);
      }
    }
    const actuals = new Map<string, number>();
    for (const row of postedExpenseRows) {
      const category = categoryByKey.get(row.category.toLowerCase()) ?? row.category;
      actuals.set(category, safeAdd(actuals.get(category) ?? 0, row.amountUgx));
    }
    return {
      access: "ready" as const,
      businessId: current.business._id,
      canManage,
      from: args.from,
      toExclusive: args.toExclusive,
      singleMonth,
      complete,
      categories: categoryNames.map(category => {
        const budget = budgets.find(row => row.category.toLowerCase() === category.toLowerCase());
        const monthlyBudgetUgx = budget && budget.monthlyBudgetUgx > 0 ? budget.monthlyBudgetUgx : null;
        const warningAtPercent = monthlyBudgetUgx === null ? null : budget?.warningAtPercent ?? 80;
        const actualUgx = actuals.get(category) ?? 0;
        const utilizationPercent = monthlyBudgetUgx === null ? null : Math.round(actualUgx / monthlyBudgetUgx * 100);
        const status = monthlyBudgetUgx === null
          ? "not_set" as const
          : !complete
            ? "incomplete" as const
            : utilizationPercent !== null && utilizationPercent >= (warningAtPercent ?? 80)
              ? "threshold_reached" as const
              : "below_warning" as const;
        const configured = configuredCategories.some(item => item.toLowerCase() === category.toLowerCase());
        return { category, configured, monthlyBudgetUgx, warningAtPercent, actualUgx, utilizationPercent, status };
      }),
    };
  },
});

export const save = mutation({
  args: { category: v.string(), monthlyBudgetUgx: v.number(), warningAtPercent: v.number(), active: v.boolean() },
  returns: v.union(v.id("categoryBudgets"), v.null()),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "settings.update"))) throw new Error("Your role cannot manage category budgets.");
    const category = args.category.trim();
    if (!category || category.length > 80 || !Number.isSafeInteger(args.monthlyBudgetUgx) || args.monthlyBudgetUgx <= 0 || !Number.isSafeInteger(args.warningAtPercent) || args.warningAtPercent < 1 || args.warningAtPercent > 300) throw new Error("Enter a positive monthly budget and a whole-number warning threshold from 1% to 300%.");
    const preferences = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    const expenseCategories = preferences?.expenseCategories ?? defaultExpenseCategories;
    const configuredCategory = expenseCategories.find(item => item.toLowerCase() === category.toLowerCase());
    const savedBudgets = await ctx.db.query("categoryBudgets").withIndex("by_business_and_category", q => q.eq("businessId", current.business._id)).take(500);
    const existing = savedBudgets.find(row => row.category.toLowerCase() === category.toLowerCase());
    if (!configuredCategory && !existing) throw new Error("Choose a saved expense category before setting its budget.");
    const savedCategory = configuredCategory ?? existing!.category;
    if (!args.active && !existing) return null;
    const now = Date.now();
    if (existing) {
      if (existing.active === args.active && existing.monthlyBudgetUgx === args.monthlyBudgetUgx && existing.warningAtPercent === args.warningAtPercent && existing.category === savedCategory) return existing._id;
      await ctx.db.patch("categoryBudgets", existing._id, { category: savedCategory, monthlyBudgetUgx: args.monthlyBudgetUgx, warningAtPercent: args.warningAtPercent, active: args.active, updatedBy: current.userId, updatedAt: now });
      await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: args.active ? "category_budget.updated" : "category_budget.archived", entityType: "categoryBudget", entityId: existing._id, occurredAt: now, summary: args.active ? `Updated ${savedCategory} monthly budget.` : `Archived ${savedCategory} monthly budget.`, details: JSON.stringify({ before: { category: existing.category, monthlyBudgetUgx: existing.monthlyBudgetUgx, warningAtPercent: existing.warningAtPercent, active: existing.active }, after: { category: savedCategory, monthlyBudgetUgx: args.monthlyBudgetUgx, warningAtPercent: args.warningAtPercent, active: args.active } }) });
      return existing._id;
    }
    const id = await ctx.db.insert("categoryBudgets", { businessId: current.business._id, category: savedCategory, monthlyBudgetUgx: args.monthlyBudgetUgx, warningAtPercent: args.warningAtPercent, active: true, createdBy: current.userId, createdAt: now, updatedBy: current.userId, updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "category_budget.created", entityType: "categoryBudget", entityId: id, occurredAt: now, summary: `Set ${savedCategory} monthly budget.`, details: JSON.stringify({ category: savedCategory, monthlyBudgetUgx: args.monthlyBudgetUgx, warningAtPercent: args.warningAtPercent }) });
    return id;
  },
});
