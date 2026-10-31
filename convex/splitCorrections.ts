import { ConvexError, v } from "convex/values";
import { getSelectedWorkspace } from "./workspaceContext";
import { hasPermission } from "./accessControl";
import { assertPeriodUnlocked } from "./periodLocks";
import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const allocationValidator = v.array(v.object({ amountUgx: v.number(), category: v.string(), account: v.union(v.literal("cash"), v.literal("mobile_money"), v.literal("unallocated")) }));

async function context(ctx: MutationCtx, businessId: Id<"businesses">, kind: "sale" | "expense") {
  const current = await getSelectedWorkspace(ctx);
  if (!current || current.business._id !== businessId) throw new ConvexError("Select an active workspace before correcting an entry.");
  const permission = kind === "sale" ? "sales.update" : "expenses.update";
  if (!(await hasPermission(ctx, current.membership, permission))) throw new ConvexError("Your role cannot correct this entry.");
  return current;
}

function validateAllocations(allocations: Array<{ amountUgx: number; category: string }>, totalUgx: number) {
  if (allocations.length < 2 || allocations.length > 20) throw new ConvexError("A split must contain between 2 and 20 allocations.");
  let sum = 0;
  for (const item of allocations) {
    const category = item.category.trim();
    if (!Number.isSafeInteger(item.amountUgx) || item.amountUgx <= 0 || !category || category.length > 80) throw new ConvexError("Each allocation needs a positive whole-shilling amount and a category of 1 to 80 characters.");
    sum += item.amountUgx;
    if (!Number.isSafeInteger(sum)) throw new ConvexError("Allocation total is outside the safe whole-shilling range.");
  }
  if (sum !== totalUgx) throw new ConvexError("Allocation amounts must add up exactly to the original entry amount.");
}

export const saveEstimate = mutation({
  args: { businessId: v.id("businesses"), entryId: v.id("entries"), allocations: allocationValidator, reason: v.string(), idempotencyKey: v.string() },
  returns: v.id("entrySplitCorrections"),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get("entries", args.entryId);
    if (!entry || entry.businessId !== args.businessId) throw new ConvexError("Entry not found.");
    const current = await context(ctx, args.businessId, entry.kind);
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new ConvexError("Enter a reason between 5 and 300 characters and a valid retry key.");
    validateAllocations(args.allocations, entry.amountUgx);
    if (entry.account === "unallocated" && args.allocations.some(item => item.account !== "unallocated")) throw new ConvexError("An unallocated source entry cannot be assigned to a cash account by a category split. Correct its account separately with a reviewed correction.");
    const existing = await ctx.db.query("entrySplitCorrections").withIndex("by_business_and_idempotency", q => q.eq("businessId", args.businessId).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existing) {
      const normalized = args.allocations.map(item => ({ amountUgx: item.amountUgx, category: item.category.trim(), account: item.account }));
      const same = existing.sourceEntryId === entry._id && existing.reason === reason && existing.allocations.length === normalized.length && existing.allocations.every((item, index) => item.amountUgx === normalized[index].amountUgx && item.category === normalized[index].category && item.account === normalized[index].account);
      if (!same) throw new ConvexError("This retry key was already used for another split estimate.");
      return existing._id;
    }
    if (entry.state !== "posted" || entry.source === "webhook" || entry.source === "google_form" || entry.operationSource || entry.correctedBy || entry.correctionOf || entry.splitCorrectionId) throw new ConvexError("Only an uncorrected manual or imported entry can receive a split estimate.");
    if (entry.lineItems?.length) throw new ConvexError("Itemized expenses cannot be split by category until item details can be allocated without losing their audit trail.");
    if (entry.source === "import") {
      const match = /^csv:([a-f0-9]{64}):\d+$/.exec(entry.idempotencyKey);
      const batch = match ? await ctx.db.query("importBatches").withIndex("by_business_and_source", q => q.eq("businessId", current.business._id).eq("sourceHash", match[1])).unique() : null;
      if (!batch || (batch.status !== "completed" && batch.status !== "cancelled")) throw new ConvexError("Complete or cancel this import before splitting one of its rows.");
    }
    if (entry.splitCorrectionId) throw new ConvexError("Cancel the existing split estimate before saving a new one.");
    const normalized = args.allocations.map(item => ({ amountUgx: item.amountUgx, category: item.category.trim(), account: item.account }));
    const id = await ctx.db.insert("entrySplitCorrections", { businessId: current.business._id, sourceEntryId: entry._id, totalUgx: entry.amountUgx, occurredOn: entry.occurredOn, reason, allocations: normalized, provenance: "estimated", idempotencyKey: args.idempotencyKey, createdBy: current.userId, createdAt: Date.now() });
    await ctx.db.patch("entries", entry._id, { splitCorrectionId: id });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "entry.split_estimated", entityType: "entry", entityId: entry._id, occurredAt: Date.now(), summary: `Saved an estimated category split for ${entry.kind} · ${entry.occurredOn}.`, details: JSON.stringify({ splitCorrectionId: id, totalUgx: entry.amountUgx, reason, allocations: normalized }) });
    return id;
  },
});

export const confirmEstimate = mutation({
  args: { businessId: v.id("businesses"), splitCorrectionId: v.id("entrySplitCorrections"), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.array(v.id("entries")),
  handler: async (ctx, args) => {
    const split = await ctx.db.get("entrySplitCorrections", args.splitCorrectionId);
    if (!split || split.businessId !== args.businessId) throw new ConvexError("Split estimate not found.");
    const entry = await ctx.db.get("entries", split.sourceEntryId);
    if (!entry || entry.businessId !== split.businessId) throw new ConvexError("Source entry not found.");
    const current = await context(ctx, args.businessId, entry.kind);
    if (split.provenance === "confirmed") return split.replacementEntryIds ?? [];
    if (split.provenance !== "estimated" || entry.splitCorrectionId !== split._id || entry.state !== "posted" || entry.correctedBy || entry.operationSource) throw new ConvexError("This split estimate is no longer available to confirm.");
    await assertPeriodUnlocked(ctx, current.business._id, entry.occurredOn);
    const day = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", entry.occurredOn)).unique();
    if (!day) throw new ConvexError("Daily totals are missing; reconcile before confirming this split.");
    const accountChanges = new Map<"cash" | "mobile_money", number>();
    const balanceEffect = (kind: "sale" | "expense", amount: number) => kind === "sale" ? amount : -amount;
    const preferences = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    if (entry.account !== "unallocated") accountChanges.set(entry.account, -balanceEffect(entry.kind, entry.amountUgx));
    for (const item of split.allocations) if (item.account !== "unallocated") accountChanges.set(item.account, (accountChanges.get(item.account) ?? 0) + balanceEffect(entry.kind, item.amountUgx));
    for (const [account, delta] of accountChanges) {
      const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", account)).unique();
      const next = (balance?.balanceUgx ?? 0) + delta;
      if (!Number.isSafeInteger(next)) throw new ConvexError("Account correction cannot be represented safely.");
      if (next < 0 && preferences?.negativeBalanceWarning !== false && !args.confirmNegativeBalance) throw new ConvexError({ code: "CONFIRM_NEGATIVE", message: `This split may put ${account === "cash" ? "cash" : "mobile money"} below zero. Review the allocation before continuing.` });
    }
    const isSale = entry.kind === "sale";
    if (isSale ? day.salesUgx < entry.amountUgx || day.saleCount < 1 : day.expensesUgx < entry.amountUgx || day.expenseCount < 1) throw new ConvexError("Daily totals need reconciliation before confirming this split.");
    const nextCount = day[isSale ? "saleCount" : "expenseCount"] + split.allocations.length - 1;
    if (!Number.isSafeInteger(nextCount) || nextCount < 0) throw new ConvexError("The entry count cannot be updated safely.");
    const now = Date.now();
    const ids: Array<Id<"entries">> = [];
    for (let index = 0; index < split.allocations.length; index++) {
      const allocation = split.allocations[index];
      const id = await ctx.db.insert("entries", { businessId: current.business._id, kind: entry.kind, amountUgx: allocation.amountUgx, occurredOn: entry.occurredOn, account: allocation.account, category: allocation.category, note: entry.note, supplierId: entry.supplierId, supplierName: entry.supplierName, supplierReference: entry.supplierReference, source: entry.source, idempotencyKey: `split:${split._id}:${index}`, state: "posted", correctionOf: entry._id, splitCorrectionId: split._id, createdBy: current.userId, createdAt: now });
      ids.push(id);
    }
    await ctx.db.patch("dailyTotals", day._id, isSale ? { saleCount: nextCount } : { expenseCount: nextCount });
    for (const [account, delta] of accountChanges) {
      const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", account)).unique();
      const next = (balance?.balanceUgx ?? 0) + delta;
      if (!Number.isSafeInteger(next)) throw new ConvexError("Account correction cannot be represented safely.");
      if (balance) await ctx.db.patch("accountBalances", balance._id, { balanceUgx: next, updatedAt: now });
      else await ctx.db.insert("accountBalances", { businessId: current.business._id, account, balanceUgx: next, updatedAt: now });
    }
    await ctx.db.patch("entries", entry._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: `Split correction: ${split.reason}`, correctedBy: ids[0], splitCorrectionId: split._id });
    await ctx.db.patch("entrySplitCorrections", split._id, { provenance: "confirmed", confirmedBy: current.userId, confirmedAt: now, replacementEntryIds: ids });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "entry.split_confirmed", entityType: "entry", entityId: entry._id, occurredAt: now, summary: `Confirmed a ${split.allocations.length}-part category split for ${entry.kind} · ${entry.occurredOn}.`, details: JSON.stringify({ splitCorrectionId: split._id, replacementEntryIds: ids, totalUgx: split.totalUgx, reason: split.reason, provenance: "confirmed", negativeBalanceOverride: args.confirmNegativeBalance ?? false, allocations: split.allocations }) });
    return ids;
  },
});

export const cancelEstimate = mutation({
  args: { businessId: v.id("businesses"), splitCorrectionId: v.id("entrySplitCorrections"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const split = await ctx.db.get("entrySplitCorrections", args.splitCorrectionId);
    if (!split || split.businessId !== args.businessId) throw new ConvexError("Split estimate not found.");
    const entry = await ctx.db.get("entries", split.sourceEntryId);
    if (!entry || entry.businessId !== split.businessId) throw new ConvexError("Source entry not found.");
    const current = await context(ctx, args.businessId, entry.kind);
    const reason = args.reason.trim();
    if (split.provenance !== "estimated" || entry.splitCorrectionId !== split._id || reason.length < 5 || reason.length > 300) throw new ConvexError("Enter a cancellation reason and choose the active estimate.");
    await ctx.db.patch("entrySplitCorrections", split._id, { provenance: "cancelled" });
    await ctx.db.patch("entries", entry._id, { splitCorrectionId: undefined });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "entry.split_estimate_cancelled", entityType: "entry", entityId: entry._id, occurredAt: Date.now(), summary: `Cancelled an estimated split: ${reason}`, details: JSON.stringify({ splitCorrectionId: split._id }) });
    return null;
  },
});

export const reopenConfirmed = mutation({
  args: { businessId: v.id("businesses"), splitCorrectionId: v.id("entrySplitCorrections"), reason: v.string(), idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const split = await ctx.db.get("entrySplitCorrections", args.splitCorrectionId);
    if (!split || split.businessId !== args.businessId) throw new ConvexError("Split correction not found.");
    const entry = await ctx.db.get("entries", split.sourceEntryId);
    if (!entry || entry.businessId !== split.businessId) throw new ConvexError("Source entry not found.");
    const current = await context(ctx, args.businessId, entry.kind);
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new ConvexError("Enter a reason between 5 and 300 characters and a valid retry key.");
    if (split.provenance === "reversed" && split.reopenIdempotencyKey === args.idempotencyKey) return null;
    if (split.provenance !== "confirmed" || entry.state !== "void" || entry.splitCorrectionId !== split._id || !split.replacementEntryIds?.length) throw new ConvexError("Only an active confirmed split can be reopened.");
    await assertPeriodUnlocked(ctx, current.business._id, entry.occurredOn);
    const day = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", entry.occurredOn)).unique();
    if (!day) throw new ConvexError("Daily totals are missing; reconcile before reopening this split.");
    const replacements = [];
    let replacementTotal = 0;
    const balanceDeltas = new Map<"cash" | "mobile_money", number>();
    const effect = (kind: "sale" | "expense", amount: number) => kind === "sale" ? amount : -amount;
    for (const id of split.replacementEntryIds) {
      const replacement = await ctx.db.get("entries", id);
      if (!replacement || replacement.businessId !== current.business._id || replacement.correctionOf !== entry._id || replacement.splitCorrectionId !== split._id || replacement.state !== "posted" || replacement.kind !== entry.kind || replacement.occurredOn !== entry.occurredOn) throw new ConvexError("A split replacement is missing or has changed; reconcile its history before reopening.");
      replacementTotal += replacement.amountUgx;
      if (!Number.isSafeInteger(replacementTotal)) throw new ConvexError("Split total cannot be represented safely.");
      if (replacement.account !== "unallocated") balanceDeltas.set(replacement.account, (balanceDeltas.get(replacement.account) ?? 0) - effect(replacement.kind, replacement.amountUgx));
      replacements.push(replacement);
    }
    if (replacementTotal !== split.totalUgx || replacementTotal !== entry.amountUgx) throw new ConvexError("Split entries no longer reconcile with the original amount.");
    const isSale = entry.kind === "sale";
    const currentAmount = isSale ? day.salesUgx : day.expensesUgx;
    const currentCount = isSale ? day.saleCount : day.expenseCount;
    if (currentAmount < replacementTotal || currentCount < replacements.length) throw new ConvexError("Daily totals need reconciliation before reopening this split.");
    const nextCount = currentCount - replacements.length + 1;
    if (!Number.isSafeInteger(nextCount) || nextCount < 1) throw new ConvexError("The daily entry count cannot be updated safely.");
    if (entry.account !== "unallocated") balanceDeltas.set(entry.account, (balanceDeltas.get(entry.account) ?? 0) + effect(entry.kind, entry.amountUgx));
    const preferences = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    for (const [account, delta] of balanceDeltas) {
      const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", account)).unique();
      const next = (balance?.balanceUgx ?? 0) + delta;
      if (!Number.isSafeInteger(next)) throw new ConvexError("Account correction cannot be represented safely.");
      if (next < 0 && preferences?.negativeBalanceWarning !== false && !args.confirmNegativeBalance) throw new ConvexError({ code: "CONFIRM_NEGATIVE", message: `Reopening this split may put ${account === "cash" ? "cash" : "mobile money"} below zero.` });
    }
    const now = Date.now();
    for (const replacement of replacements) await ctx.db.patch("entries", replacement._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: `Split correction reopened: ${reason}` });
    await ctx.db.patch("entries", entry._id, { state: "posted", voidedAt: undefined, voidedBy: undefined, voidReason: undefined, correctedBy: undefined, splitCorrectionId: undefined });
    await ctx.db.patch("dailyTotals", day._id, isSale ? { saleCount: nextCount } : { expenseCount: nextCount });
    for (const [account, delta] of balanceDeltas) {
      const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", account)).unique();
      const next = (balance?.balanceUgx ?? 0) + delta;
      if (balance) await ctx.db.patch("accountBalances", balance._id, { balanceUgx: next, updatedAt: now });
      else await ctx.db.insert("accountBalances", { businessId: current.business._id, account, balanceUgx: next, updatedAt: now });
    }
    await ctx.db.patch("entrySplitCorrections", split._id, { provenance: "reversed", reopenIdempotencyKey: args.idempotencyKey, reopenedBy: current.userId, reopenedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "entry.split_reopened", entityType: "entry", entityId: entry._id, occurredAt: now, summary: `Reopened a confirmed split: ${reason}`, details: JSON.stringify({ splitCorrectionId: split._id, replacementEntryIds: split.replacementEntryIds, totalUgx: split.totalUgx, negativeBalanceOverride: args.confirmNegativeBalance ?? false }) });
    return null;
  },
});
