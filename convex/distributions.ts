import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getSelectedWorkspace } from "./workspaceContext";
import { hasPermission } from "./accessControl";

type Ctx = QueryCtx | MutationCtx;
type ActiveWorkspace = { userId: Id<"users">; membership: Doc<"memberships">; business: Doc<"businesses"> };

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

function shiftDay(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function businessDay(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
}

function dayAt(timestamp: number, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
}

async function workspace(ctx: Ctx, businessId?: Id<"businesses">): Promise<ActiveWorkspace | null> {
  if (!businessId) return await getSelectedWorkspace(ctx);
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  if (!membership?.active) return null;
  const business = await ctx.db.get("businesses", businessId);
  return business ? { userId, membership, business } : null;
}

async function requireOwner(ctx: Ctx, businessId: Id<"businesses">) {
  const current = await workspace(ctx, businessId);
  if (!current || !(await hasPermission(ctx, current.membership, "partners.distributions.manage"))) throw new Error("Your role cannot prepare distributions or record partner payouts.");
  return current;
}

async function appendAudit(ctx: MutationCtx, current: ActiveWorkspace, action: string, entityType: string, entityId: string, summary: string) {
  await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action, entityType, entityId, occurredAt: Date.now(), summary });
}

async function ownershipAt(ctx: Ctx, businessId: Id<"businesses">, partners: { _id: Id<"partners">; name: string; ownershipBps: number }[], day: string) {
  return await Promise.all(partners.map(async partner => {
    const record = await ctx.db.query("partnerOwnershipHistory")
      .withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", businessId).eq("partnerId", partner._id).lte("effectiveOn", day))
      .order("desc").first();
    if (record) return { id: partner._id, name: partner.name, ownershipBps: record.ownershipBps, existedAtPeriodEnd: true };
    const firstRecord = await ctx.db.query("partnerOwnershipHistory")
      .withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", businessId).eq("partnerId", partner._id))
      .order("asc").first();
    return { id: partner._id, name: partner.name, ownershipBps: firstRecord ? 0 : partner.ownershipBps, existedAtPeriodEnd: !firstRecord };
  }));
}

function allocation(amount: number, partners: { id: Id<"partners">; name: string; ownershipBps: number }[]) {
  const amountBig = BigInt(amount);
  const rows = partners.map(partner => {
    const numerator = amountBig * BigInt(partner.ownershipBps);
    const denominator = BigInt(10000);
    return { ...partner, amountUgx: Number(numerator / denominator), remainder: numerator % denominator };
  });
  let remaining = amount - rows.reduce((sum, row) => sum + row.amountUgx, 0);
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? String(a.id).localeCompare(String(b.id)) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; remaining > 0; index++, remaining--) ranked[index % ranked.length].amountUgx++;
  return rows;
}

export const setOwnership = mutation({
  args: {
    businessId: v.id("businesses"),
    effectiveOn: v.string(),
    changes: v.array(v.object({ partnerId: v.id("partners"), ownershipBps: v.number(), legacyEffectiveOn: v.optional(v.string()) })),
    idempotencyKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await requireOwner(ctx, args.businessId);
    const today = businessDay(current.business.timezone);
    if (!validDay(args.effectiveOn) || args.effectiveOn < today) throw new Error("Ownership changes can take effect today or later; earlier periods cannot be rewritten.");
    if (args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Refresh the ownership form and try again.");
    const prior = await ctx.db.query("partnerOwnershipHistory").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", `${args.idempotencyKey}:batch`)).unique();
    if (prior) {
      const savedRows = await Promise.all(args.changes.map(async row => {
        const saved = await ctx.db.query("partnerOwnershipHistory").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", `${args.idempotencyKey}:${row.partnerId}`)).unique();
        return saved;
      }));
      if (prior.effectiveOn !== args.effectiveOn || savedRows.some((saved, index) => saved?.partnerId !== args.changes[index].partnerId || saved.ownershipBps !== args.changes[index].ownershipBps || saved.effectiveOn !== args.effectiveOn)) {
        throw new Error("This ownership request key was already used for different shares or an effective date.");
      }
      return null;
    }
    const partners = await ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(101);
    if (partners.length === 0 || partners.length > 100) throw new Error("Add or review the active partner records before changing ownership.");
    if (args.changes.length !== partners.length || new Set(args.changes.map(row => row.partnerId)).size !== partners.length) throw new Error("Submit one ownership share for every active partner.");
    const byId = new Map(args.changes.map(row => [row.partnerId, row.ownershipBps]));
    if (partners.some(partner => !byId.has(partner._id))) throw new Error("Submit one ownership share for every active partner.");
    if (args.changes.some(row => !Number.isSafeInteger(row.ownershipBps) || row.ownershipBps < 0 || row.ownershipBps > 10000)) throw new Error("Ownership shares must be whole basis points between 0% and 100%.");
    const total = args.changes.reduce((sum, row) => safeAdd(sum, row.ownershipBps, "Ownership total"), 0);
    if (total !== 10000) throw new Error("Ownership must total exactly 100% before saving a distribution-ready snapshot.");
    const now = Date.now();
    for (const partner of partners) {
      const history = await ctx.db.query("partnerOwnershipHistory").withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id)).first();
      if (!history) {
        // Legacy partner rows have no creation date. The owner must attest the
        // historical start date for the current share instead of silently
        // inferring it from a later capital movement or workspace creation.
        const legacyStart = args.changes.find(row => row.partnerId === partner._id)?.legacyEffectiveOn;
        if (!legacyStart || !validDay(legacyStart) || legacyStart > today || legacyStart >= args.effectiveOn) throw new Error(`Confirm when ${partner.name}'s current ownership share began before the new share takes effect.`);
        await ctx.db.insert("partnerOwnershipHistory", { businessId: current.business._id, partnerId: partner._id, ownershipBps: partner.ownershipBps, effectiveOn: legacyStart, createdBy: current.userId, createdAt: now, idempotencyKey: `${args.idempotencyKey}:baseline:${partner._id}` });
      }
      const ownershipBps = byId.get(partner._id)!;
      await ctx.db.insert("partnerOwnershipHistory", { businessId: current.business._id, partnerId: partner._id, ownershipBps, effectiveOn: args.effectiveOn, createdBy: current.userId, createdAt: now, idempotencyKey: `${args.idempotencyKey}:${partner._id}` });
      if (args.effectiveOn === today) await ctx.db.patch("partners", partner._id, { ownershipBps });
    }
    await ctx.db.insert("partnerOwnershipHistory", { businessId: current.business._id, partnerId: partners[0]._id, ownershipBps: byId.get(partners[0]._id)!, effectiveOn: args.effectiveOn, createdBy: current.userId, createdAt: now, idempotencyKey: `${args.idempotencyKey}:batch` });
    await appendAudit(ctx, current, "partner.ownership.updated", "partner_ownership", args.effectiveOn, `Updated active partner ownership effective ${args.effectiveOn}; total ${(total / 100).toFixed(2)}%.`);
    return null;
  },
});

export const create = mutation({
  args: { businessId: v.id("businesses"), periodFrom: v.string(), periodToExclusive: v.string(), distributionUgx: v.number(), reserveUgx: v.number(), minimumPayoutUgx: v.number(), idempotencyKey: v.string() },
  returns: v.id("partnerDistributions"),
  handler: async (ctx, args) => {
    const current = await requireOwner(ctx, args.businessId);
    const { business } = current;
    if (!validDay(args.periodFrom) || !validDay(args.periodToExclusive) || args.periodFrom >= args.periodToExclusive) throw new Error("Choose a valid distribution period.");
    const days = (Date.parse(`${args.periodToExclusive}T00:00:00.000Z`) - Date.parse(`${args.periodFrom}T00:00:00.000Z`)) / 86_400_000;
    if (days > 370) throw new Error("A distribution can cover at most 370 days.");
    if (args.periodToExclusive > shiftDay(businessDay(business.timezone), 1)) throw new Error("A distribution cannot include future dates.");
    if (!Number.isSafeInteger(args.distributionUgx) || args.distributionUgx <= 0 || !Number.isSafeInteger(args.reserveUgx) || args.reserveUgx < 0 || !Number.isSafeInteger(args.minimumPayoutUgx) || args.minimumPayoutUgx < 0) throw new Error("Enter a positive distribution amount and non-negative reserve and minimum payout using whole minor units.");
    if (args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Refresh the distribution form and review the saved requests.");
    const previous = await ctx.db.query("partnerDistributions").withIndex("by_business_and_idempotency", q => q.eq("businessId", business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (previous) {
      if (previous.periodFrom !== args.periodFrom || previous.periodToExclusive !== args.periodToExclusive || previous.distributionUgx !== args.distributionUgx || previous.reserveUgx !== args.reserveUgx || previous.minimumPayoutUgx !== args.minimumPayoutUgx) throw new Error("This request key was already used for different distribution details.");
      return previous._id;
    }
    const activePeriods = await ctx.db.query("partnerDistributions").withIndex("by_business_and_period_start", q => q.eq("businessId", business._id).lt("periodFrom", args.periodToExclusive)).take(5001);
    if (activePeriods.length > 5000) throw new Error("There are too many earlier distribution periods to safely check overlap. Ask support to review the history.");
    const overlapping = activePeriods.find(row => row.periodToExclusive > args.periodFrom && !["rejected", "cancelled"].includes(row.status));
    if (overlapping) throw new Error("This period overlaps another pending or completed distribution. Review that distribution first to avoid allocating the same profit twice.");
    const daily = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", business._id).gte("day", args.periodFrom).lt("day", args.periodToExclusive)).take(370);
    const salesUgx = daily.reduce((sum, row) => safeAdd(sum, row.salesUgx, "Period sales"), 0);
    const expensesUgx = daily.reduce((sum, row) => safeAdd(sum, row.expensesUgx, "Period expenses"), 0);
    const profitUgx = safeAdd(salesUgx, -expensesUgx, "Cashbook net");
    if (profitUgx <= 0) throw new Error("This period has no positive recorded cashbook net available for distribution.");
    if (args.distributionUgx > profitUgx) throw new Error("The proposed distribution cannot exceed positive recorded cashbook net for this period.");
    const partnerHistory = await ctx.db.query("partners").withIndex("by_business", q => q.eq("businessId", business._id)).take(501);
    if (partnerHistory.length === 0 || partnerHistory.length > 500) throw new Error("Review partner history before preparing a distribution; this workspace exceeds the safe historical partner limit.");
    const ownership = (await ownershipAt(ctx, business._id, partnerHistory, shiftDay(args.periodToExclusive, -1))).filter(row => row.existedAtPeriodEnd && row.ownershipBps > 0);
    const totalBps = ownership.reduce((sum, row) => safeAdd(sum, row.ownershipBps, "Partner ownership"), 0);
    if (totalBps !== 10000) throw new Error(`Active ownership for ${shiftDay(args.periodToExclusive, -1)} must total exactly 100%; it currently totals ${(totalBps / 100).toFixed(2)}%.`);
    const balances = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", business._id)).take(2);
    const liquid = balances.reduce((sum, row) => safeAdd(sum, row.balanceUgx, "Account balances"), 0);
    if (liquid - args.reserveUgx < args.distributionUgx) throw new Error("The proposed distribution would leave less than the cash reserve in recorded cash and mobile-money balances.");
    const allocations = allocation(args.distributionUgx, ownership);
    if (args.minimumPayoutUgx > 0 && allocations.some(row => row.amountUgx < args.minimumPayoutUgx)) throw new Error("At least one partner allocation is below the minimum payout threshold. Increase the distribution or lower the threshold.");
    const distributionId = await ctx.db.insert("partnerDistributions", { businessId: business._id, periodFrom: args.periodFrom, periodToExclusive: args.periodToExclusive, profitUgx, distributionUgx: args.distributionUgx, reserveUgx: args.reserveUgx, minimumPayoutUgx: args.minimumPayoutUgx, paidUgx: 0, status: "pending_approval", createdBy: current.userId, createdAt: Date.now(), idempotencyKey: args.idempotencyKey });
    for (const row of allocations) {
      await ctx.db.insert("partnerDistributionItems", { businessId: business._id, distributionId, partnerId: row.id, partnerName: row.name, ownershipBps: row.ownershipBps, amountUgx: row.amountUgx, paidUgx: 0 });
    }
    await appendAudit(ctx, current, "partner_distribution.prepared", "partner_distribution", distributionId, `Prepared ${args.distributionUgx} for ${args.periodFrom} to ${args.periodToExclusive}; minimum payout ${args.minimumPayoutUgx}; awaiting independent approval.`);
    return distributionId;
  },
});

export const decide = mutation({
  args: { businessId: v.id("businesses"), distributionId: v.id("partnerDistributions"), decision: v.union(v.literal("approve"), v.literal("reject")), reason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || !(await hasPermission(ctx, current.membership, "partners.distributions.approve"))) throw new Error("Your role cannot review a distribution.");
    const row = await ctx.db.get("partnerDistributions", args.distributionId);
    if (!row || row.businessId !== current.business._id || row.status !== "pending_approval") throw new Error("This distribution is not awaiting a decision.");
    if (row.createdBy === current.userId) throw new Error("The person who prepared a distribution cannot approve or reject it.");
    const now = Date.now();
    if (args.decision === "approve") {
      const daily = await ctx.db.query("dailyTotals")
        .withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).gte("day", row.periodFrom).lt("day", row.periodToExclusive))
        .take(370);
      const currentProfit = safeAdd(
        daily.reduce((sum, item) => safeAdd(sum, item.salesUgx, "Period sales"), 0),
        -daily.reduce((sum, item) => safeAdd(sum, item.expensesUgx, "Period expenses"), 0),
        "Current cashbook net",
      );
      if (currentProfit <= 0 || row.distributionUgx > currentProfit) throw new Error("Recorded cashbook net has changed and no longer supports this request. Cancel it and prepare a new distribution from the corrected period.");
      const balances = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id)).take(2);
      const liquid = balances.reduce((sum, item) => safeAdd(sum, item.balanceUgx, "Account balances"), 0);
      if (liquid - row.reserveUgx < row.distributionUgx) throw new Error("Current balances no longer support this distribution and its reserve. Cancel it and prepare a smaller amount.");
      await ctx.db.patch("partnerDistributions", row._id, { status: "approved", approvedBy: current.userId, approvedAt: now });
      await appendAudit(ctx, current, "partner_distribution.approved", "partner_distribution", row._id, `Approved ${row.distributionUgx}; reserved minimum ${row.reserveUgx}.`);
    } else {
      const reason = (args.reason ?? "").trim();
      if (reason.length < 5 || reason.length > 300) throw new Error("Give a rejection reason between 5 and 300 characters.");
      await ctx.db.patch("partnerDistributions", row._id, { status: "rejected", rejectedBy: current.userId, rejectedAt: now, rejectionReason: reason });
      await appendAudit(ctx, current, "partner_distribution.rejected", "partner_distribution", row._id, `Rejected the distribution: ${reason}`);
    }
    return null;
  },
});

export const cancel = mutation({
  args: { businessId: v.id("businesses"), distributionId: v.id("partnerDistributions"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await requireOwner(ctx, args.businessId);
    const row = await ctx.db.get("partnerDistributions", args.distributionId);
    const reason = args.reason.trim();
    if (!row || row.businessId !== current.business._id || row.status !== "pending_approval") throw new Error("Only a pending distribution can be cancelled.");
    if (reason.length < 5 || reason.length > 300) throw new Error("Give a cancellation reason between 5 and 300 characters.");
    await ctx.db.patch("partnerDistributions", row._id, { status: "cancelled", cancelledBy: current.userId, cancelledAt: Date.now(), cancellationReason: reason });
    await appendAudit(ctx, current, "partner_distribution.cancelled", "partner_distribution", row._id, `Cancelled the pending distribution: ${reason}`);
    return null;
  },
});

export const pay = mutation({
  args: { businessId: v.id("businesses"), distributionId: v.id("partnerDistributions"), itemId: v.id("partnerDistributionItems"), amountUgx: v.number(), account: v.union(v.literal("cash"), v.literal("mobile_money")), paidOn: v.string(), note: v.string(), idempotencyKey: v.string() },
  returns: v.id("partnerPayouts"),
  handler: async (ctx, args) => {
    const current = await requireOwner(ctx, args.businessId);
    if (!Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0 || !validDay(args.paidOn) || args.paidOn > businessDay(current.business.timezone) || args.note.trim().length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Enter a valid payout amount, business date, note, and request key.");
    const previous = await ctx.db.query("partnerPayouts").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (previous) {
      if (previous.distributionId !== args.distributionId || previous.distributionItemId !== args.itemId || previous.amountUgx !== args.amountUgx || previous.account !== args.account || previous.paidOn !== args.paidOn || previous.note !== args.note.trim()) throw new Error("This request key was already used for different payout details.");
      return previous._id;
    }
    const distribution = await ctx.db.get("partnerDistributions", args.distributionId);
    const item = await ctx.db.get("partnerDistributionItems", args.itemId);
    if (!distribution || distribution.businessId !== current.business._id || !["approved", "partially_paid"].includes(distribution.status) || !item || item.businessId !== current.business._id || item.distributionId !== distribution._id) throw new Error("Choose an approved distribution and one of its partner allocations.");
    if (!distribution.approvedAt || args.paidOn < dayAt(distribution.approvedAt, current.business.timezone)) throw new Error("Payout dates cannot be earlier than the approval date.");
    if (args.amountUgx > item.amountUgx - item.paidUgx) throw new Error("The payout exceeds this partner’s approved unpaid amount.");
    const unpaidAllocation = item.amountUgx - item.paidUgx;
    if (args.amountUgx < distribution.minimumPayoutUgx && args.amountUgx !== unpaidAllocation) throw new Error("Each payout must meet the approved minimum. A smaller final balance may be paid only as the partner's full remaining allocation.");
    const balances = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id)).take(2);
    const accountRow = balances.find(row => row.account === args.account);
    if (!accountRow || accountRow.balanceUgx < args.amountUgx) throw new Error("The selected account does not have enough recorded funds for this payout.");
    const liquidAfter = balances.reduce((sum, row) => safeAdd(sum, row.balanceUgx - (row.account === args.account ? args.amountUgx : 0), "Account balances"), 0);
    if (liquidAfter < distribution.reserveUgx) throw new Error("This payout would reduce recorded cash below the approved reserve.");
    const nextPaid = safeAdd(item.paidUgx, args.amountUgx, "Partner payout total");
    const distributionPaid = safeAdd(distribution.paidUgx, args.amountUgx, "Distribution payout total");
    const nextStatus = distributionPaid === distribution.distributionUgx ? "paid" as const : "partially_paid" as const;
    const now = Date.now();
    const payoutId = await ctx.db.insert("partnerPayouts", { businessId: current.business._id, distributionId: distribution._id, distributionItemId: item._id, partnerId: item.partnerId, amountUgx: args.amountUgx, account: args.account, paidOn: args.paidOn, note: args.note.trim(), state: "posted", idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: now });
    await ctx.db.patch("partnerDistributionItems", item._id, { paidUgx: nextPaid });
    await ctx.db.patch("partnerDistributions", distribution._id, { paidUgx: distributionPaid, status: nextStatus });
    await ctx.db.patch("accountBalances", accountRow._id, { balanceUgx: safeAdd(accountRow.balanceUgx, -args.amountUgx, "Account balance"), updatedAt: now });
    await appendAudit(ctx, current, "partner_payout.recorded", "partner_payout", payoutId, `Recorded ${args.amountUgx} paid to ${item.partnerName} from ${args.account} on ${args.paidOn}.`);
    return payoutId;
  },
});

export const reversePayout = mutation({
  args: { businessId: v.id("businesses"), payoutId: v.id("partnerPayouts"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await requireOwner(ctx, args.businessId);
    const payout = await ctx.db.get("partnerPayouts", args.payoutId);
    const reason = args.reason.trim();
    if (!payout || payout.businessId !== current.business._id || payout.state !== "posted") throw new Error("Choose an unreversed payout in this workspace.");
    if (reason.length < 5 || reason.length > 300) throw new Error("Give a reversal reason between 5 and 300 characters.");
    const [item, distribution, balance] = await Promise.all([
      ctx.db.get("partnerDistributionItems", payout.distributionItemId),
      ctx.db.get("partnerDistributions", payout.distributionId),
      ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", payout.account)).unique(),
    ]);
    if (!item || !distribution || !balance || item.businessId !== current.business._id || distribution.businessId !== current.business._id) throw new Error("The related payout records need support review before they can be reversed.");
    const now = Date.now();
    const itemPaid = safeAdd(item.paidUgx, -payout.amountUgx, "Partner allocation paid total");
    const distributionPaid = safeAdd(distribution.paidUgx, -payout.amountUgx, "Distribution paid total");
    const nextStatus = distributionPaid === 0 ? "approved" as const : "partially_paid" as const;
    await ctx.db.patch("partnerPayouts", payout._id, { state: "reversed", reversedBy: current.userId, reversedAt: now, reversalReason: reason });
    await ctx.db.patch("partnerDistributionItems", item._id, { paidUgx: itemPaid });
    await ctx.db.patch("partnerDistributions", distribution._id, { paidUgx: distributionPaid, status: nextStatus });
    await ctx.db.patch("accountBalances", balance._id, { balanceUgx: safeAdd(balance.balanceUgx, payout.amountUgx, "Account balance"), updatedAt: now });
    await appendAudit(ctx, current, "partner_payout.reversed", "partner_payout", payout._id, `Reversed payout ${payout.amountUgx}: ${reason}`);
    return null;
  },
});

export const overview = query({
  args: { businessId: v.id("businesses"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || (!(await hasPermission(ctx, current.membership, "partners.distributions.manage")) && !(await hasPermission(ctx, current.membership, "partners.distributions.approve")))) return { access: "restricted" as const };
    if (args.paginationOpts.numItems > 20) throw new Error("Distribution history pages are limited to 20 records.");
    const page = await ctx.db.query("partnerDistributions").withIndex("by_business_and_period_start", q => q.eq("businessId", current.business._id)).order("desc").paginate(args.paginationOpts);
    const activePartners = await ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(101);
    const ownershipBaselines = await Promise.all(activePartners.map(async partner => {
      const [history, movement] = await Promise.all([
        ctx.db.query("partnerOwnershipHistory").withIndex("by_business_and_partner_and_effectiveOn", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id)).first(),
        ctx.db.query("movements").withIndex("by_business_and_partner_and_date", q => q.eq("businessId", current.business._id).eq("partnerId", partner._id)).order("asc").first(),
      ]);
      return history ? null : { partnerId: partner._id, suggestedEffectiveOn: movement?.occurredOn ?? dayAt(current.business.createdAt, current.business.timezone) };
    }));
    const distributions = await Promise.all(page.page.map(async row => {
      const [items, author] = await Promise.all([
        ctx.db.query("partnerDistributionItems").withIndex("by_business_and_distribution", q => q.eq("businessId", current.business._id).eq("distributionId", row._id)).take(101),
        ctx.db.get("users", row.createdBy),
      ]);
      const canApprove = await hasPermission(ctx, current.membership, "partners.distributions.approve");
      return { ...row, preparedBy: author?.email ?? "Workspace owner", canDecide: row.createdBy !== current.userId && canApprove, items };
    }));
    const activeMembers = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", current.business._id)).take(100);
    const approverFlags = await Promise.all(activeMembers.filter(row => row.active).map(row => hasPermission(ctx, row, "partners.distributions.approve")));
    const hasFinanceApprover = approverFlags.some(Boolean);
    return { access: "ready" as const, businessId: current.business._id, role: current.membership.role,
      canManageDistributions: await hasPermission(ctx, current.membership, "partners.distributions.manage"),
      canApproveDistributions: await hasPermission(ctx, current.membership, "partners.distributions.approve"),
      canManagePartners: await hasPermission(ctx, current.membership, "partners.manage"),
      distributions, continueCursor: page.continueCursor, isDone: page.isDone, hasFinanceApprover, ownershipBaselines: ownershipBaselines.filter((row): row is NonNullable<typeof row> => row !== null), currency: current.business.currency };
  },
});

export const payoutHistory = query({
  args: { businessId: v.id("businesses"), distributionId: v.id("partnerDistributions"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const current = await workspace(ctx, args.businessId);
    if (!current || (!(await hasPermission(ctx, current.membership, "partners.distributions.manage")) && !(await hasPermission(ctx, current.membership, "partners.distributions.approve")))) return { access: "restricted" as const };
    if (args.paginationOpts.numItems > 50) throw new Error("Payout history pages are limited to 50 records.");
    const distribution = await ctx.db.get("partnerDistributions", args.distributionId);
    if (!distribution || distribution.businessId !== current.business._id) return { access: "restricted" as const };
    const page = await ctx.db.query("partnerPayouts")
      .withIndex("by_business_and_distribution", q => q.eq("businessId", current.business._id).eq("distributionId", distribution._id))
      .order("desc")
      .paginate(args.paginationOpts);
    const payouts = await Promise.all(page.page.map(async payout => {
      const item = await ctx.db.get("partnerDistributionItems", payout.distributionItemId);
      return { ...payout, partnerName: item?.businessId === current.business._id ? item.partnerName : "Partner" };
    }));
    return { access: "ready" as const, payouts, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});
