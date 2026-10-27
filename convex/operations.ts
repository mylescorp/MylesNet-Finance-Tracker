import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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

async function workspace(ctx: Ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(20);
  if (memberships.length === 20) return null;
  const active = memberships.filter(row => row.active);
  if (active.length !== 1) return null;
  const business = await ctx.db.get("businesses", active[0].businessId);
  return business ? { userId, membership: active[0], business } : null;
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
}) {
  const previous = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", args.businessId).eq("idempotencyKey", args.idempotencyKey)).unique();
  if (previous) {
    assertSameRequest(previous.kind === "expense" && previous.amountUgx === args.amountUgx && previous.occurredOn === args.occurredOn && previous.account === args.account && previous.category === args.category && previous.note === args.note && previous.state === "posted");
    return previous._id;
  }
  const entryId = await ctx.db.insert("entries", {
    businessId: args.businessId, kind: "expense", amountUgx: args.amountUgx, occurredOn: args.occurredOn,
    account: args.account, category: args.category, note: args.note, source: "manual", idempotencyKey: args.idempotencyKey,
    state: "posted", createdBy: args.userId, createdAt: Date.now(),
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

async function audit(ctx: MutationCtx, current: NonNullable<Awaited<ReturnType<typeof workspace>>>, action: string, entityType: string, entityId: string, summary: string) {
  await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action, entityType, entityId, occurredAt: Date.now(), summary });
}

const accountV = v.union(v.literal("cash"), v.literal("mobile_money"));
const membershipRoleV = v.union(v.literal("owner"), v.literal("cashier"), v.literal("partner"));

export const overview = query({
  args: {},
  returns: v.union(
    v.object({ access: v.literal("pending") }),
    v.object({ access: v.literal("restricted") }),
    v.object({
      access: v.literal("ready"), role: membershipRoleV,
      movements: v.array(v.object({ _id: v.id("movements"), kind: v.union(v.literal("transfer"), v.literal("withdrawal"), v.literal("deposit"), v.literal("capital_contribution")), amountUgx: v.number(), feeUgx: v.optional(v.number()), fromAccount: v.optional(accountV), toAccount: v.optional(accountV), partnerName: v.optional(v.string()), occurredOn: v.string(), note: v.string() })),
      savings: v.array(v.object({ _id: v.id("savingsHoldings"), name: v.string(), targetUgx: v.optional(v.number()), balanceUgx: v.number(), active: v.boolean() })),
      savingsFlows: v.array(v.object({ _id: v.id("savingsFlows"), holdingName: v.string(), kind: v.union(v.literal("contribution"), v.literal("withdrawal")), amountUgx: v.number(), account: accountV, occurredOn: v.string(), note: v.string() })),
      loans: v.array(v.object({ _id: v.id("loans"), lender: v.string(), principalUgx: v.number(), outstandingPrincipalUgx: v.number(), annualRateBps: v.number(), termMonths: v.number(), startedOn: v.string(), account: accountV, status: v.union(v.literal("active"), v.literal("paid_off")) })),
      loanRepayments: v.array(v.object({ _id: v.id("loanRepayments"), lender: v.string(), amountUgx: v.number(), principalUgx: v.number(), interestUgx: v.number(), account: accountV, paidOn: v.string() })),
      bills: v.array(v.object({ _id: v.id("bills"), name: v.string(), category: v.string(), amountUgx: v.number(), account: accountV, recurrence: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("yearly")), nextDueOn: v.string(), active: v.boolean() })),
      billPayments: v.array(v.object({ _id: v.id("billPayments"), billName: v.string(), amountUgx: v.number(), paidOn: v.string() })),
      reconciliations: v.array(v.object({ _id: v.id("reconciliations"), account: accountV, asOfDate: v.string(), bookBalanceUgx: v.number(), countedBalanceUgx: v.number(), varianceUgx: v.number(), status: v.union(v.literal("matched"), v.literal("open"), v.literal("explained")), note: v.string(), explanation: v.optional(v.string()) })),
      partners: v.array(v.object({ _id: v.id("partners"), name: v.string(), ownershipBps: v.number(), active: v.boolean() })),
    }),
  ),
  handler: async (ctx) => {
    const current = await workspace(ctx);
    if (!current) return { access: "pending" as const };
    if (current.membership.role === "partner") return { access: "restricted" as const };
    const businessId = current.business._id;
    const [movements, savings, savingsFlows, loans, loanRepayments, bills, billPayments, reconciliations, partners] = await Promise.all([
      ctx.db.query("movements").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).order("desc").take(100),
      ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", businessId).eq("active", true)).take(100),
      ctx.db.query("savingsFlows").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).order("desc").take(100),
      ctx.db.query("loans").withIndex("by_business_and_status", q => q.eq("businessId", businessId)).take(100),
      ctx.db.query("loanRepayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).order("desc").take(100),
      ctx.db.query("bills").withIndex("by_business_and_active_due", q => q.eq("businessId", businessId).eq("active", true)).take(100),
      ctx.db.query("billPayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).order("desc").take(100),
      ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).order("desc").take(100),
      ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", businessId).eq("active", true)).take(100),
    ]);
    const partnerById = new Map(partners.map(p => [p._id, p.name]));
    const holdingById = new Map(savings.map(item => [item._id, item.name]));
    const loanById = new Map(loans.map(item => [item._id, item.lender]));
    const billById = new Map(bills.map(item => [item._id, item.name]));
    return {
      access: "ready" as const, role: current.membership.role,
      movements: movements.map(row => ({ _id: row._id, kind: row.kind, amountUgx: row.amountUgx, feeUgx: row.feeUgx, fromAccount: row.fromAccount, toAccount: row.toAccount, partnerName: row.partnerId ? partnerById.get(row.partnerId) : undefined, occurredOn: row.occurredOn, note: row.note })),
      savings: savings.map(row => ({ _id: row._id, name: row.name, targetUgx: row.targetUgx, balanceUgx: row.balanceUgx, active: row.active })),
      savingsFlows: savingsFlows.map(row => ({ _id: row._id, holdingName: holdingById.get(row.holdingId) ?? "Inactive holding", kind: row.kind, amountUgx: row.amountUgx, account: row.account, occurredOn: row.occurredOn, note: row.note })),
      loans: loans.map(row => ({ _id: row._id, lender: row.lender, principalUgx: row.principalUgx, outstandingPrincipalUgx: row.outstandingPrincipalUgx, annualRateBps: row.annualRateBps, termMonths: row.termMonths, startedOn: row.startedOn, account: row.account, status: row.status })),
      loanRepayments: loanRepayments.map(row => ({ _id: row._id, lender: loanById.get(row.loanId) ?? "Loan", amountUgx: row.amountUgx, principalUgx: row.principalUgx, interestUgx: row.interestUgx, account: row.account, paidOn: row.paidOn })),
      bills: bills.map(row => ({ _id: row._id, name: row.name, category: row.category, amountUgx: row.amountUgx, account: row.account, recurrence: row.recurrence, nextDueOn: row.nextDueOn, active: row.active })),
      billPayments: billPayments.map(row => ({ _id: row._id, billName: billById.get(row.billId) ?? "Inactive bill", amountUgx: row.amountUgx, paidOn: row.paidOn })),
      reconciliations: reconciliations.map(row => ({ _id: row._id, account: row.account, asOfDate: row.asOfDate, bookBalanceUgx: row.bookBalanceUgx, countedBalanceUgx: row.countedBalanceUgx, varianceUgx: row.varianceUgx, status: row.status, note: row.note, explanation: row.explanation })),
      partners: partners.map(row => ({ _id: row._id, name: row.name, ownershipBps: row.ownershipBps, active: row.active })),
    };
  },
});

// Partner accounts receive only their own identity, ownership percentage, and
// attributed capital contributions. Business-wide ledger totals stay private.
export const partnerStatement = query({
  args: {},
  handler: async (ctx) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role !== "partner" || !current.membership.partnerId) return { access: "restricted" as const };
    const partner = await ctx.db.get("partners", current.membership.partnerId);
    if (!partner || partner.businessId !== current.business._id || !partner.active) return { access: "restricted" as const };
    const contributions = await ctx.db.query("movements")
      .withIndex("by_business_and_partner_and_date", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id))
      .order("desc").take(100);
    const legacyCapital = partner.capitalContributedUgx === undefined
      ? await historicalPartnerCapital(ctx, current.business._id, partner._id)
      : { total: partner.capitalContributedUgx, complete: true };
    return {
      access: "ready" as const,
      partner: partner.name,
      ownershipBps: partner.ownershipBps,
      capitalContributedUgx: legacyCapital.total,
      capitalTotalComplete: legacyCapital.complete,
      contributions: contributions.filter(row => row.kind === "capital_contribution" && row.state === "posted").map(row => ({
        _id: row._id, occurredOn: row.occurredOn, amountUgx: row.amountUgx, account: row.toAccount ?? "cash", note: row.note,
      })),
    };
  },
});

export const createMovement = mutation({
  args: {
    kind: v.union(v.literal("transfer"), v.literal("withdrawal"), v.literal("deposit"), v.literal("capital_contribution")),
    amountUgx: v.number(), feeUgx: v.optional(v.number()), fromAccount: v.optional(accountV), toAccount: v.optional(accountV),
    partnerId: v.optional(v.id("partners")), occurredOn: v.string(), note: v.string(), idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()),
  },
  returns: v.id("movements"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role === "partner") throw new Error("Only an active owner or cashier can record a movement.");
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
    if (args.kind === "withdrawal" && feeUgx > 0) await postExpense(ctx, { businessId: current.business._id, userId: current.userId, amountUgx: feeUgx, occurredOn: args.occurredOn, account: "mobile_money", category: "Mobile money withdrawal fee", note: args.note.trim() || "Fee for cash withdrawal", idempotencyKey: `movement-fee:${args.idempotencyKey}`, action: "movement.fee_recorded" });
    await audit(ctx, current, "movement.created", "movement", movementId, `${args.kind.replaceAll("_", " ")} · ${args.amountUgx}${feeUgx ? ` + ${feeUgx} fee` : ""} · ${args.occurredOn}`);
    return movementId;
  },
});

export const createSavingsHolding = mutation({
  args: { name: v.string(), targetUgx: v.optional(v.number()), idempotencyKey: v.string() }, returns: v.id("savingsHoldings"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role === "partner") throw new Error("Only an active owner or cashier can manage savings holdings.");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Name the savings goal using 2 to 80 characters.");
    const request = await ctx.db.query("savingsHoldings").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (request) {
      assertSameRequest(request.name === name && request.targetUgx === args.targetUgx);
      return request._id;
    }
    if (args.targetUgx !== undefined && (!Number.isSafeInteger(args.targetUgx) || args.targetUgx <= 0)) throw new Error("Target must be a positive whole-unit amount.");
    const duplicate = await ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(100);
    if (duplicate.some(row => row.name.toLowerCase() === name.toLowerCase())) throw new Error("A savings goal with this name already exists.");
    const holdingId = await ctx.db.insert("savingsHoldings", { businessId: current.business._id, name, targetUgx: args.targetUgx, balanceUgx: 0, active: true, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "savings.holding_created", "savingsHolding", holdingId, `Created savings holding: ${name}.`);
    return holdingId;
  },
});

export const recordSavingsFlow = mutation({
  args: { holdingId: v.id("savingsHoldings"), kind: v.union(v.literal("contribution"), v.literal("withdrawal")), amountUgx: v.number(), account: accountV, occurredOn: v.string(), note: v.string(), idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.id("savingsFlows"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role === "partner") throw new Error("Only an active owner or cashier can record savings activity.");
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

export const createLoan = mutation({
  args: { lender: v.string(), principalUgx: v.number(), annualRateBps: v.number(), termMonths: v.number(), startedOn: v.string(), account: accountV, note: v.string(), idempotencyKey: v.string() },
  returns: v.id("loans"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can register a loan.");
    const lender = args.lender.trim();
    if (lender.length < 2 || lender.length > 100 || !Number.isSafeInteger(args.principalUgx) || args.principalUgx <= 0 || !Number.isSafeInteger(args.annualRateBps) || args.annualRateBps < 0 || args.annualRateBps > 1_000_000 || !Number.isSafeInteger(args.termMonths) || args.termMonths < 1 || args.termMonths > 600 || !validDay(args.startedOn) || args.note.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Loan details are invalid.");
    const duplicate = await ctx.db.query("loans").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.lender === lender && duplicate.principalUgx === args.principalUgx && duplicate.annualRateBps === args.annualRateBps && duplicate.termMonths === args.termMonths && duplicate.startedOn === args.startedOn && duplicate.account === args.account && duplicate.note === args.note.trim());
      return duplicate._id;
    }
    await applyAccountDelta(ctx, current.business._id, args.account, args.principalUgx);
    const loanId = await ctx.db.insert("loans", { businessId: current.business._id, lender, principalUgx: args.principalUgx, outstandingPrincipalUgx: args.principalUgx, annualRateBps: args.annualRateBps, termMonths: args.termMonths, startedOn: args.startedOn, account: args.account, status: "active", note: args.note.trim(), idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "loan.disbursed", "loan", loanId, `Loan disbursed from ${lender}; not classified as sales income.`);
    return loanId;
  },
});

export const recordLoanRepayment = mutation({
  args: { loanId: v.id("loans"), principalUgx: v.number(), interestUgx: v.number(), paidOn: v.string(), account: accountV, idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.id("loanRepayments"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can record loan repayments.");
    if (!Number.isSafeInteger(args.principalUgx) || args.principalUgx <= 0 || !Number.isSafeInteger(args.interestUgx) || args.interestUgx < 0 || !validDay(args.paidOn) || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Repayment details are invalid.");
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
    if (args.interestUgx > 0) await postExpense(ctx, { businessId: current.business._id, userId: current.userId, amountUgx: args.interestUgx, occurredOn: args.paidOn, account: args.account, category: "Loan interest", note: `Interest repayment to ${loan.lender}`, idempotencyKey: `loan-interest:${args.idempotencyKey}`, action: "loan.interest_recorded" });
    const outstandingPrincipalUgx = loan.outstandingPrincipalUgx - args.principalUgx;
    await ctx.db.patch("loans", loan._id, { outstandingPrincipalUgx, status: outstandingPrincipalUgx === 0 ? "paid_off" : "active" });
    const repaymentId = await ctx.db.insert("loanRepayments", { businessId: current.business._id, loanId: loan._id, amountUgx, principalUgx: args.principalUgx, interestUgx: args.interestUgx, account: args.account, paidOn: args.paidOn, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "loan.repayment_recorded", "loanRepayment", repaymentId, `Repayment · principal ${args.principalUgx} · interest ${args.interestUgx} · ${args.paidOn}`);
    return repaymentId;
  },
});

function nextOccurrence(day: string, recurrence: "weekly" | "monthly" | "quarterly" | "yearly") {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else {
    const originalDay = date.getUTCDate();
    const months = recurrence === "monthly" ? 1 : recurrence === "quarterly" ? 3 : 12;
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

export const createBill = mutation({
  args: { name: v.string(), category: v.string(), amountUgx: v.number(), account: accountV, recurrence: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("yearly")), nextDueOn: v.string(), idempotencyKey: v.string() },
  returns: v.id("bills"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can configure recurring bills.");
    const name = args.name.trim();
    const category = args.category.trim();
    if (name.length < 2 || name.length > 100 || category.length < 1 || category.length > 80 || !Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0 || !validDay(args.nextDueOn) || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Bill details are invalid.");
    const duplicate = await ctx.db.query("bills").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.name === name && duplicate.category === category && duplicate.amountUgx === args.amountUgx && duplicate.account === args.account && duplicate.recurrence === args.recurrence && duplicate.nextDueOn === args.nextDueOn);
      return duplicate._id;
    }
    const billId = await ctx.db.insert("bills", { businessId: current.business._id, name, category, amountUgx: args.amountUgx, account: args.account, recurrence: args.recurrence, nextDueOn: args.nextDueOn, active: true, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "bill.created", "bill", billId, `Configured ${name}; future payments are not booked automatically.`);
    return billId;
  },
});

export const recordBillPayment = mutation({
  args: { billId: v.id("bills"), paidOn: v.string(), amountUgx: v.optional(v.number()), idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.id("billPayments"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can confirm a bill payment.");
    if (!validDay(args.paidOn) || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Payment details are invalid.");
    const bill = await ctx.db.get("bills", args.billId);
    if (!bill || bill.businessId !== current.business._id || !bill.active) throw new Error("Active bill not found.");
    const amountUgx = args.amountUgx ?? bill.amountUgx;
    if (!Number.isSafeInteger(amountUgx) || amountUgx <= 0) throw new Error("Payment amount must be a positive whole-unit amount.");
    const duplicate = await ctx.db.query("billPayments").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (duplicate) {
      assertSameRequest(duplicate.billId === args.billId && duplicate.paidOn === args.paidOn && duplicate.amountUgx === amountUgx);
      return duplicate._id;
    }
    await checkOutflow(ctx, current.business._id, bill.account, -amountUgx, args.confirmNegativeBalance ?? false);
    await applyAccountDelta(ctx, current.business._id, bill.account, -amountUgx);
    const entryId = await postExpense(ctx, { businessId: current.business._id, userId: current.userId, amountUgx, occurredOn: args.paidOn, account: bill.account, category: bill.category, note: `Bill payment: ${bill.name}`, idempotencyKey: `bill-expense:${args.idempotencyKey}`, action: "bill.payment_expense_recorded" });
    await ctx.db.patch("bills", bill._id, { nextDueOn: nextOccurrence(bill.nextDueOn, bill.recurrence) });
    const paymentId = await ctx.db.insert("billPayments", { businessId: current.business._id, billId: bill._id, entryId, amountUgx, paidOn: args.paidOn, idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await audit(ctx, current, "bill.payment_recorded", "billPayment", paymentId, `${bill.name} · ${amountUgx} · ${args.paidOn}`);
    return paymentId;
  },
});

export const createReconciliation = mutation({
  args: { account: accountV, asOfDate: v.string(), countedBalanceUgx: v.number(), note: v.string(), idempotencyKey: v.string() },
  returns: v.id("reconciliations"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role === "partner") throw new Error("Only an active owner or cashier can record a reconciliation count.");
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

export const explainReconciliation = mutation({
  args: { reconciliationId: v.id("reconciliations"), explanation: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can close a reconciliation difference.");
    const explanation = args.explanation.trim();
    if (explanation.length < 5 || explanation.length > 300) throw new Error("Explain the difference in 5 to 300 characters.");
    const row = await ctx.db.get("reconciliations", args.reconciliationId);
    if (!row || row.businessId !== current.business._id) throw new Error("Reconciliation not found.");
    if (row.status === "matched") throw new Error("A matched reconciliation needs no explanation.");
    await ctx.db.patch("reconciliations", row._id, { status: "explained", explanation, resolvedBy: current.userId, resolvedAt: Date.now() });
    await audit(ctx, current, "reconciliation.explained", "reconciliation", row._id, `Variance ${row.varianceUgx} explained: ${explanation}`);
    return null;
  },
});

export const createPartner = mutation({
  args: { name: v.string(), ownershipBps: v.number(), idempotencyKey: v.string() }, returns: v.id("partners"),
  handler: async (ctx, args) => {
    const current = await workspace(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can manage partner ownership.");
    const name = args.name.trim();
    if (name.length < 2 || name.length > 100 || !Number.isSafeInteger(args.ownershipBps) || args.ownershipBps < 0 || args.ownershipBps > 10_000 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Partner details are invalid.");
    const previous = await ctx.db.query("partners").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (previous) {
      assertSameRequest(previous.name === name && previous.ownershipBps === args.ownershipBps);
      return previous._id;
    }
    const partners = await ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(100);
    if (partners.some(row => row.name.toLowerCase() === name.toLowerCase())) throw new Error("A partner with this name already exists.");
    if (partners.reduce((sum, row) => safeAdd(sum, row.ownershipBps, "Ownership"), args.ownershipBps) > 10_000) throw new Error("Active partner ownership cannot exceed 100%.");
    const partnerId = await ctx.db.insert("partners", { businessId: current.business._id, name, ownershipBps: args.ownershipBps, capitalContributedUgx: 0, active: true, idempotencyKey: args.idempotencyKey });
    await audit(ctx, current, "partner.created", "partner", partnerId, `${name} added with ${args.ownershipBps / 100}% ownership.`);
    return partnerId;
  },
});
