import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasPermission } from "./accessControl";
import { getSelectedWorkspace } from "./workspaceContext";
import { getAuthUserId } from "@convex-dev/auth/server";

type Ctx = MutationCtx | QueryCtx;
type Account = "cash" | "mobile_money";

function safeAdd(a: number, b: number, label: string) {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is outside the supported amount range.`);
  return value;
}

function assertSameRequest(matches: boolean) {
  if (!matches) throw new Error("This request key was already used for different transaction details. Refresh the form and review the saved record.");
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function dayInZone(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
}

async function workspace(ctx: Ctx, businessId?: Id<"businesses">) {
  if (!businessId) return await getSelectedWorkspace(ctx);
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  if (!membership?.active) return null;
  const business = await ctx.db.get("businesses", businessId);
  return business ? { userId, membership, business } : null;
}

async function accountBalance(ctx: MutationCtx, businessId: Id<"businesses">, account: Account) {
  return await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", account)).unique();
}

async function historicalPartnerCapital(ctx: Ctx, businessId: Id<"businesses">, partnerId: Id<"partners">) {
  const rows = await ctx.db.query("movements")
    .withIndex("by_business_and_partner_and_date", q => q.eq("businessId", businessId).eq("partnerId", partnerId))
    .take(5000);
  const total = rows.reduce((sum, row) => row.kind === "capital_contribution" && row.state === "posted" ? safeAdd(sum, row.amountUgx, "Partner capital contributions") : sum, 0);
  return { total, complete: rows.length < 5000 };
}

async function ownershipAtDay(ctx: Ctx, businessId: Id<"businesses">, partner: { _id: Id<"partners">; ownershipBps: number }, day: string) {
  const record = await ctx.db.query("partnerOwnershipHistory")
    .withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", businessId).eq("partnerId", partner._id).lte("effectiveOn", day))
    .order("desc").first();
  return record?.ownershipBps ?? partner.ownershipBps;
}

async function checkOutflow(ctx: MutationCtx, businessId: Id<"businesses">, account: Account, delta: number, confirmed: boolean) {
  const current = await accountBalance(ctx, businessId, account);
  if ((current?.balanceUgx ?? 0) + delta >= 0 || confirmed) return;
  const prefs = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", businessId)).unique();
  if (prefs?.negativeBalanceWarning !== false) {
    throw new ConvexError({ code: "CONFIRM_NEGATIVE", message: `This transaction will put ${account === "cash" ? "cash" : "mobile money"} below zero. Review the balance before continuing.` });
  }
}

async function applyAccountDelta(ctx: MutationCtx, businessId: Id<"businesses">, account: Account, delta: number) {
  const current = await accountBalance(ctx, businessId, account);
  const balanceUgx = safeAdd(current?.balanceUgx ?? 0, delta, "Account balance");
  if (current) await ctx.db.patch("accountBalances", current._id, { balanceUgx, updatedAt: Date.now() });
  else await ctx.db.insert("accountBalances", { businessId, account, balanceUgx, updatedAt: Date.now() });
}

async function postExpense(ctx: MutationCtx, args: {
  businessId: Id<"businesses">; userId: Id<"users">; amountUgx: number; occurredOn: string;
  account: Account; category: string; note: string; idempotencyKey: string; action: string;
  operationSource: "movement_fee" | "loan_interest" | "bill_payment"; operationKey: string;
}) {
  const previous = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", args.businessId).eq("idempotencyKey", args.idempotencyKey)).unique();
  if (previous) {
    assertSameRequest(previous.kind === "expense" && previous.amountUgx === args.amountUgx && previous.occurredOn === args.occurredOn && previous.account === args.account && previous.category === args.category && previous.note === args.note && previous.state === "posted" && previous.operationSource === args.operationSource && previous.operationKey === args.operationKey);
    return previous._id;
  }
  const entryId = await ctx.db.insert("entries", {
    businessId: args.businessId, kind: "expense", amountUgx: args.amountUgx, occurredOn: args.occurredOn,
    account: args.account, category: args.category, note: args.note, source: "manual", idempotencyKey: args.idempotencyKey,
    state: "posted", operationSource: args.operationSource, operationKey: args.operationKey, createdBy: args.userId, createdAt: Date.now(),
  });
  const day = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", args.businessId).eq("day", args.occurredOn)).unique();
  if (day) await ctx.db.patch("dailyTotals", day._id, {
    expensesUgx: safeAdd(day.expensesUgx, args.amountUgx, "Daily expenses"),
    expenseCount: safeAdd(day.expenseCount, 1, "Daily expense count"),
  });
  else await ctx.db.insert("dailyTotals", { businessId: args.businessId, day: args.occurredOn, salesUgx: 0, expensesUgx: args.amountUgx, saleCount: 0, expenseCount: 1 });
  await ctx.db.insert("auditEvents", { businessId: args.businessId, actorId: args.userId, action: args.action, entityType: "entry", entityId: entryId, occurredAt: Date.now(), summary: `${args.category} expense recorded: ${args.amountUgx} on ${args.occurredOn}.` });
  return entryId;
}

async function reverseLinkedExpense(ctx: MutationCtx, current: NonNullable<Awaited<ReturnType<typeof workspace>>>, idempotencyKey: string, operationKey: string, operationSource: "loan_interest" | "bill_payment", reason: string) {
  const entry = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", idempotencyKey)).unique();
  if (!entry || entry.state !== "posted" || entry.operationSource !== operationSource || entry.operationKey !== operationKey) throw new Error("The linked expense is missing or already changed. Reconcile its source record before reversing.");
  const day = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", entry.occurredOn)).unique();
  if (!day || day.expensesUgx < entry.amountUgx || day.expenseCount < 1) throw new Error("Daily expense totals need reconciliation before this payment can be reversed.");
  await ctx.db.patch("dailyTotals", day._id, { expensesUgx: safeAdd(day.expensesUgx, -entry.amountUgx, "Daily expenses"), expenseCount: safeAdd(day.expenseCount, -1, "Daily expense count") });
  const now = Date.now();
  await ctx.db.patch("entries", entry._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: reason });
  await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: `${operationSource}.reversed`, entityType: "entry", entityId: entry._id, occurredAt: now, summary: reason });
}

async function audit(ctx: MutationCtx, current: NonNullable<Awaited<ReturnType<typeof workspace>>>, action: string, entityType: string, entityId: string, summary: string, details?: string) {
  await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action, entityType, entityId, occurredAt: Date.now(), summary, details });
}

const accountV = v.union(v.literal("cash"), v.literal("mobile_money"));
const membershipRoleV = v.string();

export const overview = query({
  args: { businessId: v.id("businesses"), from: v.string(), toExclusive: v.string() },
  returns: v.union(
    v.object({ access: v.literal("pending") }),
    v.object({ access: v.literal("restricted") }),
    v.object({
      access: v.literal("ready"), businessId: v.id("businesses"), role: membershipRoleV,
      movements: v.array(v.object({ _id: v.id("movements"), kind: v.union(v.literal("transfer"), v.literal("withdrawal"), v.literal("deposit"), v.literal("capital_contribution")), amountUgx: v.number(), feeUgx: v.optional(v.number()), fromAccount: v.optional(accountV), toAccount: v.optional(accountV), partnerName: v.optional(v.string()), occurredOn: v.string(), note: v.string(), state: v.union(v.literal("posted"), v.literal("void")), voidReason: v.optional(v.string()) })),
      savings: v.array(v.object({ _id: v.id("savingsHoldings"), name: v.string(), targetUgx: v.optional(v.number()), balanceUgx: v.number(), active: v.boolean() })),
      savingsFlows: v.array(v.object({ _id: v.id("savingsFlows"), holdingName: v.string(), kind: v.union(v.literal("contribution"), v.literal("withdrawal")), amountUgx: v.number(), account: accountV, occurredOn: v.string(), note: v.string(), state: v.union(v.literal("posted"), v.literal("void")), voidReason: v.optional(v.string()), canReverse: v.boolean() })),
      loans: v.array(v.object({ _id: v.id("loans"), lender: v.string(), principalUgx: v.number(), outstandingPrincipalUgx: v.number(), annualRateBps: v.number(), termMonths: v.number(), startedOn: v.string(), account: accountV, status: v.union(v.literal("active"), v.literal("paid_off")) })),
      loanRepayments: v.array(v.object({ _id: v.id("loanRepayments"), lender: v.string(), amountUgx: v.number(), principalUgx: v.number(), interestUgx: v.number(), account: accountV, paidOn: v.string(), state: v.union(v.literal("posted"), v.literal("void")), voidReason: v.optional(v.string()) })),
      bills: v.array(v.object({ _id: v.id("bills"), name: v.string(), category: v.string(), amountUgx: v.number(), account: accountV, recurrence: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("yearly")), nextDueOn: v.string(), active: v.boolean() })),
      billPayments: v.array(v.object({ _id: v.id("billPayments"), billName: v.string(), amountUgx: v.number(), account: v.optional(accountV), paidOn: v.string(), state: v.union(v.literal("posted"), v.literal("void")), voidReason: v.optional(v.string()), canReverse: v.boolean() })),
      reconciliations: v.array(v.object({ _id: v.id("reconciliations"), account: accountV, asOfDate: v.string(), bookBalanceUgx: v.number(), countedBalanceUgx: v.number(), varianceUgx: v.number(), status: v.union(v.literal("matched"), v.literal("open"), v.literal("explained"), v.literal("superseded")), note: v.string(), explanation: v.optional(v.string()), supersedesId: v.optional(v.id("reconciliations")) })),
      partners: v.array(v.object({ _id: v.id("partners"), name: v.string(), ownershipBps: v.number(), active: v.boolean() })),
    }),
  ),
  handler: async (ctx, args) => {
    if (!validDay(args.from) || !validDay(args.toExclusive) || args.from >= args.toExclusive) throw new Error("Choose a valid reporting date range.");
    const current = await workspace(ctx, args.businessId);
    if (!current) return { access: "pending" as const };
    const [canViewMovements, canViewSavings, canViewLoans, canViewBills, canViewReconciliation, canViewPartners] = await Promise.all([
      hasPermission(ctx, current.membership, "movements.view"),
      hasPermission(ctx, current.membership, "savings.view"),
      hasPermission(ctx, current.membership, "loans.view"),
      hasPermission(ctx, current.membership, "bills.view"),
      hasPermission(ctx, current.membership, "reconcile.view"),
      hasPermission(ctx, current.membership, "partners.view"),
    ]);
    if (![canViewMovements, canViewSavings, canViewLoans, canViewBills, canViewReconciliation, canViewPartners].some(Boolean)) return { access: "restricted" as const };
    const businessId = current.business._id;
    const [movements, savings, savingsFlows, loans, loanRepayments, bills, billPayments, reconciliations, partners] = await Promise.all([
      ctx.db.query("movements").withIndex("by_business_and_date", q => q.eq("businessId", businessId).gte("occurredOn", args.from).lt("occurredOn", args.toExclusive)).order("desc").take(100),
      ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", businessId).eq("active", true)).take(101),
      ctx.db.query("savingsFlows").withIndex("by_business_and_date", q => q.eq("businessId", businessId).gte("occurredOn", args.from).lt("occurredOn", args.toExclusive)).order("desc").take(100),
      ctx.db.query("loans").withIndex("by_business_and_status", q => q.eq("businessId", businessId).eq("status", "active")).take(101),
      ctx.db.query("loanRepayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId).gte("paidOn", args.from).lt("paidOn", args.toExclusive)).order("desc").take(100),
      ctx.db.query("bills").withIndex("by_business_and_active_due", q => q.eq("businessId", businessId).eq("active", true)).take(101),
      ctx.db.query("billPayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId).gte("paidOn", args.from).lt("paidOn", args.toExclusive)).order("desc").take(100),
      ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", businessId).gte("asOfDate", args.from).lt("asOfDate", args.toExclusive)).order("desc").take(100),
      ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", businessId).eq("active", true)).take(101),
    ]);
    const businessToday = dayInZone(Date.now(), current.business.timezone);
    const currentPartnerShares = await Promise.all(partners.map(async partner => {
      const history = await ctx.db.query("partnerOwnershipHistory")
        .withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", businessId).eq("partnerId", partner._id).lte("effectiveOn", businessToday))
        .order("desc").first();
      return { ...partner, ownershipBps: history?.ownershipBps ?? partner.ownershipBps };
    }));
    const partnerById = new Map(partners.map(p => [p._id, p.name]));
    const savingsFlowHoldings = await Promise.all(savingsFlows.map(row => ctx.db.get("savingsHoldings", row.holdingId)));
    const holdingById = new Map(savingsFlowHoldings.flatMap(item => item?.businessId === businessId ? [[item._id, { name: item.name, active: item.active }] as const] : []));
    const loanById = new Map(loans.map(item => [item._id, item.lender]));
    const repaymentLoans = await Promise.all(loanRepayments.map(row => ctx.db.get("loans", row.loanId)));
    repaymentLoans.forEach(loan => {
      if (loan?.businessId === businessId) loanById.set(loan._id, loan.lender);
    });
    const paymentBills = await Promise.all(billPayments.map(row => ctx.db.get("bills", row.billId)));
    const billById = new Map(paymentBills.flatMap(item => item?.businessId === businessId ? [[item._id, item] as const] : []));
    return {
      access: "ready" as const, businessId: current.business._id, role: current.membership.role,
      movements: canViewMovements ? movements.map(row => ({ _id: row._id, kind: row.kind, amountUgx: row.amountUgx, feeUgx: row.feeUgx, fromAccount: row.fromAccount, toAccount: row.toAccount, partnerName: row.partnerId ? partnerById.get(row.partnerId) : undefined, occurredOn: row.occurredOn, note: row.note, state: row.state, voidReason: row.voidReason })) : [],
      savings: canViewSavings ? savings.map(row => ({ _id: row._id, name: row.name, targetUgx: row.targetUgx, balanceUgx: row.balanceUgx, active: row.active })) : [],
      savingsFlows: canViewSavings ? savingsFlows.map(row => { const holding = holdingById.get(row.holdingId); return { _id: row._id, holdingName: holding?.name ?? "Inactive holding", kind: row.kind, amountUgx: row.amountUgx, account: row.account, occurredOn: row.occurredOn, note: row.note, state: row.state ?? "posted", voidReason: row.voidReason, canReverse: holding?.active === true }; }) : [],
      loans: canViewLoans ? loans.map(row => ({ _id: row._id, lender: row.lender, principalUgx: row.principalUgx, outstandingPrincipalUgx: row.outstandingPrincipalUgx, annualRateBps: row.annualRateBps, termMonths: row.termMonths, startedOn: row.startedOn, account: row.account, status: row.status })) : [],
      loanRepayments: canViewLoans ? loanRepayments.map(row => ({ _id: row._id, lender: loanById.get(row.loanId) ?? "Loan", amountUgx: row.amountUgx, principalUgx: row.principalUgx, interestUgx: row.interestUgx, account: row.account, paidOn: row.paidOn, state: row.state ?? "posted", voidReason: row.voidReason })) : [],
      bills: canViewBills ? bills.map(row => ({ _id: row._id, name: row.name, category: row.category, amountUgx: row.amountUgx, account: row.account, recurrence: row.recurrence, nextDueOn: row.nextDueOn, active: row.active })) : [],
      billPayments: canViewBills ? billPayments.map(row => { const bill = billById.get(row.billId); return { _id: row._id, billName: bill?.name ?? "Inactive bill", amountUgx: row.amountUgx, account: row.account, paidOn: row.paidOn, state: row.state ?? "posted", voidReason: row.voidReason, canReverse: row.state !== "void" && !!row.priorNextDueOn && !!row.nextDueOnAfter && row.priorScheduleStartDueOn !== undefined && row.priorScheduleAnchorDay !== undefined && row.priorScheduleEndOfMonth !== undefined && row.nextScheduleStartDueOn !== undefined && row.nextScheduleAnchorDay !== undefined && row.nextScheduleEndOfMonth !== undefined && bill?.nextDueOn === row.nextDueOnAfter && bill.scheduleStartDueOn === row.nextScheduleStartDueOn && bill.scheduleAnchorDay === row.nextScheduleAnchorDay && bill.scheduleEndOfMonth === row.nextScheduleEndOfMonth }; }) : [],
      reconciliations: canViewReconciliation ? reconciliations.map(row => ({ _id: row._id, account: row.account, asOfDate: row.asOfDate, bookBalanceUgx: row.bookBalanceUgx, countedBalanceUgx: row.countedBalanceUgx, varianceUgx: row.varianceUgx, status: row.status, note: row.note, explanation: row.explanation, supersedesId: row.supersedesId })) : [],
      partners: canViewPartners ? currentPartnerShares.map(row => ({ _id: row._id, name: row.name, ownershipBps: row.ownershipBps, active: row.active })) : [],
    };
  },
});

export const savingsArchive = query({
  args: { businessId: v.id("businesses"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "savings.view"))) throw new Error("Archived savings holdings are not available to this account.");
    return await ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", false)).order("desc").paginate(args.paginationOpts);
  },
});

export const billArchive = query({
  args: { businessId: v.id("businesses"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "bills.view"))) throw new Error("Archived bill schedules are not available to this account.");
    return await ctx.db.query("bills").withIndex("by_business_and_active_due", q => q.eq("businessId", current.business._id).eq("active", false)).order("desc").paginate(args.paginationOpts);
  },
});

export const partnerArchive = query({
  args: { businessId: v.id("businesses"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "partners.manage"))) throw new Error("Your role cannot view archived partner records.");
    const page = await ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", false)).order("desc").paginate(args.paginationOpts);
    const today = dayInZone(Date.now(), current.business.timezone);
    const results = await Promise.all(page.page.map(async partner => ({ ...partner, ownershipBps: await ownershipAtDay(ctx, current.business._id, partner, today) })));
    return { ...page, page: results };
  },
});

// Partner accounts receive only their own identity, ownership percentage, and
// attributed capital contributions. Business-wide ledger totals stay private.
export const partnerStatement = query({
  args: { businessId: v.id("businesses"), from: v.string(), toExclusive: v.string() },
  handler: async (ctx, args) => {
    if (!validDay(args.from) || !validDay(args.toExclusive) || args.from >= args.toExclusive) throw new Error("Choose a valid statement date range.");
    const current = await workspace(ctx, args.businessId);
    if (!current || !current.membership.partnerId || !(await hasPermission(ctx, current.membership, "partners.view"))) return { access: "restricted" as const };
    const partner = await ctx.db.get("partners", current.membership.partnerId);
    if (!partner || partner.businessId !== current.business._id || !partner.active) return { access: "restricted" as const };
    const contributions = await ctx.db.query("movements")
      .withIndex("by_business_and_partner_and_date", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id).gte("occurredOn", args.from).lt("occurredOn", args.toExclusive))
      .order("desc").take(100);
    const currentDay = dayInZone(Date.now(), current.business.timezone);
    const currentOwnership = await ctx.db.query("partnerOwnershipHistory")
      .withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id).lte("effectiveOn", currentDay))
      .order("desc").first();
    const legacyCapital = partner.capitalContributedUgx === undefined
      ? await historicalPartnerCapital(ctx, current.business._id, partner._id)
      : { total: partner.capitalContributedUgx, complete: true };
    const distributionItems = await ctx.db.query("partnerDistributionItems")
      .withIndex("by_business_and_partner", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id))
      .order("desc").take(501);
    const distributions = await Promise.all(distributionItems.slice(0, 500).map(async item => {
      const distribution = await ctx.db.get("partnerDistributions", item.distributionId);
      if (!distribution || distribution.businessId !== current.business._id || distribution.periodFrom >= args.toExclusive || distribution.periodToExclusive <= args.from) return null;
      return {
        id: distribution._id,
        periodFrom: distribution.periodFrom,
        periodToExclusive: distribution.periodToExclusive,
        status: distribution.status,
        allocatedUgx: item.amountUgx,
        paidUgx: item.paidUgx,
        unpaidUgx: item.amountUgx - item.paidUgx,
      };
    }));
    const payoutRows = await ctx.db.query("partnerPayouts")
      .withIndex("by_business_and_partner_and_paidOn", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id).gte("paidOn", args.from).lt("paidOn", args.toExclusive))
      .order("desc").take(501);
    const payouts = await Promise.all(payoutRows.slice(0, 500).map(async payout => {
      const [item, distribution] = await Promise.all([ctx.db.get("partnerDistributionItems", payout.distributionItemId), ctx.db.get("partnerDistributions", payout.distributionId)]);
      if (!item || item.businessId !== current.business._id || !distribution || distribution.businessId !== current.business._id) return null;
      return { id: payout._id, partnerName: item.partnerName, periodFrom: distribution.periodFrom, amountUgx: payout.amountUgx, account: payout.account, paidOn: payout.paidOn, state: payout.state, reversedAt: payout.reversedAt, reversalReason: payout.reversalReason };
    }));
    const preferences = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    const currencyMinorDigits = new Intl.NumberFormat("en", { style: "currency", currency: current.business.currency }).resolvedOptions().maximumFractionDigits;
    return {
      access: "ready" as const,
      partner: partner.name,
      ownershipBps: currentOwnership?.ownershipBps ?? partner.ownershipBps,
      currency: current.business.currency,
      currencyMinorDigits,
      locale: preferences?.locale ?? "en-UG",
      dateFormat: preferences?.dateFormat ?? "DD/MM/YYYY",
      capitalContributedUgx: legacyCapital.total,
      capitalTotalComplete: legacyCapital.complete,
      distributions: distributions.filter((row): row is NonNullable<typeof row> => row !== null && ["approved", "partially_paid", "paid"].includes(row.status)),
      distributionsComplete: distributionItems.length < 501,
      payouts: payouts.filter((row): row is NonNullable<typeof row> => row !== null),
      payoutsComplete: payoutRows.length < 501,
      contributions: contributions.filter(row => row.kind === "capital_contribution" && row.state === "posted").map(row => ({
        _id: row._id, occurredOn: row.occurredOn, amountUgx: row.amountUgx, account: row.toAccount ?? "cash", note: row.note,
      })),
    };
  },
});

export const createMovement = mutation({
  args: {
    businessId: v.id("businesses"),
    kind: v.union(v.literal("transfer"), v.literal("withdrawal"), v.literal("deposit"), v.literal("capital_contribution")),
    amountUgx: v.number(), feeUgx: v.optional(v.number()), fromAccount: v.optional(accountV), toAccount: v.optional(accountV),
    partnerId: v.optional(v.id("partners")), occurredOn: v.string(), note: v.string(), idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()),
  },
  returns: v.id("movements"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "movements.create"))) throw new Error("Your role cannot record a movement.");
    if (!Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0 || !Number.isSafeInteger(args.feeUgx ?? 0) || (args.feeUgx ?? 0) < 0) throw new Error("Enter a positive whole-unit amount and a non-negative fee.");
    if (!validDay(args.occurredOn) || args.note.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Movement details are invalid.");
    const feeUgx = args.feeUgx ?? 0;
    let fromAccount = args.fromAccount;
    const toAccount = args.toAccount;
    if (args.kind === "transfer") {
      if (!fromAccount || !toAccount || fromAccount === toAccount || feeUgx > 0 || args.partnerId) throw new Error("Choose two different accounts for a transfer. Transfers cannot have fees or partner links.");
    } else if (args.kind === "withdrawal") {
      if (fromAccount !== "mobile_money" || toAccount !== "cash" || args.partnerId) throw new Error("A withdrawal moves mobile money to cash.");
    } else {
      fromAccount = undefined;
      if (!toAccount) throw new Error("Choose the account receiving the money.");
      if (args.kind === "deposit" && (feeUgx > 0 || args.partnerId)) throw new Error("A deposit cannot have a fee or partner link.");
      if (args.kind === "capital_contribution") {
        if (!args.partnerId || feeUgx > 0) throw new Error("Choose a partner for the capital contribution. Capital is not sales income.");
        const partner = await ctx.db.get("partners", args.partnerId);
        if (!partner || partner.businessId !== current.business._id || !partner.active) throw new Error("Choose an active partner in this workspace.");
      }
    }
    const existing = await ctx.db.query("movements").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existing) {
      assertSameRequest(existing.kind === args.kind && existing.amountUgx === args.amountUgx && (existing.feeUgx ?? 0) === feeUgx && existing.fromAccount === fromAccount && existing.toAccount === toAccount && existing.partnerId === (args.kind === "capital_contribution" ? args.partnerId : undefined) && existing.occurredOn === args.occurredOn && existing.note === args.note.trim());
      return existing._id;
    }
    if (args.kind === "transfer" || args.kind === "withdrawal") {
      const outflow = -(args.amountUgx + (args.kind === "withdrawal" ? feeUgx : 0));
      await checkOutflow(ctx, current.business._id, fromAccount!, outflow, args.confirmNegativeBalance ?? false);
      await applyAccountDelta(ctx, current.business._id, fromAccount!, outflow);
    }
    await applyAccountDelta(ctx, current.business._id, toAccount!, args.amountUgx);
    if (args.kind === "capital_contribution" && args.partnerId) {
      const partner = await ctx.db.get("partners", args.partnerId);
      if (!partner) throw new Error("Partner is no longer available.");
      let previousCapital = partner.capitalContributedUgx;
      if (previousCapital === undefined) {
        const legacyCapital = await historicalPartnerCapital(ctx, current.business._id, partner._id);
        if (!legacyCapital.complete) throw new Error("This partner has more than 5,000 historical movements. Ask the owner to reconcile partner capital before recording another contribution.");
        previousCapital = legacyCapital.total;
      }
      await ctx.db.patch("partners", partner._id, { capitalContributedUgx: safeAdd(previousCapital, args.amountUgx, "Partner capital contributions") });
    }
    const now = Date.now();
    const movementId = await ctx.db.insert("movements", { businessId: current.business._id, kind: args.kind, amountUgx: args.amountUgx, feeUgx: feeUgx || undefined, fromAccount, toAccount, partnerId: args.kind === "capital_contribution" ? args.partnerId : undefined, occurredOn: args.occurredOn, note: args.note.trim(), idempotencyKey: args.idempotencyKey, state: "posted", createdBy: current.userId, createdAt: now });
    if (args.kind === "withdrawal" && feeUgx > 0) await postExpense(ctx, { businessId: current.business._id, userId: current.userId, amountUgx: feeUgx, occurredOn: args.occurredOn, account: "mobile_money", category: "Mobile money withdrawal fee", note: args.note.trim() || "Fee for cash withdrawal", idempotencyKey: `movement-fee:${args.idempotencyKey}`, action: "movement.fee_recorded", operationSource: "movement_fee", operationKey: args.idempotencyKey });
    await audit(ctx, current, "movement.created", "movement", movementId, `${args.kind.replaceAll("_", " ")} · ${args.amountUgx}${feeUgx ? ` + ${feeUgx} fee` : ""} · ${args.occurredOn}`);
    return movementId;
  },
});

async function voidMovementFee(ctx: MutationCtx, current: NonNullable<Awaited<ReturnType<typeof workspace>>>, movement: { idempotencyKey: string; occurredOn: string; feeUgx?: number }) {
  if (!movement.feeUgx) return;
  const entry = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", `movement-fee:${movement.idempotencyKey}`)).unique();
  if (!entry || entry.state !== "posted" || entry.operationSource !== "movement_fee" || entry.operationKey !== movement.idempotencyKey) {
    throw new Error("The linked withdrawal-fee expense is missing or already changed. Reconcile the movement before reversing it.");
  }
  const day = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", movement.occurredOn)).unique();
  if (!day || day.expensesUgx < entry.amountUgx || day.expenseCount < 1) throw new Error("Daily expense totals need reconciliation before this movement can be reversed.");
  await ctx.db.patch("dailyTotals", day._id, { expensesUgx: safeAdd(day.expensesUgx, -entry.amountUgx, "Daily expenses"), expenseCount: safeAdd(day.expenseCount, -1, "Daily expense count") });
  const now = Date.now();
  await ctx.db.patch("entries", entry._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: "Linked withdrawal movement reversed." });
  await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "movement.fee_reversed", entityType: "entry", entityId: entry._id, occurredAt: now, summary: "Voided the withdrawal fee expense as part of its linked movement reversal." });
}

export const reverseMovement = mutation({
  args: { businessId: v.id("businesses"), movementId: v.id("movements"), reason: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "movements.void"))) throw new Error("Your role cannot reverse a movement.");
    const movement = await ctx.db.get("movements", args.movementId);
    if (!movement || movement.businessId !== current.business._id) throw new Error("Movement not found.");
    if (movement.state === "void") return null;
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Explain the movement reversal in 5 to 300 characters.");
    if (!movement.toAccount) throw new Error("This movement has no receiving account and cannot be reversed automatically.");
    await checkOutflow(ctx, current.business._id, movement.toAccount, -movement.amountUgx, args.confirmNegativeBalance ?? false);
    if (movement.kind === "transfer") {
      if (!movement.fromAccount) throw new Error("The original transfer source account is missing.");
      await applyAccountDelta(ctx, current.business._id, movement.fromAccount, movement.amountUgx);
      await applyAccountDelta(ctx, current.business._id, movement.toAccount, -movement.amountUgx);
    } else if (movement.kind === "withdrawal") {
      if (!movement.fromAccount) throw new Error("The original withdrawal source account is missing.");
      await applyAccountDelta(ctx, current.business._id, movement.fromAccount, safeAdd(movement.amountUgx, movement.feeUgx ?? 0, "Movement reversal"));
      await applyAccountDelta(ctx, current.business._id, movement.toAccount, -movement.amountUgx);
      await voidMovementFee(ctx, current, movement);
    } else {
      await applyAccountDelta(ctx, current.business._id, movement.toAccount, -movement.amountUgx);
      if (movement.kind === "capital_contribution" && movement.partnerId) {
        const partner = await ctx.db.get("partners", movement.partnerId);
        if (!partner || partner.businessId !== current.business._id) throw new Error("The linked partner record is unavailable; reconcile partner capital before reversing.");
        let capital = partner.capitalContributedUgx;
        if (capital === undefined) {
          const historical = await historicalPartnerCapital(ctx, current.business._id, partner._id);
          if (!historical.complete) throw new Error("Partner capital history exceeds the safe reconciliation window. Reconcile the owner statement before reversing this contribution.");
          capital = historical.total;
        }
        if (capital < movement.amountUgx) throw new Error("Partner capital is lower than this contribution; reconcile the partner statement before reversing.");
        await ctx.db.patch("partners", partner._id, { capitalContributedUgx: safeAdd(capital, -movement.amountUgx, "Partner capital contributions") });
      }
    }
    const now = Date.now();
    await ctx.db.patch("movements", movement._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: reason });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "movement.reversed", entityType: "movement", entityId: movement._id, occurredAt: now, summary: reason, details: JSON.stringify({ kind: movement.kind, amountUgx: movement.amountUgx, feeUgx: movement.feeUgx ?? 0, fromAccount: movement.fromAccount, toAccount: movement.toAccount, partnerId: movement.partnerId }) });
    return null;
  },
});

export const createSavingsHolding = mutation({
  args: { businessId: v.id("businesses"), name: v.string(), targetUgx: v.optional(v.number()), idempotencyKey: v.string() }, returns: v.id("savingsHoldings"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "savings.create"))) throw new Error("Your role cannot manage savings holdings.");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Name the savings goal using 2 to 80 characters.");
    const request = await ctx.db.query("savingsHoldings").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (request) {
      assertSameRequest(request.name === name && request.targetUgx === args.targetUgx);
      return request._id;
    }
    if (args.targetUgx !== undefined && (!Number.isSafeInteger(args.targetUgx) || args.targetUgx <= 0)) throw new Error("Target must be a positive whole-unit amount.");
    const duplicate = await ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(101);
    if (duplicate.length >= 100) throw new Error("This version supports up to 100 active savings holdings in a workspace. Review your savings records before reaching this limit.");
    if (duplicate.some(row => row.name.toLowerCase() === name.toLowerCase())) throw new Error("A savings goal with this name already exists.");
    const holdingId = await ctx.db.insert("savingsHoldings", { businessId: current.business._id, name, targetUgx: args.targetUgx, balanceUgx: 0, active: true, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "savings.holding_created", "savingsHolding", holdingId, `Created savings holding: ${name}.`);
    return holdingId;
  },
});

export const updateSavingsHolding = mutation({
  args: { businessId: v.id("businesses"), holdingId: v.id("savingsHoldings"), action: v.union(v.literal("edit"), v.literal("archive"), v.literal("restore")), expectedActive: v.boolean(), name: v.string(), targetUgx: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    const permission = args.action === "edit" || args.action === "restore" ? "savings.update" : "savings.delete";
    if (!current || !(await hasPermission(ctx, current.membership, permission))) throw new Error("Your role cannot update or archive savings holdings.");
    const holding = await ctx.db.get("savingsHoldings", args.holdingId);
    if (!holding || holding.businessId !== current.business._id) throw new Error("Savings holding not found.");
    if (args.expectedActive !== holding.active) throw new Error("This savings holding changed in another session. Refresh and try again.");
    if (args.action !== "edit") {
      const active = args.action === "restore";
      if (active === holding.active) throw new Error("This savings holding already has that status. Refresh the page.");
      if (!active && holding.balanceUgx !== 0) throw new Error("Withdraw or reassign the full holding balance before archiving it.");
      if (active) {
        const activeRows = await ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(101);
        if (activeRows.length >= 100) throw new Error("A workspace can have up to 100 active savings holdings.");
        if (activeRows.some(row => row.name.toLowerCase() === holding.name.toLowerCase())) throw new Error("An active savings holding with this name already exists.");
      }
      await ctx.db.patch("savingsHoldings", holding._id, { active });
      await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: active ? "savings.holding_restored" : "savings.holding_archived", entityType: "savingsHolding", entityId: holding._id, occurredAt: Date.now(), summary: `${active ? "Restored" : "Archived"} savings holding: ${holding.name}.` });
      return null;
    }
    if (!holding.active) throw new Error("Restore this savings holding before editing it.");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80 || (args.targetUgx !== undefined && (!Number.isSafeInteger(args.targetUgx) || args.targetUgx <= 0))) throw new Error("Savings holding details are invalid.");
    const active = await ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(101);
    if (active.some(row => row._id !== holding._id && row.name.toLowerCase() === name.toLowerCase())) throw new Error("An active savings holding with this name already exists.");
    const before = { name: holding.name, targetUgx: holding.targetUgx, active: holding.active };
    const after = { name, targetUgx: args.targetUgx, active: true };
    await ctx.db.patch("savingsHoldings", holding._id, after);
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "savings.holding_updated", entityType: "savingsHolding", entityId: holding._id, occurredAt: Date.now(), summary: `Updated savings holding: ${name}.`, details: JSON.stringify({ before, after }) });
    return null;
  },
});

export const recordSavingsFlow = mutation({
  args: { businessId: v.id("businesses"), holdingId: v.id("savingsHoldings"), kind: v.union(v.literal("contribution"), v.literal("withdrawal")), amountUgx: v.number(), account: accountV, occurredOn: v.string(), note: v.string(), idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.id("savingsFlows"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "savings.create"))) throw new Error("Your role cannot record savings activity.");
    if (!Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0 || !validDay(args.occurredOn) || args.note.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Savings transaction details are invalid.");
    const duplicate = await ctx.db.query("savingsFlows").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.holdingId === args.holdingId && duplicate.kind === args.kind && duplicate.amountUgx === args.amountUgx && duplicate.account === args.account && duplicate.occurredOn === args.occurredOn && duplicate.note === args.note.trim());
      return duplicate._id;
    }
    const holding = await ctx.db.get("savingsHoldings", args.holdingId);
    if (!holding || holding.businessId !== current.business._id || !holding.active) throw new Error("Savings holding is not available.");
    const delta = args.kind === "contribution" ? -args.amountUgx : args.amountUgx;
    if (delta < 0) await checkOutflow(ctx, current.business._id, args.account, delta, args.confirmNegativeBalance ?? false);
    if (args.kind === "withdrawal" && holding.balanceUgx < args.amountUgx) throw new Error("Withdrawal exceeds the recorded savings balance.");
    await applyAccountDelta(ctx, current.business._id, args.account, delta);
    const holdingDelta = args.kind === "contribution" ? args.amountUgx : -args.amountUgx;
    await ctx.db.patch("savingsHoldings", holding._id, { balanceUgx: safeAdd(holding.balanceUgx, holdingDelta, "Savings balance") });
    const flowId = await ctx.db.insert("savingsFlows", { businessId: current.business._id, holdingId: holding._id, kind: args.kind, amountUgx: args.amountUgx, account: args.account, occurredOn: args.occurredOn, note: args.note.trim(), idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, `savings.${args.kind}`, "savingsFlow", flowId, `${args.kind} · ${args.amountUgx} · ${args.occurredOn}`);
    return flowId;
  },
});

export const reverseSavingsFlow = mutation({
  args: { businessId: v.id("businesses"), flowId: v.id("savingsFlows"), reason: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "savings.delete"))) throw new Error("Your role cannot reverse savings activity.");
    const flow = await ctx.db.get("savingsFlows", args.flowId);
    if (!flow || flow.businessId !== current.business._id) throw new Error("Savings activity not found.");
    if (flow.state === "void") return null;
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Explain the savings reversal in 5 to 300 characters.");
    const holding = await ctx.db.get("savingsHoldings", flow.holdingId);
    if (!holding || holding.businessId !== current.business._id) throw new Error("The linked savings holding is unavailable.");
    if (!holding.active) throw new Error("Restore the savings holding before reversing a historical flow.");
    const accountDelta = flow.kind === "contribution" ? flow.amountUgx : -flow.amountUgx;
    if (accountDelta < 0) await checkOutflow(ctx, current.business._id, flow.account, accountDelta, args.confirmNegativeBalance ?? false);
    const holdingDelta = flow.kind === "contribution" ? -flow.amountUgx : flow.amountUgx;
    if (safeAdd(holding.balanceUgx, holdingDelta, "Savings balance") < 0) throw new Error("Later savings activity used this amount. Reverse later flows first.");
    await applyAccountDelta(ctx, current.business._id, flow.account, accountDelta);
    await ctx.db.patch("savingsHoldings", holding._id, { balanceUgx: safeAdd(holding.balanceUgx, holdingDelta, "Savings balance") });
    const now = Date.now();
    await ctx.db.patch("savingsFlows", flow._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: reason });
    await audit(ctx, current, "savings.flow_reversed", "savingsFlow", flow._id, reason);
    return null;
  },
});

export const createLoan = mutation({
  args: { businessId: v.id("businesses"), lender: v.string(), principalUgx: v.number(), annualRateBps: v.number(), termMonths: v.number(), startedOn: v.string(), account: accountV, note: v.string(), idempotencyKey: v.string() },
  returns: v.id("loans"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "loans.create"))) throw new Error("Your role cannot register a loan.");
    const lender = args.lender.trim();
    if (lender.length < 2 || lender.length > 100 || !Number.isSafeInteger(args.principalUgx) || args.principalUgx <= 0 || !Number.isSafeInteger(args.annualRateBps) || args.annualRateBps < 0 || args.annualRateBps > 1_000_000 || !Number.isSafeInteger(args.termMonths) || args.termMonths < 1 || args.termMonths > 600 || !validDay(args.startedOn) || args.note.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Loan details are invalid.");
    const duplicate = await ctx.db.query("loans").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.lender === lender && duplicate.principalUgx === args.principalUgx && duplicate.annualRateBps === args.annualRateBps && duplicate.termMonths === args.termMonths && duplicate.startedOn === args.startedOn && duplicate.account === args.account && duplicate.note === args.note.trim());
      return duplicate._id;
    }
    const activeLoans = await ctx.db.query("loans").withIndex("by_business_and_status", q => q.eq("businessId", current.business._id).eq("status", "active")).take(100);
    if (activeLoans.length >= 100) throw new Error("A workspace can have up to 100 active loans. Pay off or review an existing loan before adding another.");
    await applyAccountDelta(ctx, current.business._id, args.account, args.principalUgx);
    const loanId = await ctx.db.insert("loans", { businessId: current.business._id, lender, principalUgx: args.principalUgx, outstandingPrincipalUgx: args.principalUgx, annualRateBps: args.annualRateBps, termMonths: args.termMonths, startedOn: args.startedOn, account: args.account, status: "active", note: args.note.trim(), idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "loan.disbursed", "loan", loanId, `Loan disbursed from ${lender}; not classified as sales income.`);
    return loanId;
  },
});

export const recordLoanRepayment = mutation({
  args: { businessId: v.id("businesses"), loanId: v.id("loans"), principalUgx: v.number(), interestUgx: v.number(), paidOn: v.string(), account: accountV, idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.id("loanRepayments"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "loans.repay"))) throw new Error("Your role cannot record loan repayments.");
    if (!Number.isSafeInteger(args.principalUgx) || args.principalUgx < 0 || !Number.isSafeInteger(args.interestUgx) || args.interestUgx < 0 || (args.principalUgx === 0 && args.interestUgx === 0) || !validDay(args.paidOn) || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Repayment must include a positive principal or interest amount.");
    const duplicate = await ctx.db.query("loanRepayments").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.loanId === args.loanId && duplicate.principalUgx === args.principalUgx && duplicate.interestUgx === args.interestUgx && duplicate.account === args.account && duplicate.paidOn === args.paidOn);
      return duplicate._id;
    }
    const loan = await ctx.db.get("loans", args.loanId);
    if (!loan || loan.businessId !== current.business._id || loan.status !== "active") throw new Error("Active loan not found.");
    if (args.principalUgx > loan.outstandingPrincipalUgx) throw new Error("Principal repayment exceeds the outstanding balance.");
    const amountUgx = safeAdd(args.principalUgx, args.interestUgx, "Repayment");
    await checkOutflow(ctx, current.business._id, args.account, -amountUgx, args.confirmNegativeBalance ?? false);
    await applyAccountDelta(ctx, current.business._id, args.account, -amountUgx);
    if (args.interestUgx > 0) await postExpense(ctx, { businessId: current.business._id, userId: current.userId, amountUgx: args.interestUgx, occurredOn: args.paidOn, account: args.account, category: "Loan interest", note: `Interest repayment to ${loan.lender}`, idempotencyKey: `loan-interest:${args.idempotencyKey}`, action: "loan.interest_recorded", operationSource: "loan_interest", operationKey: args.idempotencyKey });
    const outstandingPrincipalUgx = loan.outstandingPrincipalUgx - args.principalUgx;
    await ctx.db.patch("loans", loan._id, { outstandingPrincipalUgx, status: outstandingPrincipalUgx === 0 ? "paid_off" : "active" });
    const repaymentId = await ctx.db.insert("loanRepayments", { businessId: current.business._id, loanId: loan._id, amountUgx, principalUgx: args.principalUgx, interestUgx: args.interestUgx, account: args.account, paidOn: args.paidOn, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "loan.repayment_recorded", "loanRepayment", repaymentId, `Repayment · principal ${args.principalUgx} · interest ${args.interestUgx} · ${args.paidOn}`);
    return repaymentId;
  },
});

export const reverseLoanRepayment = mutation({
  args: { businessId: v.id("businesses"), repaymentId: v.id("loanRepayments"), reason: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "loans.void"))) throw new Error("Your role cannot reverse loan repayments.");
    const repayment = await ctx.db.get("loanRepayments", args.repaymentId);
    if (!repayment || repayment.businessId !== current.business._id) throw new Error("Loan repayment not found.");
    if (repayment.state === "void") return null;
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Explain the repayment reversal in 5 to 300 characters.");
    const loan = await ctx.db.get("loans", repayment.loanId);
    if (!loan || loan.businessId !== current.business._id) throw new Error("The linked loan is unavailable.");
    if (repayment.interestUgx > 0) await reverseLinkedExpense(ctx, current, `loan-interest:${repayment.idempotencyKey}`, repayment.idempotencyKey, "loan_interest", reason);
    await applyAccountDelta(ctx, current.business._id, repayment.account, repayment.amountUgx);
    const outstandingPrincipalUgx = safeAdd(loan.outstandingPrincipalUgx, repayment.principalUgx, "Loan principal");
    await ctx.db.patch("loans", loan._id, { outstandingPrincipalUgx, status: outstandingPrincipalUgx === 0 ? "paid_off" : "active" });
    const now = Date.now();
    await ctx.db.patch("loanRepayments", repayment._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: reason });
    await audit(ctx, current, "loan.repayment_reversed", "loanRepayment", repayment._id, reason);
    return null;
  },
});

function nextOccurrence(day: string, recurrence: "weekly" | "monthly" | "quarterly" | "yearly", anchorDay: number, endOfMonth: boolean) {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else {
    const originalDay = date.getUTCDate();
    const months = recurrence === "monthly" ? 1 : recurrence === "quarterly" ? 3 : 12;
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(endOfMonth ? lastDay : Math.min(anchorDay || originalDay, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

export const createBill = mutation({
  args: { businessId: v.id("businesses"), name: v.string(), category: v.string(), amountUgx: v.number(), account: accountV, recurrence: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("yearly")), nextDueOn: v.string(), idempotencyKey: v.string() },
  returns: v.id("bills"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "bills.create"))) throw new Error("Your role cannot configure recurring bills.");
    const name = args.name.trim();
    const category = args.category.trim();
    if (name.length < 2 || name.length > 100 || category.length < 1 || category.length > 80 || !Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0 || !validDay(args.nextDueOn) || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Bill details are invalid.");
    const duplicate = await ctx.db.query("bills").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.name === name && duplicate.category === category && duplicate.amountUgx === args.amountUgx && duplicate.account === args.account && duplicate.recurrence === args.recurrence && (duplicate.scheduleStartDueOn ?? duplicate.nextDueOn) === args.nextDueOn);
      return duplicate._id;
    }
    const activeBills = await ctx.db.query("bills").withIndex("by_business_and_active_due", q => q.eq("businessId", current.business._id).eq("active", true)).take(100);
    if (activeBills.length >= 100) throw new Error("This version supports up to 100 active bill reminders in a workspace. Review your bill records before reaching this limit.");
    const startDate = new Date(`${args.nextDueOn}T00:00:00.000Z`);
    const anchorDay = startDate.getUTCDate();
    const endOfMonth = anchorDay === new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).getUTCDate();
    const billId = await ctx.db.insert("bills", { businessId: current.business._id, name, category, amountUgx: args.amountUgx, account: args.account, recurrence: args.recurrence, nextDueOn: args.nextDueOn, scheduleStartDueOn: args.nextDueOn, scheduleAnchorDay: anchorDay, scheduleEndOfMonth: endOfMonth, active: true, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "bill.created", "bill", billId, `Configured ${name}; future payments are not booked automatically.`);
    return billId;
  },
});

export const updateBillSchedule = mutation({
  args: { businessId: v.id("businesses"), billId: v.id("bills"), action: v.union(v.literal("edit"), v.literal("archive"), v.literal("restore")), expectedActive: v.boolean(), expectedNextDueOn: v.string(), name: v.string(), category: v.string(), amountUgx: v.number(), account: accountV, recurrence: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("yearly")), nextDueOn: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    const permission = args.action === "edit" || args.action === "restore" ? "bills.update" : "bills.void";
    if (!current || !(await hasPermission(ctx, current.membership, permission))) throw new Error("Your role cannot update or archive bill schedules.");
    const bill = await ctx.db.get("bills", args.billId);
    if (!bill || bill.businessId !== current.business._id) throw new Error("Bill schedule not found.");
    if (args.expectedActive !== bill.active || args.expectedNextDueOn !== bill.nextDueOn) throw new Error("This bill was updated in another session. Refresh the schedule before continuing.");
    if (args.action !== "edit") {
      const active = args.action === "restore";
      if (active === bill.active) throw new Error("This bill schedule already has that status. Refresh the page.");
      if (active) {
      const activeBills = await ctx.db.query("bills").withIndex("by_business_and_active_due", q => q.eq("businessId", current.business._id).eq("active", true)).take(101);
      if (activeBills.length >= 100) throw new Error("A workspace can have up to 100 active bill schedules.");
      }
      await ctx.db.patch("bills", bill._id, { active });
      await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: active ? "bill.schedule_restored" : "bill.schedule_archived", entityType: "bill", entityId: bill._id, occurredAt: Date.now(), summary: `${active ? "Restored" : "Archived"} bill schedule: ${bill.name}.` });
      return null;
    }
    if (!bill.active) throw new Error("Restore this bill schedule before editing it.");
    const name = args.name.trim();
    const category = args.category.trim();
    if (name.length < 2 || name.length > 100 || category.length < 1 || category.length > 80 || !Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0 || !validDay(args.nextDueOn)) throw new Error("Bill schedule details are invalid.");
    const dateChanged = args.nextDueOn !== bill.nextDueOn;
    const startDate = new Date(`${args.nextDueOn}T00:00:00.000Z`);
    const anchorDate = new Date(`${bill.scheduleStartDueOn ?? bill.nextDueOn}T00:00:00.000Z`);
    const anchorDay = dateChanged ? startDate.getUTCDate() : bill.scheduleAnchorDay ?? anchorDate.getUTCDate();
    const anchorMonthEnd = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + 1, 0)).getUTCDate();
    const endOfMonth = dateChanged ? anchorDay === new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).getUTCDate() : bill.scheduleEndOfMonth ?? anchorDay === anchorMonthEnd;
    const before = { name: bill.name, category: bill.category, amountUgx: bill.amountUgx, account: bill.account, recurrence: bill.recurrence, nextDueOn: bill.nextDueOn, active: bill.active };
    const after = { name, category, amountUgx: args.amountUgx, account: args.account, recurrence: args.recurrence, nextDueOn: args.nextDueOn, active: true };
    await ctx.db.patch("bills", bill._id, { ...after, scheduleStartDueOn: dateChanged ? args.nextDueOn : bill.scheduleStartDueOn ?? bill.nextDueOn, scheduleAnchorDay: anchorDay, scheduleEndOfMonth: endOfMonth });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "bill.schedule_updated", entityType: "bill", entityId: bill._id, occurredAt: Date.now(), summary: `Updated bill schedule: ${name}.`, details: JSON.stringify({ before, after }) });
    return null;
  },
});

export const recordBillPayment = mutation({
  args: { businessId: v.id("businesses"), billId: v.id("bills"), paidOn: v.string(), amountUgx: v.optional(v.number()), account: accountV, idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.id("billPayments"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "bills.pay"))) throw new Error("Your role cannot confirm bill payments.");
    if (!validDay(args.paidOn) || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Payment details are invalid.");
    const bill = await ctx.db.get("bills", args.billId);
    if (!bill || bill.businessId !== current.business._id) throw new Error("Bill schedule not found.");
    const amountUgx = args.amountUgx ?? bill.amountUgx;
    if (!Number.isSafeInteger(amountUgx) || amountUgx <= 0) throw new Error("Payment amount must be a positive whole-unit amount.");
    const duplicate = await ctx.db.query("billPayments").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.billId === args.billId && duplicate.paidOn === args.paidOn && duplicate.amountUgx === amountUgx && (duplicate.account ?? bill.account) === args.account);
      return duplicate._id;
    }
    if (!bill.active) throw new Error("This bill schedule is archived. Restore it before recording another payment.");
    await checkOutflow(ctx, current.business._id, args.account, -amountUgx, args.confirmNegativeBalance ?? false);
    await applyAccountDelta(ctx, current.business._id, args.account, -amountUgx);
    const entryId = await postExpense(ctx, { businessId: current.business._id, userId: current.userId, amountUgx, occurredOn: args.paidOn, account: args.account, category: bill.category, note: `Bill payment: ${bill.name}`, idempotencyKey: `bill-expense:${args.idempotencyKey}`, action: "bill.payment_expense_recorded", operationSource: "bill_payment", operationKey: args.idempotencyKey });
    const scheduleStartDueOn = bill.scheduleStartDueOn ?? bill.nextDueOn;
    const startDate = new Date(`${scheduleStartDueOn}T00:00:00.000Z`);
    const scheduleAnchorDay = bill.scheduleAnchorDay ?? startDate.getUTCDate();
    const scheduleEndOfMonth = bill.scheduleEndOfMonth ?? scheduleAnchorDay === new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).getUTCDate();
    const nextDueOnAfter = nextOccurrence(bill.nextDueOn, bill.recurrence, scheduleAnchorDay, scheduleEndOfMonth);
    await ctx.db.patch("bills", bill._id, { nextDueOn: nextDueOnAfter, scheduleStartDueOn, scheduleAnchorDay, scheduleEndOfMonth });
    const paymentId = await ctx.db.insert("billPayments", { businessId: current.business._id, billId: bill._id, entryId, amountUgx, account: args.account, paidOn: args.paidOn, priorNextDueOn: bill.nextDueOn, nextDueOnAfter, priorScheduleStartDueOn: bill.scheduleStartDueOn ?? bill.nextDueOn, priorScheduleAnchorDay: bill.scheduleAnchorDay ?? scheduleAnchorDay, priorScheduleEndOfMonth: bill.scheduleEndOfMonth ?? scheduleEndOfMonth, nextScheduleStartDueOn: scheduleStartDueOn, nextScheduleAnchorDay: scheduleAnchorDay, nextScheduleEndOfMonth: scheduleEndOfMonth, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "bill.payment_recorded", "billPayment", paymentId, `${bill.name} · ${amountUgx} · ${args.paidOn}`);
    return paymentId;
  },
});

export const reverseBillPayment = mutation({
  args: { businessId: v.id("businesses"), paymentId: v.id("billPayments"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "bills.void"))) throw new Error("Your role cannot reverse bill payments.");
    const payment = await ctx.db.get("billPayments", args.paymentId);
    if (!payment || payment.businessId !== current.business._id) throw new Error("Bill payment not found.");
    if (payment.state === "void") return null;
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Explain the payment reversal in 5 to 300 characters.");
    if (!payment.priorNextDueOn || !validDay(payment.priorNextDueOn)) throw new Error("This older payment has no saved due-date snapshot. Reconcile the bill schedule before reversing it.");
    const latestPosted = await ctx.db.query("billPayments")
      .withIndex("by_bill_and_created_at", q => q.eq("billId", payment.billId))
      .order("desc")
      .filter(q => q.neq(q.field("state"), "void"))
      .first();
    if (!latestPosted || latestPosted._id !== payment._id) throw new Error("Reverse later posted payments for this bill first so the due date can be restored safely.");
    const bill = await ctx.db.get("bills", payment.billId);
    if (!bill || bill.businessId !== current.business._id) throw new Error("The linked bill schedule is unavailable.");
    if (!payment.nextDueOnAfter || bill.nextDueOn !== payment.nextDueOnAfter || payment.priorScheduleStartDueOn === undefined || payment.priorScheduleAnchorDay === undefined || payment.priorScheduleEndOfMonth === undefined || payment.nextScheduleStartDueOn === undefined || payment.nextScheduleAnchorDay === undefined || payment.nextScheduleEndOfMonth === undefined || bill.scheduleStartDueOn !== payment.nextScheduleStartDueOn || bill.scheduleAnchorDay !== payment.nextScheduleAnchorDay || bill.scheduleEndOfMonth !== payment.nextScheduleEndOfMonth) throw new Error("The bill schedule changed after this payment or lacks a complete schedule snapshot. Reconcile it before reversing.");
    const entry = await ctx.db.get("entries", payment.entryId);
    if (!entry || entry.businessId !== current.business._id || entry.state !== "posted" || entry.kind !== "expense" || entry.amountUgx !== payment.amountUgx || entry.operationSource !== "bill_payment" || entry.operationKey !== payment.idempotencyKey || entry.idempotencyKey !== `bill-expense:${payment.idempotencyKey}`) {
      throw new Error("The linked bill expense is missing or changed. Reconcile the payment before reversing it.");
    }
    const account = payment.account ?? (entry.account === "cash" || entry.account === "mobile_money" ? entry.account : undefined);
    if (!account) throw new Error("The account used for this payment is unavailable.");
    await reverseLinkedExpense(ctx, current, `bill-expense:${payment.idempotencyKey}`, payment.idempotencyKey, "bill_payment", reason);
    await applyAccountDelta(ctx, current.business._id, account, payment.amountUgx);
    await ctx.db.patch("bills", bill._id, { nextDueOn: payment.priorNextDueOn, scheduleStartDueOn: payment.priorScheduleStartDueOn, scheduleAnchorDay: payment.priorScheduleAnchorDay, scheduleEndOfMonth: payment.priorScheduleEndOfMonth });
    const now = Date.now();
    await ctx.db.patch("billPayments", payment._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: reason });
    await audit(ctx, current, "bill.payment_reversed", "billPayment", payment._id, reason);
    return null;
  },
});

export const createReconciliation = mutation({
  args: { businessId: v.id("businesses"), account: accountV, asOfDate: v.string(), countedBalanceUgx: v.number(), note: v.string(), idempotencyKey: v.string() },
  returns: v.id("reconciliations"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "reconcile.create"))) throw new Error("Your role cannot record a reconciliation count.");
    if (!validDay(args.asOfDate) || !Number.isSafeInteger(args.countedBalanceUgx) || args.countedBalanceUgx < 0 || args.note.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Reconciliation details are invalid.");
    const duplicate = await ctx.db.query("reconciliations").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.account === args.account && duplicate.asOfDate === args.asOfDate && duplicate.countedBalanceUgx === args.countedBalanceUgx && duplicate.note === args.note.trim());
      return duplicate._id;
    }
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: current.business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (args.asOfDate !== today) throw new Error("Reconciliation counts can only be recorded for today because the ledger does not reconstruct historical account balances.");
    const account = await accountBalance(ctx, current.business._id, args.account);
    const bookBalanceUgx = account?.balanceUgx ?? 0;
    const varianceUgx = safeAdd(args.countedBalanceUgx, -bookBalanceUgx, "Reconciliation variance");
    const status = varianceUgx === 0 ? "matched" as const : "open" as const;
    const reconciliationId = await ctx.db.insert("reconciliations", { businessId: current.business._id, account: args.account, asOfDate: args.asOfDate, bookBalanceUgx, countedBalanceUgx: args.countedBalanceUgx, varianceUgx, status, note: args.note.trim(), idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "reconciliation.recorded", "reconciliation", reconciliationId, `${args.account} count · book ${bookBalanceUgx} · count ${args.countedBalanceUgx} · variance ${varianceUgx}`);
    return reconciliationId;
  },
});

export const supersedeReconciliation = mutation({
  args: { businessId: v.id("businesses"), reconciliationId: v.id("reconciliations"), countedBalanceUgx: v.number(), note: v.string(), idempotencyKey: v.string() },
  returns: v.id("reconciliations"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "reconcile.resolve"))) throw new Error("Your role cannot correct a reconciliation count.");
    const note = args.note.trim();
    if (!Number.isSafeInteger(args.countedBalanceUgx) || args.countedBalanceUgx < 0 || note.length < 5 || note.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Enter a valid count and a correction reason of 5 to 300 characters.");
    const duplicate = await ctx.db.query("reconciliations").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.supersedesId === args.reconciliationId && duplicate.countedBalanceUgx === args.countedBalanceUgx && duplicate.note === note);
      return duplicate._id;
    }
    const previous = await ctx.db.get("reconciliations", args.reconciliationId);
    if (!previous || previous.businessId !== current.business._id || previous.status === "superseded") throw new Error("This reconciliation is unavailable or already superseded.");
    const today = dayInZone(Date.now(), current.business.timezone);
    if (previous.asOfDate !== today) throw new Error("Only today's count can be corrected because the ledger does not reconstruct historical account balances.");
    const priorCorrection = await ctx.db.query("reconciliations").withIndex("by_business_and_supersedes", q => q.eq("businessId", current.business._id).eq("supersedesId", previous._id)).first();
    if (priorCorrection) throw new Error("This count already has a correction. Correct the latest count instead.");
    const bookBalanceUgx = previous.bookBalanceUgx;
    const varianceUgx = safeAdd(args.countedBalanceUgx, -bookBalanceUgx, "Reconciliation variance");
    const now = Date.now();
    const reconciliationId = await ctx.db.insert("reconciliations", {
      businessId: current.business._id, account: previous.account, asOfDate: today, bookBalanceUgx,
      countedBalanceUgx: args.countedBalanceUgx, varianceUgx, status: varianceUgx === 0 ? "matched" : "open",
      note, supersedesId: previous._id, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: now,
    });
    await ctx.db.patch("reconciliations", previous._id, { status: "superseded" });
    await audit(ctx, current, "reconciliation.superseded", "reconciliation", previous._id, `Count corrected by a superseding record: ${note}`, JSON.stringify({ replacementId: reconciliationId, priorCountedBalanceUgx: previous.countedBalanceUgx, correctedCountedBalanceUgx: args.countedBalanceUgx, previousStatus: previous.status }));
    await audit(ctx, current, "reconciliation.correction_recorded", "reconciliation", reconciliationId, `${previous.account} count corrected · book ${bookBalanceUgx} · count ${args.countedBalanceUgx} · variance ${varianceUgx}`);
    return reconciliationId;
  },
});

export const explainReconciliation = mutation({
  args: { businessId: v.id("businesses"), reconciliationId: v.id("reconciliations"), explanation: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "reconcile.resolve"))) throw new Error("Your role cannot close a reconciliation difference.");
    const explanation = args.explanation.trim();
    if (explanation.length < 5 || explanation.length > 300) throw new Error("Explain the difference in 5 to 300 characters.");
    const row = await ctx.db.get("reconciliations", args.reconciliationId);
    if (!row || row.businessId !== current.business._id) throw new Error("Reconciliation not found.");
    if (row.status !== "open") throw new Error("Only an open reconciliation difference can be explained.");
    await ctx.db.patch("reconciliations", row._id, { status: "explained", explanation, resolvedBy: current.userId, resolvedAt: Date.now() });
    await audit(ctx, current, "reconciliation.explained", "reconciliation", row._id, `Variance ${row.varianceUgx} explained: ${explanation}`);
    return null;
  },
});

export const reopenReconciliation = mutation({
  args: { businessId: v.id("businesses"), reconciliationId: v.id("reconciliations"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "reconcile.resolve"))) throw new Error("Your role cannot reopen an explained reconciliation.");
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Explain why this reconciliation must be reopened in 5 to 300 characters.");
    const row = await ctx.db.get("reconciliations", args.reconciliationId);
    if (!row || row.businessId !== current.business._id) throw new Error("Reconciliation not found.");
    if (row.status !== "explained") throw new Error("Only an explained difference can be reopened.");
    await ctx.db.patch("reconciliations", row._id, { status: "open", explanation: undefined, resolvedBy: undefined, resolvedAt: undefined });
    await audit(ctx, current, "reconciliation.reopened", "reconciliation", row._id, `Explained difference reopened: ${reason}`, JSON.stringify({ priorExplanation: row.explanation, reason }));
    return null;
  },
});

export const createPartner = mutation({
  args: { businessId: v.id("businesses"), name: v.string(), ownershipBps: v.number(), idempotencyKey: v.string() }, returns: v.id("partners"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "partners.manage"))) throw new Error("Your role cannot manage partner ownership.");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 100 || !Number.isSafeInteger(args.ownershipBps) || args.ownershipBps < 0 || args.ownershipBps > 10_000 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Partner details are invalid.");
    const previous = await ctx.db.query("partners").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (previous) {
      assertSameRequest(previous.name === name && previous.ownershipBps === args.ownershipBps);
      return previous._id;
    }
    const partners = await ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(101);
    if (partners.length >= 100) throw new Error("This version supports up to 100 active partner records in a workspace. Review ownership records before reaching this limit.");
    if (partners.some(row => row.name.toLowerCase() === name.toLowerCase())) throw new Error("A partner with this name already exists.");
    const today = dayInZone(Date.now(), current.business.timezone);
    const currentShares = await Promise.all(partners.map(partner => ownershipAtDay(ctx, current.business._id, partner, today)));
    if (currentShares.reduce((sum, share) => safeAdd(sum, share, "Ownership"), args.ownershipBps) > 10_000) throw new Error("Active partner ownership cannot exceed 100% on today's effective shares.");
    const scheduledHistory = await ctx.db.query("partnerOwnershipHistory")
      .withIndex("by_business_and_effectiveOn", q => q.eq("businessId", current.business._id).gt("effectiveOn", today))
      .take(5001);
    if (scheduledHistory.length > 5000) throw new Error("There are too many scheduled ownership changes to safely add a partner. Ask an owner to review the schedule first.");
    const scheduledDays = [...new Set(scheduledHistory.map(row => row.effectiveOn))];
    if (scheduledDays.length > 20) throw new Error("There are too many future ownership dates to safely add a partner. Let scheduled changes take effect or ask an owner to review the schedule first.");
    for (const day of scheduledDays) {
      const scheduledShares = await Promise.all(partners.map(partner => ownershipAtDay(ctx, current.business._id, partner, day)));
      const scheduledTotal = scheduledShares.reduce((sum, share) => safeAdd(sum, share, "Scheduled ownership"), args.ownershipBps);
      if (scheduledTotal > 10_000) throw new Error(`Adding this partner would make ownership exceed 100% after the change scheduled for ${day}. Revise that snapshot before adding the partner.`);
    }
    const now = Date.now();
    const partnerId = await ctx.db.insert("partners", { businessId: current.business._id, name, ownershipBps: args.ownershipBps, capitalContributedUgx: 0, active: true, idempotencyKey: args.idempotencyKey });
    await ctx.db.insert("partnerOwnershipHistory", { businessId: current.business._id, partnerId, ownershipBps: args.ownershipBps, effectiveOn: today, createdBy: current.userId, createdAt: now, idempotencyKey: `${args.idempotencyKey}:ownership` });
    await audit(ctx, current, "partner.created", "partner", partnerId, `${name} added with ${args.ownershipBps / 100}% ownership.`);
    return partnerId;
  },
});

export const updatePartnerProfile = mutation({
  args: { businessId: v.id("businesses"), partnerId: v.id("partners"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "partners.manage"))) throw new Error("Your role cannot update partner details.");
    const partner = await ctx.db.get("partners", args.partnerId);
    if (!partner || partner.businessId !== current.business._id) throw new Error("Partner record not found.");
    if (!partner.active) throw new Error("Restore the partner record before editing its name.");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 100) throw new Error("Partner name must use 2 to 100 characters.");
    const duplicate = await ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", partner.active)).take(101);
    if (duplicate.some(row => row._id !== partner._id && row.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error("A partner with this name already exists in the same record list.");
    const before = partner.name;
    if (before === name) return null;
    await ctx.db.patch("partners", partner._id, { name });
    await audit(ctx, current, "partner.profile_updated", "partner", partner._id, `Updated partner profile name: ${before} → ${name}.`, JSON.stringify({ before: { name: before }, after: { name } }));
    return null;
  },
});

export const updatePartnerStatus = mutation({
  args: { businessId: v.id("businesses"), partnerId: v.id("partners"), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "partners.manage"))) throw new Error("Your role cannot archive or restore partners.");
    const partner = await ctx.db.get("partners", args.partnerId);
    if (!partner || partner.businessId !== current.business._id) throw new Error("Partner record not found.");
    if (partner.active === args.active) return null;
    if (!args.active) {
      const today = dayInZone(Date.now(), current.business.timezone);
      const share = await ownershipAtDay(ctx, current.business._id, partner, today);
      if (share !== 0) throw new Error("Reallocate this partner’s ownership to zero with an effective-dated ownership update before archiving.");
      const scheduled = await ctx.db.query("partnerOwnershipHistory")
        .withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id).gt("effectiveOn", today))
        .take(101);
      if (scheduled.length > 100 || scheduled.some(row => row.ownershipBps > 0)) throw new Error("Resolve future ownership changes before archiving this partner.");
      const [memberships, invitations] = await Promise.all([
        ctx.db.query("memberships").withIndex("by_business_and_partner_and_active", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id).eq("active", true)).take(1),
        ctx.db.query("invitations").withIndex("by_business_and_partner_and_active", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id).eq("active", true)).take(1),
      ]);
      if (memberships.length || invitations.length) throw new Error("Unlink or revoke the partner’s active workspace access and invitations before archiving.");
    } else {
      const active = await ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(101);
      if (active.length >= 100) throw new Error("A workspace can have up to 100 active partners.");
      if (active.some(row => row.name.toLocaleLowerCase() === partner.name.toLocaleLowerCase())) throw new Error("An active partner already has this name.");
    }
    await ctx.db.patch("partners", partner._id, { active: args.active });
    await audit(ctx, current, args.active ? "partner.restored" : "partner.archived", "partner", partner._id, `${args.active ? "Restored" : "Archived"} partner record: ${partner.name}.`);
    return null;
  },
});
