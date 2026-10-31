import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasPermission } from "./accessControl";

function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const value = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(value.valueOf()) && value.toISOString().slice(0, 10) === day;
}

async function authorize(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">, permission: "analytics.view" | "reports.view") {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  if (!membership?.active || !(await hasPermission(ctx, membership, permission))) return null;
  const business = await ctx.db.get("businesses", businessId);
  return !business || business.dataResetting ? null : { userId, membership, business };
}

export const list = query({
  args: { businessId: v.id("businesses"), from: v.string(), toExclusive: v.string() },
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({ access: v.literal("ready"), complete: v.boolean(), canReview: v.boolean(), reviews: v.array(v.object({ day: v.string(), explanation: v.string(), salesUgxAtReview: v.number(), thresholdUgxAtReview: v.number(), author: v.string(), updatedAt: v.number() })) })),
  handler: async (ctx, args) => {
    if (!validDay(args.from) || !validDay(args.toExclusive) || args.from >= args.toExclusive || Date.parse(`${args.toExclusive}T00:00:00Z`) - Date.parse(`${args.from}T00:00:00Z`) > 366 * 86_400_000) throw new Error("Choose a valid period of up to one year for the weak-day diary.");
    const current = await authorize(ctx, args.businessId, "analytics.view");
    if (!current) return { access: "restricted" as const };
    const [rows, canReview] = await Promise.all([
      ctx.db.query("weakDayReviews").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).gte("day", args.from).lt("day", args.toExclusive)).take(501),
      hasPermission(ctx, current.membership, "reports.view"),
    ]);
    const reviews = await Promise.all(rows.slice(0, 500).map(async row => ({ day: row.day, explanation: row.explanation, salesUgxAtReview: row.salesUgxAtReview, thresholdUgxAtReview: row.thresholdUgxAtReview, author: (await ctx.db.get("users", row.updatedBy))?.name || "Workspace member", updatedAt: row.updatedAt })));
    return { access: "ready" as const, complete: rows.length <= 500, canReview, reviews };
  },
});

export const save = mutation({
  args: { businessId: v.id("businesses"), day: v.string(), explanation: v.string(), expectedUpdatedAt: v.union(v.number(), v.null()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await authorize(ctx, args.businessId, "reports.view");
    if (!current) throw new Error("Your role cannot update weak-day reviews in this workspace.");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: current.business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
    const explanation = args.explanation.trim();
    if (!validDay(args.day) || args.day >= today || explanation.length < 5 || explanation.length > 500) throw new Error("Choose a past day and enter an explanation between 5 and 500 characters.");
    const entries = await ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", current.business._id).eq("occurredOn", args.day)).take(1001);
    if (entries.length > 1000) throw new Error("This day has too many ledger rows to safely review.");
    let salesUgxAtReview = 0;
    for (const row of entries) if (row.kind === "sale" && row.state === "posted") {
      salesUgxAtReview += row.amountUgx;
      if (!Number.isSafeInteger(salesUgxAtReview)) throw new Error("Daily sales exceed the supported safe amount range.");
    }
    const preferences = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    const currencyScale = 10 ** (new Intl.NumberFormat("en", { style: "currency", currency: current.business.currency }).resolvedOptions().maximumFractionDigits ?? 0);
    const thresholdUgxAtReview = preferences?.weakDaySalesUgx ?? 50_000 * currencyScale;
    if (salesUgxAtReview <= 0 || salesUgxAtReview >= thresholdUgxAtReview) throw new Error("This day does not currently meet the workspace low-sales review threshold.");
    const prior = await ctx.db.query("weakDayReviews").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", args.day)).unique();
    if ((prior?.updatedAt ?? null) !== args.expectedUpdatedAt) throw new Error("This weak-day note changed in another session. Refresh the analytics view before saving again.");
    const now = Date.now();
    if (prior) await ctx.db.patch(prior._id, { explanation, salesUgxAtReview, thresholdUgxAtReview, updatedBy: current.userId, updatedAt: now });
    else await ctx.db.insert("weakDayReviews", { businessId: current.business._id, day: args.day, explanation, salesUgxAtReview, thresholdUgxAtReview, createdBy: current.userId, createdAt: now, updatedBy: current.userId, updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "sales.weak_day_reviewed", entityType: "weakDayReview", entityId: `${current.business._id}:${args.day}`, occurredAt: now, summary: `Added a low-sales explanation for ${args.day}.`, details: JSON.stringify({ before: prior ? { explanation: prior.explanation, salesUgxAtReview: prior.salesUgxAtReview, thresholdUgxAtReview: prior.thresholdUgxAtReview } : null, after: { explanation, salesUgxAtReview, thresholdUgxAtReview } }) });
    return null;
  },
});
