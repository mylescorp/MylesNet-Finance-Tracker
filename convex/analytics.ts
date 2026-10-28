import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

function safeAdd(a: number, b: number, label: string) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} is outside the supported amount range.`);
  return result;
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function monthBounds(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const toExclusive = shiftDay(day, 1);
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  return { from, toExclusive, daysInMonth, elapsedDays: date.getUTCDate() };
}

async function dailyTotals(ctx: QueryCtx, businessId: Id<"businesses">, from: string, toExclusive: string, limit: number) {
  return await ctx.db.query("dailyTotals")
    .withIndex("by_business_and_day", q => q.eq("businessId", businessId).gte("day", from).lt("day", toExclusive))
    .take(limit);
}

export const overview = query({
  args: { businessId: v.id("businesses"), from: v.string(), toExclusive: v.string(), today: v.string() },
  handler: async (ctx, args) => {
    if (!validDay(args.from) || !validDay(args.toExclusive) || !validDay(args.today) || args.from >= args.toExclusive || args.toExclusive > shiftDay(args.today, 1)) throw new Error("Choose a valid reporting range that ends no later than today.");
    const rangeLength = (Date.parse(`${args.toExclusive}T00:00:00.000Z`) - Date.parse(`${args.from}T00:00:00.000Z`)) / 86_400_000;
    if (rangeLength > 370) throw new Error("Choose a reporting period of 370 days or less.");
    const callerId = await getAuthUserId(ctx);
    const callerMembership = callerId ? await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", args.businessId).eq("userId", callerId)).unique() : null;
    const requestedBusiness = callerMembership?.active ? await ctx.db.get("businesses", args.businessId) : null;
    const current = callerId && callerMembership && requestedBusiness ? { userId: callerId, membership: callerMembership, business: requestedBusiness } : null;
    if (!current) return { access: "pending" as const };
    const { membership, business } = current;
    if (membership.role === "partner" || membership.role === "finance_approver") return { access: "restricted" as const };

    const month = monthBounds(args.today);
    const runwayFrom = shiftDay(args.today, -29);
    const weakFrom = shiftDay(args.today, -13);
    const [preferences, periodRows, monthRows, runwayRows, weakRows, balances, partners, salesEntries, expenseEntries, reconciliations] = await Promise.all([
      ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", business._id)).unique(),
      dailyTotals(ctx, business._id, args.from, args.toExclusive, 370),
      dailyTotals(ctx, business._id, month.from, month.toExclusive, 31),
      dailyTotals(ctx, business._id, runwayFrom, shiftDay(args.today, 1), 30),
      dailyTotals(ctx, business._id, weakFrom, shiftDay(args.today, 1), 14),
      ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", business._id)).take(2),
      ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", business._id).eq("active", true)).take(101),
      ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", business._id).eq("kind", "sale").gte("occurredOn", args.from).lt("occurredOn", args.toExclusive)).take(5001),
      ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", business._id).eq("kind", "expense").gte("occurredOn", args.from).lt("occurredOn", args.toExclusive)).take(1001),
      ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", business._id).gte("asOfDate", shiftDay(args.today, -89)).lte("asOfDate", args.today)).take(101),
    ]);
    if (partners.length > 100) throw new Error("This workspace has more active partner records than analytics can safely summarize.");

    const byDay = new Map(periodRows.map(row => [row.day, row]));
    const days = Array.from({ length: rangeLength }, (_, index) => {
      const day = shiftDay(args.from, index);
      const row = byDay.get(day);
      return { day, salesUgx: row?.salesUgx ?? 0, expensesUgx: row?.expensesUgx ?? 0, hasActivity: Boolean(row && (row.saleCount || row.expenseCount)) };
    });
    const salesUgx = periodRows.reduce((sum, row) => safeAdd(sum, row.salesUgx, "Sales total"), 0);
    const expensesUgx = periodRows.reduce((sum, row) => safeAdd(sum, row.expensesUgx, "Expense total"), 0);
    const netUgx = safeAdd(salesUgx, -expensesUgx, "Cashbook net");
    const cashUgx = balances.find(row => row.account === "cash")?.balanceUgx ?? 0;
    const mobileUgx = balances.find(row => row.account === "mobile_money")?.balanceUgx ?? 0;
    const liquidUgx = safeAdd(cashUgx, mobileUgx, "Liquid balance");
    const monthSales = monthRows.reduce((sum, row) => safeAdd(sum, row.salesUgx, "Month sales"), 0);
    const monthExpenses = monthRows.reduce((sum, row) => safeAdd(sum, row.expensesUgx, "Month expenses"), 0);
    const runwayExpenses = runwayRows.reduce((sum, row) => safeAdd(sum, row.expensesUgx, "Recent expenses"), 0);
    const dailyBurnUgx = Math.round(runwayExpenses / 30);
    const currencyScale = 10 ** (new Intl.NumberFormat("en", { style: "currency", currency: business.currency }).resolvedOptions().maximumFractionDigits ?? 0);
    const displayMoney = (amount: number) => new Intl.NumberFormat(preferences?.locale ?? "en-UG", { style: "currency", currency: business.currency }).format(amount / currencyScale);
    const lowCashThreshold = preferences?.lowCashAlertUgx ?? 100000 * currencyScale;
    const salesTarget = preferences?.monthlySalesTargetUgx ?? 0;
    const weakThreshold = preferences?.weakDaySalesUgx ?? 50000 * currencyScale;
    const periodEnd = shiftDay(args.toExclusive, -1);
    const ownership = await Promise.all(partners.map(async partner => {
      const history = await ctx.db.query("partnerOwnershipHistory")
        .withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", business._id).eq("partnerId", partner._id).lte("effectiveOn", periodEnd))
        .order("desc").first();
      if (history) return { id: partner._id, name: partner.name, ownershipBps: history.ownershipBps, active: partner.active, existedAtPeriodEnd: true };
      const firstHistory = await ctx.db.query("partnerOwnershipHistory")
        .withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", business._id).eq("partnerId", partner._id))
        .order("asc").first();
      return { id: partner._id, name: partner.name, ownershipBps: firstHistory ? 0 : partner.ownershipBps, active: partner.active, existedAtPeriodEnd: !firstHistory };
    }));
    const periodOwnership = ownership.filter(partner => partner.existedAtPeriodEnd);
    const ownershipBps = periodOwnership.reduce((sum, partner) => safeAdd(sum, partner.ownershipBps, "Ownership total"), 0);
    const ownershipComplete = periodOwnership.length > 0 && ownershipBps === 10000;
    const partnerSnapshot = periodOwnership.map(partner => ({
      ...partner,
      shareOfNetUgx: ownershipComplete ? Math.round(netUgx * partner.ownershipBps / 10000) : 0,
    }));

    const issues: { id: string; title: string; detail: string; severity: "review" | "warning" | "action"; href: string; amountUgx: number }[] = [];
    const weakDays = weakRows.filter(row => row.salesUgx > 0 && row.salesUgx < weakThreshold);
    for (const row of weakDays.slice(0, 7)) issues.push({ id: `weak-${row.day}`, title: "Low-sales day", detail: `${row.day}: recorded sales are below the workspace review threshold. Confirm the day is complete.`, severity: "review", href: "/analytics", amountUgx: row.salesUgx });
    const recentSales = new Set(weakRows.filter(row => row.salesUgx > 0).map(row => row.day));
    const recentActivityExists = weakRows.some(row => row.saleCount > 0 || row.expenseCount > 0);
    if (recentActivityExists) {
      const missingDays = Array.from({ length: 14 }, (_, index) => shiftDay(weakFrom, index)).filter(day => day <= args.today && !recentSales.has(day));
      if (missingDays.length > 0) issues.push({ id: "missing-sales-days", title: "Days with no sales entry", detail: `${missingDays.length} of the last 14 days have no recorded sales. Check whether those were closed days or missing entries.`, severity: "review", href: "/sales", amountUgx: missingDays.length });
    }
    const unallocated = salesEntries.filter(row => row.state === "posted" && row.account === "unallocated");
    const unallocatedUgx = unallocated.reduce((sum, row) => safeAdd(sum, row.amountUgx, "Unallocated sales"), 0);
    const unallocatedComplete = salesEntries.length < 5001;
    if (unallocatedUgx > 0) issues.push({ id: "unallocated-sales", title: "Sales need account allocation", detail: unallocatedComplete ? `${unallocated.length} sales totaling ${displayMoney(unallocatedUgx)} are not assigned to cash or mobile money.` : `At least ${unallocated.length} unallocated sales were found; narrow the period to review all records.`, severity: "action", href: "/sales", amountUgx: unallocatedUgx });
    const cashThresholdEnabled = lowCashThreshold > 0;
    if (cashThresholdEnabled && liquidUgx < lowCashThreshold) issues.push({ id: "low-cash", title: "Cash is below the alert threshold", detail: `Recorded cash and mobile money total ${displayMoney(liquidUgx)}; configured threshold is ${displayMoney(lowCashThreshold)}.`, severity: "warning", href: "/settings/rules", amountUgx: liquidUgx });
    if (salesTarget > 0 && month.elapsedDays < month.daysInMonth && monthSales < Math.ceil(salesTarget * month.elapsedDays / month.daysInMonth)) issues.push({ id: "sales-target-pace", title: "Behind monthly sales pace", detail: `Month-to-date sales of ${displayMoney(monthSales)} are below the straight-line pace for the ${displayMoney(salesTarget)} target.`, severity: "warning", href: "/settings/rules", amountUgx: monthSales });
    const openReconciliations = reconciliations.filter(row => row.status === "open");
    if (openReconciliations.length > 0) issues.push({ id: "open-reconciliations", title: "Reconciliation differences need review", detail: `${openReconciliations.length}${reconciliations.length === 101 ? " or more" : ""} open account differences were recorded in the last 90 days.`, severity: "action", href: "/reconcile", amountUgx: openReconciliations.reduce((sum, row) => safeAdd(sum, Math.abs(row.varianceUgx), "Reconciliation differences"), 0) });
    const largeExpenses = expenseEntries.filter(row => row.state === "posted" && row.amountUgx >= (preferences?.highExpenseReviewUgx ?? 500000 * currencyScale));
    if (largeExpenses.length > 0) issues.push({ id: "high-expense-review", title: "Large expenses to review", detail: `${largeExpenses.length}${expenseEntries.length === 1001 ? " or more" : ""} posted expenses crossed the configured review threshold.`, severity: "review", href: "/expenses", amountUgx: largeExpenses.reduce((sum, row) => safeAdd(sum, row.amountUgx, "Large expenses"), 0) });
    const expenseWarning = preferences?.monthlyExpenseWarningUgx ?? 0;
    if (expenseWarning > 0 && monthExpenses > expenseWarning) issues.push({ id: "monthly-expense-warning", title: "Monthly expenses crossed the warning level", detail: `Recorded month-to-date expenses are ${displayMoney(monthExpenses)} against a ${displayMoney(expenseWarning)} warning level.`, severity: "warning", href: "/expenses", amountUgx: monthExpenses });
    if (partners.length > 0 && !ownershipComplete) issues.push({ id: "ownership-incomplete", title: "Partner ownership does not total 100%", detail: `Active ownership currently totals ${(ownershipBps / 100).toFixed(2)}%. Partner profit shares are withheld until ownership is complete.`, severity: "warning", href: "/partners", amountUgx: ownershipBps });

    const reviewers = (await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", business._id)).take(100))
      .filter(row => row.active && (row.role === "owner" || row.role === "cashier"));
    const visibleReviewers = membership.role === "owner" ? reviewers : reviewers.filter(row => row.userId === current.userId);
    const reviewerOptions = await Promise.all(visibleReviewers.map(async row => {
      const user = await ctx.db.get("users", row.userId);
      return { id: row.userId, label: user?.name || user?.email || "Workspace member" };
    }));
    const issueRows = await Promise.all(issues.map(async issue => {
      const issueKey = `${args.from}:${args.toExclusive}:${issue.id}:${issue.amountUgx}`;
      const review = await ctx.db.query("issueReviews").withIndex("by_business_and_issue", q => q.eq("businessId", business._id).eq("issueKey", issueKey)).unique();
      const assignee = review?.assignedTo ? await ctx.db.get("users", review.assignedTo) : null;
      return { ...issue, issueKey, status: review?.status ?? "open" as const, reviewNote: review?.note, assignedTo: review?.assignedTo, assignedToLabel: assignee?.name || assignee?.email, reviewUpdatedAt: review?.updatedAt };
    }));

    return {
      access: "ready" as const,
      businessId: business._id,
      currency: business.currency,
      currencyMinorDigits: new Intl.NumberFormat("en", { style: "currency", currency: business.currency }).resolvedOptions().maximumFractionDigits,
      locale: preferences?.locale ?? "en-UG",
      period: { from: args.from, toExclusive: args.toExclusive, salesUgx, expensesUgx, netUgx, days },
      target: { amountUgx: salesTarget, monthSalesUgx: monthSales, monthExpensesUgx: monthExpenses, monthNetUgx: monthSales - monthExpenses, elapsedDays: month.elapsedDays, daysInMonth: month.daysInMonth, projectedSalesUgx: Math.round(monthSales / Math.max(1, month.elapsedDays) * month.daysInMonth), requiredSalesPerDayUgx: Math.ceil(Math.max(0, salesTarget - monthSales) / Math.max(1, month.daysInMonth - month.elapsedDays)) },
      balances: { cashUgx, mobileMoneyUgx: mobileUgx, totalUgx: liquidUgx, cashShareBps: liquidUgx > 0 ? Math.round(cashUgx / liquidUgx * 10000) : 0, mobileShareBps: liquidUgx > 0 ? Math.round(mobileUgx / liquidUgx * 10000) : 0, lowCashThresholdUgx: lowCashThreshold },
      runway: { trailingDays: 30, expensesUgx: runwayExpenses, averageDailyExpenseUgx: dailyBurnUgx, days: dailyBurnUgx > 0 ? Math.max(0, Math.floor(liquidUgx / dailyBurnUgx)) : null },
      partners: partnerSnapshot,
      ownershipComplete,
      unallocated: { count: unallocated.length, amountUgx: unallocatedUgx, complete: unallocatedComplete },
      issues: issueRows,
      reviewers: reviewerOptions,
      issuesComplete: reconciliations.length < 101 && expenseEntries.length < 1001 && salesEntries.length < 5001,
      periodActivity: { salesRowsComplete: salesEntries.length < 5001, expenseRowsComplete: expenseEntries.length < 1001 },
    };
  },
});

export const reviewQueue = query({
  args: {
    businessId: v.id("businesses"),
    status: v.optional(v.union(v.literal("open"), v.literal("acknowledged"), v.literal("resolved"))),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const callerId = await getAuthUserId(ctx);
    const membership = callerId ? await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", args.businessId).eq("userId", callerId)).unique() : null;
    if (!membership?.active || (membership.role !== "owner" && membership.role !== "cashier")) throw new Error("Only active owners and cashiers can review the workspace issue queue.");
    if (args.paginationOpts.numItems > 50) throw new Error("Issue queue pages are limited to 50 records.");
    const query = args.status
      ? ctx.db.query("issueReviews").withIndex("by_business_and_status_and_updated", q => q.eq("businessId", args.businessId).eq("status", args.status!))
      : ctx.db.query("issueReviews").withIndex("by_business_and_updated", q => q.eq("businessId", args.businessId));
    const page = await query.order("desc").paginate(args.paginationOpts);
    const results = await Promise.all(page.page.map(async row => {
      const [assignee, author] = await Promise.all([
        row.assignedTo ? ctx.db.get("users", row.assignedTo) : null,
        ctx.db.get("users", row.updatedBy),
      ]);
      const [periodFrom, toExclusive, , amountText] = row.issueKey.split(":");
      const amountUgx = Number(amountText);
      const title = row.issueId.startsWith("weak-") ? `Low-sales day · ${row.issueId.slice(5)}` : ({
        "missing-sales-days": "Days with no sales entry",
        "unallocated-sales": "Sales need account allocation",
        "low-cash": "Cash is below the alert threshold",
        "sales-target-pace": "Behind monthly sales pace",
        "open-reconciliations": "Reconciliation differences need review",
        "high-expense-review": "Large expenses to review",
        "monthly-expense-warning": "Monthly expenses crossed the warning level",
        "ownership-incomplete": "Partner ownership does not total 100%",
      } as Record<string, string>)[row.issueId] ?? "Data-health issue";
      const href = row.issueId === "low-cash" || row.issueId === "sales-target-pace" ? "/settings/rules"
        : row.issueId.includes("reconciliation") ? "/reconcile"
        : row.issueId.includes("expense") ? "/expenses"
        : row.issueId.includes("sales") || row.issueId.includes("unallocated") || row.issueId.includes("missing") ? "/sales"
        : row.issueId.includes("ownership") ? "/partners" : "/analytics";
      return {
        issueKey: row.issueKey,
        issueId: row.issueId,
        title,
        href,
        periodFrom,
        toExclusive,
        amountUgx: Number.isSafeInteger(amountUgx) ? amountUgx : 0,
        status: row.status,
        note: row.note,
        assignedTo: row.assignedTo,
        assignee: assignee?.name || assignee?.email || undefined,
        updatedBy: author?.name || author?.email || "Workspace member",
        updatedAt: row.updatedAt,
      };
    }));
    return { ...page, page: results };
  },
});

export const updateIssueReview = mutation({
  args: {
    businessId: v.id("businesses"),
    issueKey: v.string(), issueId: v.string(), from: v.string(), toExclusive: v.string(), amountUgx: v.number(), expectedUpdatedAt: v.union(v.number(), v.null()),
    status: v.union(v.literal("open"), v.literal("acknowledged"), v.literal("resolved")),
    note: v.string(), assignedTo: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const callerId = await getAuthUserId(ctx);
    const callerMembership = callerId ? await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", args.businessId).eq("userId", callerId)).unique() : null;
    const requestedBusiness = callerMembership?.active ? await ctx.db.get("businesses", args.businessId) : null;
    const current = callerId && callerMembership && requestedBusiness ? { userId: callerId, membership: callerMembership, business: requestedBusiness } : null;
    if (!current || (current.membership.role !== "owner" && current.membership.role !== "cashier")) throw new Error("Select a workspace where you are an active owner or cashier to update data-health reviews.");
    const { userId, business } = current;
    if (!validDay(args.from) || !validDay(args.toExclusive) || args.from >= args.toExclusive || !/^[a-z0-9-]{3,80}$/.test(args.issueId) || !Number.isSafeInteger(args.amountUgx) || args.issueKey !== `${args.from}:${args.toExclusive}:${args.issueId}:${args.amountUgx}`) throw new Error("The issue reference is invalid or has expired.");
    const note = args.note.trim();
    if (note.length > 500) throw new Error("Review notes must be 500 characters or fewer.");
    const prior = await ctx.db.query("issueReviews").withIndex("by_business_and_issue", q => q.eq("businessId", business._id).eq("issueKey", args.issueKey)).unique();
    if (prior?.updatedAt !== (args.expectedUpdatedAt ?? undefined)) throw new Error("This issue changed after you opened it. Its latest review has been loaded; review the new status before saving again.");
    if (current.membership.role !== "owner" && args.assignedTo !== prior?.assignedTo && args.assignedTo !== userId && prior?.assignedTo !== userId) throw new Error("Cashiers can assign an issue only to themselves or preserve its current assignment.");
    if (args.assignedTo) {
      const assigneeMembership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", business._id).eq("userId", args.assignedTo!)).unique();
      const preservingAssignment = prior?.assignedTo === args.assignedTo;
      if (!preservingAssignment && (!assigneeMembership?.active || (assigneeMembership.role !== "owner" && assigneeMembership.role !== "cashier"))) throw new Error("Assign this issue to an active owner or cashier.");
      if (current.membership.role !== "owner" && args.assignedTo !== userId && !preservingAssignment) throw new Error("Cashiers can assign an issue only to themselves or preserve its current assignment.");
    }
    const now = Date.now();
    if (prior) await ctx.db.patch("issueReviews", prior._id, { status: args.status, note: note || undefined, assignedTo: args.assignedTo, updatedBy: userId, updatedAt: now });
    else await ctx.db.insert("issueReviews", { businessId: business._id, issueKey: args.issueKey, issueId: args.issueId, status: args.status, note: note || undefined, assignedTo: args.assignedTo, updatedBy: userId, updatedAt: now, createdAt: now });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "issue.review_updated", entityType: "issueReview", entityId: args.issueKey, occurredAt: now, summary: `${args.issueId} issue review set to ${args.status}${args.assignedTo ? ` and assigned to ${args.assignedTo}` : ""}.`, details: JSON.stringify({ before: prior ? { status: prior.status, note: prior.note, assignedTo: prior.assignedTo } : null, after: { status: args.status, note: note || undefined, assignedTo: args.assignedTo } }) });
    return null;
  },
});
