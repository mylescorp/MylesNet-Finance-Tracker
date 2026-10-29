import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasPermission } from "./accessControl";

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

async function ledgerDailyTotals(ctx: QueryCtx, businessId: Id<"businesses">, from: string, toExclusive: string, account?: "cash" | "mobile_money" | "unallocated") {
  let salesQuery = ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", businessId).eq("kind", "sale").gte("occurredOn", from).lt("occurredOn", toExclusive));
  let expensesQuery = ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", businessId).eq("kind", "expense").gte("occurredOn", from).lt("occurredOn", toExclusive));
  if (account) {
    salesQuery = salesQuery.filter(q => q.eq(q.field("account"), account));
    expensesQuery = expensesQuery.filter(q => q.eq(q.field("account"), account));
  }
  const [sales, expenses] = await Promise.all([
    salesQuery.take(5001),
    expensesQuery.take(1001),
  ]);
  const byDay = new Map<string, { salesUgx: number; expensesUgx: number; saleCount: number; expenseCount: number }>();
  const add = (day: string, kind: "sale" | "expense", amountUgx: number) => {
    const totals = byDay.get(day) ?? { salesUgx: 0, expensesUgx: 0, saleCount: 0, expenseCount: 0 };
    if (kind === "sale") {
      totals.salesUgx = safeAdd(totals.salesUgx, amountUgx, "Account-filtered sales");
      totals.saleCount += 1;
    } else {
      totals.expensesUgx = safeAdd(totals.expensesUgx, amountUgx, "Account-filtered expenses");
      totals.expenseCount += 1;
    }
    byDay.set(day, totals);
  };
  for (const entry of sales) if (entry.state === "posted") add(entry.occurredOn, "sale", entry.amountUgx);
  for (const entry of expenses) if (entry.state === "posted") add(entry.occurredOn, "expense", entry.amountUgx);
  return {
    rows: [...byDay].map(([day, totals]) => ({ day, ...totals })),
    salesEntries: sales.filter(entry => entry.state === "posted"),
    expenseEntries: expenses.filter(entry => entry.state === "posted"),
    salesComplete: sales.length < 5001,
    expensesComplete: expenses.length < 1001,
  };
}

export const overview = query({
  args: { businessId: v.id("businesses"), from: v.string(), toExclusive: v.string(), today: v.string(), account: v.optional(v.union(v.literal("cash"), v.literal("mobile_money"), v.literal("unallocated"))) },
  handler: async (ctx, args) => {
    if (!validDay(args.from) || !validDay(args.toExclusive) || !validDay(args.today) || args.from >= args.toExclusive || args.toExclusive > shiftDay(args.today, 1)) throw new Error("Choose a valid reporting range that ends no later than today.");
    const rangeLength = (Date.parse(`${args.toExclusive}T00:00:00.000Z`) - Date.parse(`${args.from}T00:00:00.000Z`)) / 86_400_000;
    if (rangeLength > 370) throw new Error("Choose a reporting period of 370 days or less.");
    const callerId = await getAuthUserId(ctx);
    const callerMembership = callerId ? await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", args.businessId).eq("userId", callerId)).unique() : null;
    const requestedBusiness = callerMembership?.active ? await ctx.db.get("businesses", args.businessId) : null;
    const current = callerId && callerMembership && requestedBusiness ? { userId: callerId, membership: callerMembership, business: requestedBusiness } : null;
    if (!current || current.business.dataResetting) return { access: "pending" as const };
    const { membership, business } = current;
    if (!(await hasPermission(ctx, membership, "analytics.view"))) return { access: "restricted" as const };

    const month = monthBounds(args.today);
    const runwayFrom = shiftDay(args.today, -29);
    const weakFrom = shiftDay(args.today, -13);
    const next30 = shiftDay(args.today, 30);
    const [canViewAudit, canViewMovement, canViewSavings, canViewLoans, canViewBills, canViewPartners] = await Promise.all([
      hasPermission(ctx, membership, "audit.view"),
      hasPermission(ctx, membership, "movements.view"),
      hasPermission(ctx, membership, "savings.view"),
      hasPermission(ctx, membership, "loans.view"),
      hasPermission(ctx, membership, "bills.view"),
      hasPermission(ctx, membership, "partners.view"),
    ]);
    const accountRecentFrom = month.from < runwayFrom ? month.from : runwayFrom;
    const [preferences, periodData, recentData, balances, partners, reconciliations, movements, distributions, savingsHoldings, activeLoans, upcomingBills, recentAudit, latestReset] = await Promise.all([
      ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", business._id)).unique(),
      ledgerDailyTotals(ctx, business._id, args.from, args.toExclusive, args.account),
      ledgerDailyTotals(ctx, business._id, accountRecentFrom, shiftDay(args.today, 1), args.account),
      ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", business._id)).take(2),
      ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", business._id).eq("active", true)).take(101),
      ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", business._id).gte("asOfDate", shiftDay(args.today, -89)).lte("asOfDate", args.today)).take(101),
      canViewMovement ? ctx.db.query("movements").withIndex("by_business_and_date", q => q.eq("businessId", business._id).gte("occurredOn", month.from).lte("occurredOn", args.today)).take(501) : Promise.resolve([]),
      canViewPartners ? ctx.db.query("partnerDistributions").withIndex("by_business_and_period_start", q => q.eq("businessId", business._id)).order("desc").take(201) : Promise.resolve([]),
      canViewSavings ? ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", business._id).eq("active", true)).take(101) : Promise.resolve([]),
      canViewLoans ? ctx.db.query("loans").withIndex("by_business_and_status", q => q.eq("businessId", business._id).eq("status", "active")).take(101) : Promise.resolve([]),
      canViewBills ? ctx.db.query("bills").withIndex("by_business_and_active_due", q => q.eq("businessId", business._id).eq("active", true).lte("nextDueOn", next30)).take(101) : Promise.resolve([]),
      canViewAudit ? ctx.db.query("auditEvents").withIndex("by_business_and_time", q => q.eq("businessId", business._id)).order("desc").take(6) : Promise.resolve([]),
      ctx.db.query("workspaceDataResets").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").first(),
    ]);
    const scopedPeriodRows = periodData.rows;
    const scopedRecentRows = recentData.rows;
    const scopedSalesEntries = periodData.salesEntries;
    const scopedExpenseEntries = periodData.expenseEntries;
    const scopedPeriodSalesComplete = periodData.salesComplete;
    const scopedPeriodExpensesComplete = periodData.expensesComplete;
    const scopedPeriodComplete = scopedPeriodSalesComplete && scopedPeriodExpensesComplete;
    const scopedRecentComplete = recentData.salesComplete && recentData.expensesComplete;
    const scopedMonthRows = scopedRecentRows.filter(row => row.day >= month.from);
    const scopedRunwayRows = scopedRecentRows.filter(row => row.day >= runwayFrom);
    const scopedWeakRows = scopedRecentRows.filter(row => row.day >= weakFrom);
    if (partners.length > 100) throw new Error("This workspace has more active partner records than analytics can safely summarize.");

    const byDay = new Map(scopedPeriodRows.map(row => [row.day, row]));
    const days = Array.from({ length: rangeLength }, (_, index) => {
      const day = shiftDay(args.from, index);
      const row = byDay.get(day);
      return { day, salesUgx: row?.salesUgx ?? 0, expensesUgx: row?.expensesUgx ?? 0, hasActivity: Boolean(row && (row.saleCount || row.expenseCount)) };
    });
    const salesUgx = scopedPeriodRows.reduce((sum, row) => safeAdd(sum, row.salesUgx, "Sales total"), 0);
    const expensesUgx = scopedPeriodRows.reduce((sum, row) => safeAdd(sum, row.expensesUgx, "Expense total"), 0);
    const netUgx = safeAdd(salesUgx, -expensesUgx, "Cashbook net");
    const workspaceCashUgx = balances.find(row => row.account === "cash")?.balanceUgx ?? 0;
    const workspaceMobileMoneyUgx = balances.find(row => row.account === "mobile_money")?.balanceUgx ?? 0;
    const cashUgx = (!args.account || args.account === "cash") ? workspaceCashUgx : 0;
    const mobileUgx = (!args.account || args.account === "mobile_money") ? workspaceMobileMoneyUgx : 0;
    const liquidUgx = safeAdd(cashUgx, mobileUgx, "Liquid balance");
    const monthSales = scopedMonthRows.reduce((sum, row) => safeAdd(sum, row.salesUgx, "Month sales"), 0);
    const monthExpenses = scopedMonthRows.reduce((sum, row) => safeAdd(sum, row.expensesUgx, "Month expenses"), 0);
    const runwayExpenses = scopedRunwayRows.reduce((sum, row) => safeAdd(sum, row.expensesUgx, "Recent expenses"), 0);
    const observationStart = latestReset?.completedAt ?? business.createdAt;
    const observationStartDay = new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(observationStart);
    const earliestLedgerDay = recentData.expenseEntries.reduce<string | null>((earliest, entry) => !earliest || entry.occurredOn < earliest ? entry.occurredOn : earliest, null);
    const availableDataStartDay = earliestLedgerDay && earliestLedgerDay < observationStartDay ? earliestLedgerDay : observationStartDay;
    const observedCalendarDays = Math.max(1, Math.floor((Date.parse(`${args.today}T00:00:00.000Z`) - Date.parse(`${availableDataStartDay}T00:00:00.000Z`)) / 86_400_000) + 1);
    const runwayWindowDays = Math.min(30, observedCalendarDays);
    const dailyBurnUgx = Math.round(runwayExpenses / runwayWindowDays);
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
    })).sort((a, b) => b.ownershipBps - a.ownershipBps);
    const leadingPartners = partnerSnapshot.slice(0, 3);
    const remainingPartners = partnerSnapshot.slice(3);
    const partnerChart = remainingPartners.length ? [
      ...leadingPartners,
      {
        id: "other-partners",
        name: `Other partners (${remainingPartners.length})`,
        ownershipBps: remainingPartners.reduce((sum, partner) => safeAdd(sum, partner.ownershipBps, "Other partner ownership"), 0),
        active: true,
        existedAtPeriodEnd: true,
        shareOfNetUgx: remainingPartners.reduce((sum, partner) => safeAdd(sum, partner.shareOfNetUgx, "Other partner net share"), 0),
      },
    ] : leadingPartners;
    const monthComplete = scopedRecentComplete;
    const cashRunwayComplete = (!args.account || args.account === "cash") && scopedRecentComplete;

    const issues: { id: string; title: string; detail: string; severity: "review" | "warning" | "action"; href: string; amountUgx: number }[] = [];
    const weakDays = scopedRecentComplete ? scopedWeakRows.filter(row => row.salesUgx > 0 && row.salesUgx < weakThreshold) : [];
    for (const row of weakDays.slice(0, 7)) issues.push({ id: `weak-${row.day}`, title: "Low-sales day", detail: `${row.day}: recorded sales are below the workspace review threshold. Confirm the day is complete.`, severity: "review", href: "/analytics", amountUgx: row.salesUgx });
    const recentSales = new Set(scopedWeakRows.filter(row => row.salesUgx > 0).map(row => row.day));
    const recentActivityExists = scopedWeakRows.some(row => row.saleCount > 0 || row.expenseCount > 0);
    if (recentActivityExists && scopedRecentComplete) {
      const missingDays = Array.from({ length: 14 }, (_, index) => shiftDay(weakFrom, index)).filter(day => day <= args.today && !recentSales.has(day));
      if (missingDays.length > 0) issues.push({ id: "missing-sales-days", title: "Days with no sales entry", detail: `${missingDays.length} of the last 14 days have no recorded sales. Check whether those were closed days or missing entries.`, severity: "review", href: "/sales", amountUgx: missingDays.length });
    }
    const unallocated = scopedSalesEntries.filter(row => row.state === "posted" && row.account === "unallocated");
    const unallocatedUgx = unallocated.reduce((sum, row) => safeAdd(sum, row.amountUgx, "Unallocated sales"), 0);
    const unallocatedComplete = scopedPeriodSalesComplete;
    if (unallocatedUgx > 0) issues.push({ id: "unallocated-sales", title: "Sales need account allocation", detail: unallocatedComplete ? `${unallocated.length} sales totaling ${displayMoney(unallocatedUgx)} are not assigned to cash or mobile money.` : `At least ${unallocated.length} unallocated sales were found; narrow the period to review all records.`, severity: "action", href: "/sales", amountUgx: unallocatedUgx });
    const cashThresholdEnabled = lowCashThreshold > 0;
    const workspaceLiquidUgx = safeAdd(workspaceCashUgx, workspaceMobileMoneyUgx, "Workspace liquid balance");
    if (cashThresholdEnabled && workspaceLiquidUgx < lowCashThreshold) issues.push({ id: "low-cash", title: "Cash is below the alert threshold", detail: `Recorded cash and mobile money total ${displayMoney(workspaceLiquidUgx)}; configured threshold is ${displayMoney(lowCashThreshold)}.`, severity: "warning", href: "/settings/rules", amountUgx: workspaceLiquidUgx });
    if (scopedRecentComplete && salesTarget > 0 && month.elapsedDays < month.daysInMonth && monthSales < Math.ceil(salesTarget * month.elapsedDays / month.daysInMonth)) issues.push({ id: "sales-target-pace", title: "Behind monthly sales pace", detail: `Month-to-date sales of ${displayMoney(monthSales)} are below the straight-line pace for the ${displayMoney(salesTarget)} target.`, severity: "warning", href: "/settings/rules", amountUgx: monthSales });
    const openReconciliations = reconciliations.filter(row => row.status === "open");
    const postedWithdrawals = movements.filter(row => row.kind === "withdrawal" && row.state === "posted" && (!args.account || row.fromAccount === args.account));
    const withdrawalTotalUgx = postedWithdrawals.reduce((sum, row) => safeAdd(sum, row.amountUgx, "Centipid withdrawals"), 0);
    const pendingPayouts = distributions.filter(row => row.status === "approved" || row.status === "partially_paid");
    const payoutBalanceUgx = pendingPayouts.reduce((sum, row) => safeAdd(sum, Math.max(0, row.distributionUgx - row.paidUgx), "Unpaid partner distributions"), 0);
    const savingsTotalUgx = savingsHoldings.reduce((sum, row) => safeAdd(sum, row.balanceUgx, "Savings balance"), 0);
    const activeLoanTotalUgx = activeLoans.reduce((sum, row) => safeAdd(sum, row.outstandingPrincipalUgx, "Outstanding loan principal"), 0);
    const netRecordedPositionComplete = canViewSavings && savingsHoldings.length < 101 && canViewLoans && activeLoans.length < 101;
    const netRecordedPositionUgx = safeAdd(safeAdd(liquidUgx, savingsTotalUgx, "Recorded wealth"), -activeLoanTotalUgx, "Net recorded position");
    const estimatedMonthlyLoanPaymentsUgx = activeLoans.reduce((sum, row) => {
      const monthlyRate = row.annualRateBps / 10000 / 12;
      const payment = monthlyRate === 0
        ? row.principalUgx / row.termMonths
        : row.principalUgx * monthlyRate / (1 - Math.pow(1 + monthlyRate, -row.termMonths));
      return safeAdd(sum, Math.round(payment), "Estimated monthly loan payments");
    }, 0);
    const byCategory = (rows: typeof scopedSalesEntries, denominator: number, complete: boolean) => {
      const totals = new Map<string, { amountUgx: number; count: number }>();
      for (const row of rows) if (row.state === "posted") {
        const key = row.category.trim() || "Uncategorized";
        const current = totals.get(key) ?? { amountUgx: 0, count: 0 };
        current.amountUgx = safeAdd(current.amountUgx, row.amountUgx, "Category total");
        current.count += 1;
        totals.set(key, current);
      }
      const ranked = [...totals].map(([category, value]) => ({ category, ...value })).sort((a, b) => b.amountUgx - a.amountUgx).slice(0, 5);
      return { rows: ranked.map(row => ({ ...row, shareBps: denominator > 0 ? Math.round(row.amountUgx / denominator * 10000) : 0 })), complete };
    };
    const salesCategories = byCategory(scopedSalesEntries, salesUgx, scopedPeriodSalesComplete);
    const expenseCategories = byCategory(scopedExpenseEntries, expensesUgx, scopedPeriodExpensesComplete);
    if (openReconciliations.length > 0) issues.push({ id: "open-reconciliations", title: "Reconciliation differences need review", detail: `${openReconciliations.length}${reconciliations.length === 101 ? " or more" : ""} open account differences were recorded in the last 90 days.`, severity: "action", href: "/reconcile", amountUgx: openReconciliations.reduce((sum, row) => safeAdd(sum, Math.abs(row.varianceUgx), "Reconciliation differences"), 0) });
    const largeExpenses = scopedExpenseEntries.filter(row => row.state === "posted" && row.amountUgx >= (preferences?.highExpenseReviewUgx ?? 500000 * currencyScale));
    if (largeExpenses.length > 0) issues.push({ id: "high-expense-review", title: "Large expenses to review", detail: `${largeExpenses.length}${!scopedPeriodExpensesComplete ? " or more" : ""} posted expenses crossed the configured review threshold.`, severity: "review", href: "/expenses", amountUgx: largeExpenses.reduce((sum, row) => safeAdd(sum, row.amountUgx, "Large expenses"), 0) });
    const expenseWarning = preferences?.monthlyExpenseWarningUgx ?? 0;
    if (scopedRecentComplete && expenseWarning > 0 && monthExpenses > expenseWarning) issues.push({ id: "monthly-expense-warning", title: "Monthly expenses crossed the warning level", detail: `Recorded month-to-date expenses are ${displayMoney(monthExpenses)} against a ${displayMoney(expenseWarning)} warning level.`, severity: "warning", href: "/expenses", amountUgx: monthExpenses });
    if (partners.length > 0 && !ownershipComplete) issues.push({ id: "ownership-incomplete", title: "Partner ownership does not total 100%", detail: `Active ownership currently totals ${(ownershipBps / 100).toFixed(2)}%. Partner profit shares are withheld until ownership is complete.`, severity: "warning", href: "/partners", amountUgx: ownershipBps });

    const reviewers = (await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", business._id)).take(100))
      .filter(row => row.active && (row.role === "owner" || row.role === "cashier"));
    const canReviewOthers = await hasPermission(ctx, membership, "access.manage");
    const visibleReviewers = canReviewOthers ? reviewers : reviewers.filter(row => row.userId === current.userId);
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
      target: { amountUgx: salesTarget, weeklyAmountUgx: Math.round(salesTarget * 7 / month.daysInMonth), monthPaceRequiredUgx: Math.ceil(salesTarget * month.elapsedDays / month.daysInMonth), monthComplete, monthSalesUgx: monthSales, monthExpensesUgx: monthExpenses, monthNetUgx: monthSales - monthExpenses, elapsedDays: month.elapsedDays, daysInMonth: month.daysInMonth, projectedSalesUgx: Math.round(monthSales / Math.max(1, month.elapsedDays) * month.daysInMonth), requiredSalesPerDayUgx: Math.ceil(Math.max(0, salesTarget - monthSales) / Math.max(1, month.daysInMonth - month.elapsedDays)) },
      balances: { cashUgx, mobileMoneyUgx: mobileUgx, totalUgx: liquidUgx, cashShareBps: liquidUgx > 0 ? Math.round(cashUgx / liquidUgx * 10000) : 0, mobileShareBps: liquidUgx > 0 ? Math.round(mobileUgx / liquidUgx * 10000) : 0, lowCashThresholdUgx: lowCashThreshold },
      runway: { trailingDays: runwayWindowDays, expensesUgx: runwayExpenses, averageDailyExpenseUgx: dailyBurnUgx, days: dailyBurnUgx > 0 ? Math.max(0, Math.floor(liquidUgx / dailyBurnUgx)) : null },
      dashboardCards: {
        cashRunwayDays: cashRunwayComplete && dailyBurnUgx > 0 ? Math.max(0, Math.floor(cashUgx / dailyBurnUgx)) : null,
        cashRunwayComplete,
        netRecordedPositionUgx,
        netRecordedPositionComplete,
        dailyExpenseUgx: dailyBurnUgx,
        withdrawalTotalUgx,
        withdrawalCount: postedWithdrawals.length,
        withdrawalComplete: canViewMovement && movements.length < 501,
        lastWithdrawalOn: postedWithdrawals.reduce<string | null>((latest, row) => !latest || row.occurredOn > latest ? row.occurredOn : latest, null),
        reconciliationCount: openReconciliations.length,
        reconciliationDifferenceUgx: openReconciliations.reduce((sum, row) => safeAdd(sum, Math.abs(row.varianceUgx), "Reconciliation differences"), 0),
        reconciliationComplete: reconciliations.length < 101,
        payoutBalanceUgx,
        payoutCount: pendingPayouts.length,
        payoutsComplete: canViewPartners && distributions.length < 201,
        savingsTotalUgx,
        savingsComplete: canViewSavings && savingsHoldings.length < 101,
        activeLoanTotalUgx,
        activeLoanCount: activeLoans.length,
        estimatedMonthlyLoanPaymentsUgx,
        loansComplete: canViewLoans && activeLoans.length < 101,
        salesCategories,
        expenseCategories,
        upcomingBills: canViewBills ? upcomingBills.slice(0, 6).map(row => ({ name: row.name, amountUgx: row.amountUgx, nextDueOn: row.nextDueOn, category: row.category, overdue: row.nextDueOn < args.today })) : [],
        upcomingBillsComplete: canViewBills && upcomingBills.length < 101,
        recentAudit: await Promise.all(recentAudit.map(async row => {
          const [user, profile] = await Promise.all([ctx.db.get("users", row.actorId), ctx.db.query("userProfiles").withIndex("by_user", q => q.eq("userId", row.actorId)).unique()]);
          return { id: row._id, summary: row.summary, occurredAt: row.occurredAt, actor: profile?.displayName?.trim() || user?.email || "Workspace member" };
        })),
        auditAvailable: canViewAudit,
      },
      partners: partnerSnapshot,
      partnerChartComplete: scopedPeriodComplete,
      partnerChart,
      ownershipComplete,
      unallocated: { count: unallocated.length, amountUgx: unallocatedUgx, complete: unallocatedComplete },
      issues: issueRows,
      reviewers: reviewerOptions,
      recentActivityComplete: scopedRecentComplete,
      issuesComplete: reconciliations.length < 101 && scopedPeriodComplete && scopedRecentComplete,
      periodActivity: { salesRowsComplete: scopedPeriodSalesComplete, expenseRowsComplete: scopedPeriodExpensesComplete },
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
    const business = membership?.active ? await ctx.db.get("businesses", args.businessId) : null;
    if (!membership?.active || !business || business.dataResetting || !(await hasPermission(ctx, membership, "reports.view"))) throw new Error("Your role cannot review the workspace issue queue while the workspace is resetting.");
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
    if (!current || current.business.dataResetting || !(await hasPermission(ctx, current.membership, "reports.view"))) throw new Error("Your role cannot update data-health reviews while the workspace is resetting.");
    const { userId, business } = current;
    if (!validDay(args.from) || !validDay(args.toExclusive) || args.from >= args.toExclusive || !/^[a-z0-9-]{3,80}$/.test(args.issueId) || !Number.isSafeInteger(args.amountUgx) || args.issueKey !== `${args.from}:${args.toExclusive}:${args.issueId}:${args.amountUgx}`) throw new Error("The issue reference is invalid or has expired.");
    const note = args.note.trim();
    if (note.length > 500) throw new Error("Review notes must be 500 characters or fewer.");
    const prior = await ctx.db.query("issueReviews").withIndex("by_business_and_issue", q => q.eq("businessId", business._id).eq("issueKey", args.issueKey)).unique();
    if (prior?.updatedAt !== (args.expectedUpdatedAt ?? undefined)) throw new Error("This issue changed after you opened it. Its latest review has been loaded; review the new status before saving again.");
    const canAssignOthers = await hasPermission(ctx, current.membership, "access.manage");
    if (!canAssignOthers && args.assignedTo !== prior?.assignedTo && args.assignedTo !== userId && prior?.assignedTo !== userId) throw new Error("Your role can assign issues only to yourself or preserve the current assignment.");
    if (args.assignedTo) {
      const assigneeMembership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", business._id).eq("userId", args.assignedTo!)).unique();
      const preservingAssignment = prior?.assignedTo === args.assignedTo;
      if (!preservingAssignment && (!assigneeMembership?.active || !(await hasPermission(ctx, assigneeMembership, "reports.view")))) throw new Error("Assign this issue to an active member with report access.");
      if (!canAssignOthers && args.assignedTo !== userId && !preservingAssignment) throw new Error("Your role can assign issues only to yourself or preserve the current assignment.");
    }
    const now = Date.now();
    if (prior) await ctx.db.patch("issueReviews", prior._id, { status: args.status, note: note || undefined, assignedTo: args.assignedTo, updatedBy: userId, updatedAt: now });
    else await ctx.db.insert("issueReviews", { businessId: business._id, issueKey: args.issueKey, issueId: args.issueId, status: args.status, note: note || undefined, assignedTo: args.assignedTo, updatedBy: userId, updatedAt: now, createdAt: now });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "issue.review_updated", entityType: "issueReview", entityId: args.issueKey, occurredAt: now, summary: `${args.issueId} issue review set to ${args.status}${args.assignedTo ? ` and assigned to ${args.assignedTo}` : ""}.`, details: JSON.stringify({ before: prior ? { status: prior.status, note: prior.note, assignedTo: prior.assignedTo } : null, after: { status: args.status, note: note || undefined, assignedTo: args.assignedTo } }) });
    return null;
  },
});
