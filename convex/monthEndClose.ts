import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasPermission } from "./accessControl";

type Ctx = QueryCtx | MutationCtx;
type Period = { periodFrom: string; periodToExclusive: string };

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function nextMonthStart(from: string) {
  const date = new Date(`${from}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

async function sourceFingerprint(rows: Array<{ _id: string; kind: string; amountUgx: number; occurredOn: string; account: string; category: string; note: string; source: string; state: string; supplierName?: string; supplierReference?: string; idempotencyKey: string }>) {
  const source = JSON.stringify(rows.map(row => [row._id, row.kind, row.amountUgx, row.occurredOn, row.account, row.category, row.note, row.source, row.state, row.supplierName ?? "", row.supplierReference ?? "", row.idempotencyKey]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return `${rows.length}:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function assertPeriod(periodFrom: string, periodToExclusive: string, timezone: string) {
  if (!validDay(periodFrom) || !validDay(periodToExclusive) || !periodFrom.endsWith("-01") || nextMonthStart(periodFrom) !== periodToExclusive) {
    throw new ConvexError("Choose one complete calendar month for close review.");
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
  const currentMonth = `${today.slice(0, 7)}-01`;
  if (periodToExclusive > currentMonth) throw new ConvexError("A month can be closed only after its final business day has passed.");
}

async function currentWorkspace(ctx: Ctx, businessId: Id<"businesses">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  if (!membership?.active) return null;
  const business = await ctx.db.get("businesses", businessId);
  if (!business || business.dataResetting) return null;
  return { userId, membership, business };
}

async function snapshotForPeriod(ctx: Ctx, businessId: Id<"businesses">, period: Period) {
  const lastDay = new Date(`${period.periodToExclusive}T00:00:00.000Z`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const lastDayIso = lastDay.toISOString().slice(0, 10);
  const [entries, reconciliations, openReviews, acknowledgedReviews, activeImports, reversingImports, cash, mobileMoney, budgets, activityReviews] = await Promise.all([
    ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", businessId).gte("occurredOn", period.periodFrom).lt("occurredOn", period.periodToExclusive)).take(10_001),
    ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", businessId).gte("asOfDate", period.periodFrom).lt("asOfDate", period.periodToExclusive)).take(501),
    ctx.db.query("issueReviews").withIndex("by_business_and_status_and_updated", q => q.eq("businessId", businessId).eq("status", "open")).take(1001),
    ctx.db.query("issueReviews").withIndex("by_business_and_status_and_updated", q => q.eq("businessId", businessId).eq("status", "acknowledged")).take(1001),
    ctx.db.query("importBatches").withIndex("by_business_and_status_and_created", q => q.eq("businessId", businessId).eq("status", "in_progress")).take(101),
    ctx.db.query("importBatches").withIndex("by_business_and_status_and_created", q => q.eq("businessId", businessId).eq("status", "reversing")).take(101),
    ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(),
    ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "mobile_money")).unique(),
    ctx.db.query("categoryBudgets").withIndex("by_business", q => q.eq("businessId", businessId)).take(1001),
    ctx.db.query("dailyActivityReviews").withIndex("by_business_and_day", q => q.eq("businessId", businessId).gte("day", period.periodFrom).lt("day", period.periodToExclusive)).take(32),
  ]);

  const complete = entries.length <= 10_000 && reconciliations.length <= 500 && openReviews.length <= 1000 && acknowledgedReviews.length <= 1000 && activeImports.length <= 100 && reversingImports.length <= 100 && budgets.length <= 1000 && activityReviews.length <= 31;
  const posted = entries.filter(entry => entry.state === "posted");
  const salesUgx = posted.filter(entry => entry.kind === "sale").reduce((sum, entry) => {
    const total = sum + entry.amountUgx;
    if (!Number.isSafeInteger(total)) throw new ConvexError("Sales exceed the supported safe amount range.");
    return total;
  }, 0);
  const expensesUgx = posted.filter(entry => entry.kind === "expense").reduce((sum, entry) => {
    const total = sum + entry.amountUgx;
    if (!Number.isSafeInteger(total)) throw new ConvexError("Expenses exceed the supported safe amount range.");
    return total;
  }, 0);
  const expenseByCategory = new Map<string, number>();
  for (const entry of posted) if (entry.kind === "expense") {
    const total = (expenseByCategory.get(entry.category) ?? 0) + entry.amountUgx;
    if (!Number.isSafeInteger(total)) throw new ConvexError("Category actual exceeds the supported safe amount range.");
    expenseByCategory.set(entry.category, total);
  }
  const currentCounts = reconciliations.filter(row => row.status !== "superseded");
  const lastDayReconciliations = currentCounts.filter(row => row.asOfDate === lastDayIso);
  const lastDayCashClosed = lastDayReconciliations.some(row => row.account === "cash" && row.status === "closed");
  const lastDayMobileClosed = lastDayReconciliations.some(row => row.account === "mobile_money" && row.status === "closed");
  const unresolvedReconciliations = currentCounts.filter(row => row.status !== "closed");
  const openPeriodIssues = [...openReviews, ...acknowledgedReviews].filter(row => {
    const [from, toExclusive] = row.issueKey.split(":", 2);
    return validDay(from) && validDay(toExclusive) && from < period.periodToExclusive && toExclusive > period.periodFrom;
  });
  const pendingImports = [...activeImports, ...reversingImports];
  const categoryBudgets = budgets.filter(row => row.active).map(row => ({
    category: row.category,
    limitUgx: row.monthlyBudgetUgx,
    warningAtPercent: row.warningAtPercent,
    actualUgx: expenseByCategory.get(row.category) ?? 0,
  })).sort((a, b) => a.category.localeCompare(b.category));
  const salesByCategory = [...new Set(posted.filter(entry => entry.kind === "sale").map(entry => entry.category))].sort().map(category => ({ category, amountUgx: posted.filter(entry => entry.kind === "sale" && entry.category === category).reduce((sum, entry) => sum + entry.amountUgx, 0) }));
  const expensesByCategory = [...expenseByCategory.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([category, amountUgx]) => ({ category, amountUgx }));
  const cashbookNetUgx = salesUgx - expensesUgx;
  if (!Number.isSafeInteger(cashbookNetUgx)) throw new ConvexError("Cashbook net exceeds the supported safe amount range.");
  const accountTotals = new Map<"cash" | "mobile_money" | "unallocated", { salesUgx: number; expensesUgx: number }>();
  for (const entry of posted) {
    const current = accountTotals.get(entry.account) ?? { salesUgx: 0, expensesUgx: 0 };
    const key = entry.kind === "sale" ? "salesUgx" : "expensesUgx";
    const total = current[key] + entry.amountUgx;
    if (!Number.isSafeInteger(total)) throw new ConvexError("Account movement exceeds the supported safe amount range.");
    current[key] = total;
    accountTotals.set(entry.account, current);
  }
  const movementsByAccount = [...accountTotals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([account, totals]) => ({ account, ...totals, netUgx: totals.salesUgx - totals.expensesUgx }));
  const reconciliationEvidence = reconciliations.map(row => ({ account: row.account, asOfDate: row.asOfDate, bookBalanceUgx: row.bookBalanceUgx, countedBalanceUgx: row.countedBalanceUgx, varianceUgx: row.varianceUgx, status: row.status, note: row.note, explanation: row.explanation ?? null, reviewedByName: row.reviewedByName ?? null, reviewedAt: row.reviewedAt ?? null, reviewNote: row.reviewNote ?? null, supersedesId: row.supersedesId ?? null }));
  const postedDays = new Set(posted.map(entry => entry.occurredOn));
  const entriesByDay = new Map<string, typeof entries>();
  for (const entry of entries) entriesByDay.set(entry.occurredOn, [...(entriesByDay.get(entry.occurredOn) ?? []), entry]);
  const reviewByDay = new Map(activityReviews.map(row => [row.day, row]));
  const activityDays: Array<{ day: string; status: "confirmed_no_activity" | "source_reviewed"; note: string }> = [];
  const unreviewedSourceDays: Array<{ day: string; activityExists: boolean; priorStatus: "confirmed_no_activity" | "source_reviewed" | null; note: string | null; updatedAt: number | null }> = [];
  for (let date = new Date(`${period.periodFrom}T00:00:00.000Z`); date.toISOString().slice(0, 10) < period.periodToExclusive; date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    const activityExists = postedDays.has(day);
    const fingerprint = await sourceFingerprint(entriesByDay.get(day) ?? []);
    const saved = reviewByDay.get(day);
    const expectedStatus = activityExists ? "source_reviewed" : "confirmed_no_activity";
    if (!saved || saved.status !== expectedStatus || saved.sourceFingerprint !== fingerprint) unreviewedSourceDays.push({ day, activityExists, priorStatus: saved?.status ?? null, note: saved?.note ?? null, updatedAt: saved?.updatedAt ?? null });
    else activityDays.push({ day, status: saved.status, note: saved.note });
  }
  const checklist = [
    { key: "records", label: "Cashbook history is complete", ready: entries.length <= 10_000, detail: entries.length <= 10_000 ? `${entries.length} posted or void rows reviewed.` : "This month exceeds the 10,000-row close review limit; narrow or export the period before closing." },
    { key: "balances", label: "Cash and mobile-money balances are present", ready: Boolean(cash && mobileMoney), detail: cash && mobileMoney ? "Both account balance records are available." : "Initialize both account balances before closing the month." },
    { key: "cash-count", label: "Final-day cash count is signed off", ready: lastDayCashClosed, detail: lastDayCashClosed ? `A signed-off cash count exists for ${lastDayIso}.` : `A cash count for ${lastDayIso} is missing. Counts cannot be entered retroactively; record the final-day count before that business day ends.` },
    { key: "mobile-count", label: "Final-day mobile-money balance is signed off", ready: lastDayMobileClosed, detail: lastDayMobileClosed ? `A signed-off mobile-money count exists for ${lastDayIso}.` : `A mobile-money count for ${lastDayIso} is missing. Counts cannot be entered retroactively; record the final-day balance before that business day ends.` },
    { key: "reconciliations", label: "No unresolved account counts remain", ready: unresolvedReconciliations.length === 0, detail: unresolvedReconciliations.length ? `${unresolvedReconciliations.length} count${unresolvedReconciliations.length === 1 ? "" : "s"} still need sign-off or correction.` : "All period counts are signed off or superseded by corrections." },
    { key: "issues", label: "Period data-quality reviews are resolved", ready: openPeriodIssues.length === 0, detail: openPeriodIssues.length ? `${openPeriodIssues.length} open or acknowledged issue review${openPeriodIssues.length === 1 ? "" : "s"} overlap this period.` : "No unresolved saved issue reviews overlap this period." },
    { key: "imports", label: "No imports are in progress", ready: pendingImports.length === 0, detail: pendingImports.length ? `${pendingImports.length} import batch${pendingImports.length === 1 ? " is" : "es are"} still in progress or reversing.` : "No import batches are awaiting completion or reversal." },
    { key: "source-days", label: "Every calendar day has a source-coverage review", ready: unreviewedSourceDays.length === 0, detail: unreviewedSourceDays.length ? `${unreviewedSourceDays.length} day${unreviewedSourceDays.length === 1 ? " needs" : "s need"} review to confirm saved activity or no activity.` : "Every day is attested as source-reviewed or no-activity." },
    { key: "limits", label: "All close review sections are within their safe limits", ready: complete, detail: complete ? "Ledger, unresolved issue, active import, reconciliation and budget reads are complete." : "A source exceeded a safe review limit; the close is blocked rather than calculated from partial rows." },
  ];
  return {
    complete,
    totals: { salesUgx, expensesUgx, cashbookNetUgx },
    salesByCategory,
    expensesByCategory,
    postedEntryCount: posted.length,
    excludedVoidEntryCount: entries.length - posted.length,
    movementsByAccount,
    reconciliationEvidence,
    activityDays,
    unreviewedSourceDays,
    categoryBudgets,
    checklist,
    ready: checklist.every(item => item.ready),
  };
}

export const overview = query({
  args: { businessId: v.id("businesses"), periodFrom: v.string(), periodToExclusive: v.string() },
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({
    access: v.literal("ready"), periodFrom: v.string(), periodToExclusive: v.string(), today: v.string(),
    snapshot: v.object({ complete: v.boolean(), totals: v.object({ salesUgx: v.number(), expensesUgx: v.number(), cashbookNetUgx: v.number() }), salesByCategory: v.array(v.object({ category: v.string(), amountUgx: v.number() })), expensesByCategory: v.array(v.object({ category: v.string(), amountUgx: v.number() })), postedEntryCount: v.number(), excludedVoidEntryCount: v.number(), movementsByAccount: v.array(v.object({ account: v.union(v.literal("cash"), v.literal("mobile_money"), v.literal("unallocated")), salesUgx: v.number(), expensesUgx: v.number(), netUgx: v.number() })), reconciliationEvidence: v.array(v.object({ account: v.union(v.literal("cash"), v.literal("mobile_money")), asOfDate: v.string(), bookBalanceUgx: v.number(), countedBalanceUgx: v.number(), varianceUgx: v.number(), status: v.union(v.literal("matched"), v.literal("open"), v.literal("explained"), v.literal("closed"), v.literal("superseded")), note: v.string(), explanation: v.union(v.string(), v.null()), reviewedByName: v.union(v.string(), v.null()), reviewedAt: v.union(v.number(), v.null()), reviewNote: v.union(v.string(), v.null()), supersedesId: v.union(v.id("reconciliations"), v.null()) })), activityDays: v.array(v.object({ day: v.string(), status: v.union(v.literal("confirmed_no_activity"), v.literal("source_reviewed")), note: v.string() })), unreviewedSourceDays: v.array(v.object({ day: v.string(), activityExists: v.boolean(), priorStatus: v.union(v.literal("confirmed_no_activity"), v.literal("source_reviewed"), v.null()), note: v.union(v.string(), v.null()), updatedAt: v.union(v.number(), v.null()) })), categoryBudgets: v.array(v.object({ category: v.string(), limitUgx: v.number(), warningAtPercent: v.number(), actualUgx: v.number() })), checklist: v.array(v.object({ key: v.string(), label: v.string(), ready: v.boolean(), detail: v.string() })), ready: v.boolean() }),
    closure: v.union(v.null(), v.object({ _id: v.id("monthEndClosures"), status: v.union(v.literal("awaiting_review"), v.literal("closed"), v.literal("reopened")), snapshotJson: v.string(), preparedByName: v.string(), preparedAt: v.number(), reviewedByName: v.union(v.string(), v.null()), reviewedAt: v.union(v.number(), v.null()), reopenReason: v.union(v.string(), v.null()) })),
    events: v.array(v.object({ action: v.union(v.literal("prepared"), v.literal("approved"), v.literal("reopened")), actorName: v.string(), occurredAt: v.number(), reason: v.union(v.string(), v.null()) })),
    canClose: v.boolean(), canReview: v.boolean(), canApprove: v.boolean(),
  })),
  handler: async (ctx, args) => {
    const current = await currentWorkspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "monthlyPnl.view"))) return { access: "restricted" as const };
    assertPeriod(args.periodFrom, args.periodToExclusive, current.business.timezone);
    const [snapshot, closure, canClose, canReview] = await Promise.all([
      snapshotForPeriod(ctx, current.business._id, args),
      ctx.db.query("monthEndClosures").withIndex("by_business_and_period", q => q.eq("businessId", current.business._id).eq("periodFrom", args.periodFrom)).unique(),
      hasPermission(ctx, current.membership, "reconcile.resolve"),
      hasPermission(ctx, current.membership, "reconcile.resolve"),
    ]);
    const events = closure ? await ctx.db.query("monthEndCloseEvents").withIndex("by_closure_and_time", q => q.eq("closureId", closure._id)).order("desc").take(20) : [];
    const [preparedBy, reviewedBy] = closure ? await Promise.all([ctx.db.get("users", closure.preparedBy), closure.reviewedBy ? ctx.db.get("users", closure.reviewedBy) : Promise.resolve(null)]) : [null, null];
    const eventDetails = await Promise.all(events.map(async event => ({
      action: event.action,
      actorName: (await ctx.db.get("users", event.actorId))?.name || "Workspace member",
      occurredAt: event.occurredAt,
      reason: event.reason ?? null,
    })));
    return {
      access: "ready" as const,
      periodFrom: args.periodFrom,
      periodToExclusive: args.periodToExclusive,
      today: new Intl.DateTimeFormat("en-CA", { timeZone: current.business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now()),
      snapshot,
      closure: closure ? { _id: closure._id, status: closure.status, snapshotJson: closure.snapshotJson, preparedByName: preparedBy?.name || "Workspace member", preparedAt: closure.preparedAt, reviewedByName: reviewedBy?.name || null, reviewedAt: closure.reviewedAt ?? null, reopenReason: closure.reopenReason ?? null } : null,
      events: eventDetails,
      canClose,
      canReview,
      canApprove: canReview && !!closure && closure.status === "awaiting_review" && closure.preparedBy !== current.userId,
    };
  },
});

export const reviewSourceDay = mutation({
  args: {
    businessId: v.id("businesses"), day: v.string(),
    status: v.union(v.literal("confirmed_no_activity"), v.literal("source_reviewed")),
    note: v.string(), expectedUpdatedAt: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await currentWorkspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "reconcile.resolve"))) throw new ConvexError("Your role cannot review month-end source coverage.");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: current.business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
    const note = args.note.trim();
    if (!validDay(args.day) || args.day >= today || note.length < 5 || note.length > 300) throw new ConvexError("Choose a past business day and enter a source review note of 5 to 300 characters.");
    const dayEntries = await ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", current.business._id).eq("occurredOn", args.day)).take(1001);
    if (dayEntries.length > 1000) throw new ConvexError("This day has too many ledger rows to safely review source coverage.");
    const hasPostedActivity = dayEntries.some(entry => entry.state === "posted");
    if (args.status === "source_reviewed" && !hasPostedActivity) throw new ConvexError("No posted source entries exist for this day. Confirm it as no activity instead.");
    if (args.status === "confirmed_no_activity" && hasPostedActivity) throw new ConvexError("Posted cashbook entries exist for this day. Review the source entries instead.");
    const prior = await ctx.db.query("dailyActivityReviews").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", args.day)).unique();
    if ((prior?.updatedAt ?? null) !== args.expectedUpdatedAt) throw new ConvexError("This day was reviewed in another session. Refresh the close checklist before saving again.");
    const now = Date.now();
    const fingerprint = await sourceFingerprint(dayEntries);
    if (prior) await ctx.db.patch(prior._id, { status: args.status, note, sourceFingerprint: fingerprint, updatedBy: current.userId, updatedAt: now });
    else await ctx.db.insert("dailyActivityReviews", { businessId: current.business._id, day: args.day, status: args.status, note, sourceFingerprint: fingerprint, createdBy: current.userId, createdAt: now, updatedBy: current.userId, updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "sales.day_source_reviewed", entityType: "dailyActivityReview", entityId: `${current.business._id}:${args.day}`, occurredAt: now, summary: `Reviewed ${args.day} source coverage as ${args.status === "source_reviewed" ? "complete" : "no activity"}.`, details: JSON.stringify({ before: prior ? { status: prior.status, note: prior.note } : null, after: { status: args.status, note } }) });
    return null;
  },
});

export const prepare = mutation({
  args: { businessId: v.id("businesses"), periodFrom: v.string(), periodToExclusive: v.string() },
  returns: v.id("monthEndClosures"),
  handler: async (ctx, args) => {
    const current = await currentWorkspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "reconcile.resolve"))) throw new ConvexError("Your role cannot prepare a month-end close.");
    assertPeriod(args.periodFrom, args.periodToExclusive, current.business.timezone);
    const snapshot = await snapshotForPeriod(ctx, current.business._id, args);
    if (!snapshot.ready) throw new ConvexError(`Complete every close checklist item first: ${snapshot.checklist.filter(item => !item.ready).map(item => item.label).join("; ")}`);
    const existing = await ctx.db.query("monthEndClosures").withIndex("by_business_and_period", q => q.eq("businessId", current.business._id).eq("periodFrom", args.periodFrom)).unique();
    if (existing?.status === "closed") throw new ConvexError("This month is already closed. Reopen it with a reason before preparing another close.");
    const now = Date.now();
    const snapshotJson = JSON.stringify(snapshot);
    const closureId = existing
      ? existing._id
      : await ctx.db.insert("monthEndClosures", { businessId: current.business._id, periodFrom: args.periodFrom, periodToExclusive: args.periodToExclusive, status: "awaiting_review", snapshotJson, preparedBy: current.userId, preparedAt: now, updatedAt: now });
    if (existing) await ctx.db.patch(existing._id, { periodToExclusive: args.periodToExclusive, status: "awaiting_review", snapshotJson, preparedBy: current.userId, preparedAt: now, reviewedBy: undefined, reviewedAt: undefined, reopenReason: undefined, updatedAt: now });
    await ctx.db.insert("monthEndCloseEvents", { businessId: current.business._id, closureId, action: "prepared", actorId: current.userId, occurredAt: now, snapshotJson });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "month_end_close.prepared", entityType: "monthEndClosure", entityId: closureId, occurredAt: now, summary: `Prepared cashbook close for ${args.periodFrom}.`, details: snapshotJson });
    return closureId;
  },
});

export const approve = mutation({
  args: { businessId: v.id("businesses"), closureId: v.id("monthEndClosures"), expectedSnapshotJson: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await currentWorkspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "reconcile.resolve"))) throw new ConvexError("Your role cannot approve a month-end close.");
    const closure = await ctx.db.get("monthEndClosures", args.closureId);
    if (!closure || closure.businessId !== current.business._id || closure.status !== "awaiting_review") throw new ConvexError("This month-end close is no longer awaiting review.");
    if (closure.preparedBy === current.userId) throw new ConvexError("A different workspace reviewer must approve the prepared close.");
    if (closure.snapshotJson !== args.expectedSnapshotJson) throw new ConvexError("The prepared close changed. Refresh the checklist and prepare a new snapshot for review.");
    const snapshot = await snapshotForPeriod(ctx, current.business._id, closure);
    const currentSnapshotJson = JSON.stringify(snapshot);
    if (!snapshot.ready || currentSnapshotJson !== closure.snapshotJson) throw new ConvexError("Source records changed or a checklist item is no longer complete. Reprepare the month-end close.");
    const now = Date.now();
    await ctx.db.patch(closure._id, { status: "closed", reviewedBy: current.userId, reviewedAt: now, reopenReason: undefined, updatedAt: now });
    await ctx.db.insert("monthEndCloseEvents", { businessId: current.business._id, closureId: closure._id, action: "approved", actorId: current.userId, occurredAt: now, snapshotJson: currentSnapshotJson });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "month_end_close.approved", entityType: "monthEndClosure", entityId: closure._id, occurredAt: now, summary: `Approved cashbook close for ${closure.periodFrom}.`, details: currentSnapshotJson });
    return null;
  },
});

export const reopen = mutation({
  args: { businessId: v.id("businesses"), closureId: v.id("monthEndClosures"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await currentWorkspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "reconcile.resolve"))) throw new ConvexError("Your role cannot reopen a month-end close.");
    const closure = await ctx.db.get("monthEndClosures", args.closureId);
    const reason = args.reason.trim();
    if (!closure || closure.businessId !== current.business._id || closure.status !== "closed" || reason.length < 5 || reason.length > 300) throw new ConvexError("Choose a closed month and provide a reopening reason of 5 to 300 characters.");
    const now = Date.now();
    await ctx.db.patch(closure._id, { status: "reopened", reopenReason: reason, updatedAt: now });
    await ctx.db.insert("monthEndCloseEvents", { businessId: current.business._id, closureId: closure._id, action: "reopened", actorId: current.userId, occurredAt: now, reason, snapshotJson: closure.snapshotJson });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "month_end_close.reopened", entityType: "monthEndClosure", entityId: closure._id, occurredAt: now, summary: `Reopened cashbook close for ${closure.periodFrom}.`, details: JSON.stringify({ reason, snapshotJson: closure.snapshotJson }) });
    return null;
  },
});
