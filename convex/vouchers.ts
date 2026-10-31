import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasPermission } from "./accessControl";

async function authorize(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in to manage voucher batches.");
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  const business = membership?.active ? await ctx.db.get("businesses", businessId) : null;
  if (!membership || !business || business.dataResetting || business.currency !== "UGX" || !(await hasPermission(ctx, membership, "integrations.manage"))) {
    throw new ConvexError("Your role cannot manage voucher batches for this UGX workspace.");
  }
  return { userId, business };
}

function safePositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new ConvexError(`${label} must be a positive whole number.`);
}

function validateReference(value: string) {
  const reference = value.trim();
  if (!reference || reference.length > 120) throw new ConvexError("Use a stable source reference of 1 to 120 characters.");
  return reference;
}

function validateReason(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 300) throw new ConvexError("Enter a reason of 3 to 300 characters.");
  return reason;
}

export const list = query({
  args: { businessId: v.id("businesses") },
  returns: v.array(v.object({
    _id: v.id("voucherBatches"), name: v.string(), description: v.string(), faceValueUgx: v.number(), issuedQuantity: v.number(), redeemedQuantity: v.number(), voidedQuantity: v.number(), expiresOn: v.union(v.string(), v.null()), createdAt: v.number(),
  })),
  handler: async (ctx, args) => {
    const { business } = await authorize(ctx, args.businessId);
    const batches = await ctx.db.query("voucherBatches").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").take(100);
    return batches.map(({ _id, name, description, faceValueUgx, issuedQuantity, redeemedQuantity, voidedQuantity, expiresOn, createdAt }) => ({ _id, name, description, faceValueUgx, issuedQuantity, redeemedQuantity, voidedQuantity, expiresOn: expiresOn ?? null, createdAt }));
  },
});

export const createBatch = mutation({
  args: { businessId: v.id("businesses"), name: v.string(), description: v.string(), faceValueUgx: v.number(), issuedQuantity: v.number(), expiresOn: v.union(v.string(), v.null()) },
  returns: v.id("voucherBatches"),
  handler: async (ctx, args) => {
    const { business, userId } = await authorize(ctx, args.businessId);
    const name = args.name.trim();
    const description = args.description.trim();
    if (name.length < 2 || name.length > 100 || description.length > 500) throw new ConvexError("Enter a batch name (2 to 100 characters) and a description up to 500 characters.");
    safePositiveInteger(args.faceValueUgx, "Voucher face value");
    safePositiveInteger(args.issuedQuantity, "Issued quantity");
    if (args.expiresOn !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(args.expiresOn) || Number.isNaN(Date.parse(`${args.expiresOn}T00:00:00.000Z`)) || new Date(`${args.expiresOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== args.expiresOn)) throw new ConvexError("Expiry must be a valid date.");
    const total = args.faceValueUgx * args.issuedQuantity;
    if (!Number.isSafeInteger(total)) throw new ConvexError("Batch face value exceeds the safe UGX amount range.");
    const now = Date.now();
    const batchId = await ctx.db.insert("voucherBatches", { businessId: business._id, name, description, faceValueUgx: args.faceValueUgx, issuedQuantity: args.issuedQuantity, redeemedQuantity: 0, voidedQuantity: 0, expiresOn: args.expiresOn ?? undefined, createdBy: userId, createdAt: now });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "voucher.batch_created", entityType: "voucher_batch", entityId: batchId, occurredAt: now, summary: `Created voucher batch ${name}: ${args.issuedQuantity} vouchers at UGX ${args.faceValueUgx} each.` });
    return batchId;
  },
});

export const recordEvent = mutation({
  args: { businessId: v.id("businesses"), batchId: v.id("voucherBatches"), eventType: v.union(v.literal("redemption"), v.literal("void_stock")), sourceReference: v.string(), quantity: v.number(), reason: v.string() },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const { business, userId } = await authorize(ctx, args.businessId);
    const batch = await ctx.db.get("voucherBatches", args.batchId);
    if (!batch || batch.businessId !== business._id) throw new ConvexError("Voucher batch not found in this workspace.");
    const sourceReference = validateReference(args.sourceReference);
    const reason = validateReason(args.reason);
    safePositiveInteger(args.quantity, "Quantity");
    const existing = await ctx.db.query("voucherEvents").withIndex("by_business_and_batch_and_reference", q => q.eq("businessId", business._id).eq("batchId", batch._id).eq("sourceReference", sourceReference)).unique();
    if (existing) {
      if (existing.eventType !== args.eventType || existing.quantity !== args.quantity) throw new ConvexError("This source reference was already used for a different voucher event.");
      return { duplicate: true };
    }
    if (args.eventType === "redemption") {
      if (batch.expiresOn && batch.expiresOn < new Date().toISOString().slice(0, 10)) throw new ConvexError("This batch has expired and cannot be redeemed.");
      if (args.quantity > batch.issuedQuantity - batch.redeemedQuantity - batch.voidedQuantity) throw new ConvexError("The batch does not have enough unredeemed vouchers.");
    } else if (args.quantity > batch.issuedQuantity - batch.redeemedQuantity - batch.voidedQuantity) {
      throw new ConvexError("You cannot void more vouchers than remain available.");
    }
    const nextRedeemed = batch.redeemedQuantity + (args.eventType === "redemption" ? args.quantity : 0);
    const nextVoided = batch.voidedQuantity + (args.eventType === "void_stock" ? args.quantity : 0);
    if (!Number.isSafeInteger(nextRedeemed) || !Number.isSafeInteger(nextVoided)) throw new ConvexError("Voucher quantity exceeds the safe range.");
    const now = Date.now();
    await ctx.db.insert("voucherEvents", { businessId: business._id, batchId: batch._id, sourceReference, eventType: args.eventType, quantity: args.quantity, reason, actorId: userId, occurredAt: now });
    await ctx.db.patch("voucherBatches", batch._id, { redeemedQuantity: nextRedeemed, voidedQuantity: nextVoided });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: args.eventType === "redemption" ? "voucher.redeemed" : "voucher.stock_voided", entityType: "voucher_batch", entityId: batch._id, occurredAt: now, summary: `${args.eventType === "redemption" ? "Redeemed" : "Voided"} ${args.quantity} voucher(s) in ${batch.name}.`, details: JSON.stringify({ sourceReference, quantity: args.quantity, reason }) });
    return { duplicate: false };
  },
});
