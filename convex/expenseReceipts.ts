import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { hasPermission } from "./accessControl";
import { getSelectedWorkspace } from "./workspaceContext";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPTS_PER_ENTRY = 5;
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export const recordUploadedFile = internalMutation({
  args: { userId: v.id("users"), entryId: v.id("entries"), storageId: v.id("_storage"), requestedFileName: v.string(), idempotencyKey: v.string() },
  returns: v.object({ receiptId: v.id("expenseReceipts"), reused: v.boolean() }),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    const membership = entry ? await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", entry.businessId).eq("userId", args.userId)).unique() : null;
    const business = entry ? await ctx.db.get("businesses", entry.businessId) : null;
    if (!entry || !business || business.dataResetting || !membership?.active || entry.kind !== "expense" || entry.state !== "posted") throw new Error("Choose a posted expense in an active workspace.");
    const canCreate = await hasPermission(ctx, membership, "expenses.create");
    const canManage = await hasPermission(ctx, membership, "expenses.update");
    if (!canCreate && !canManage) throw new Error("Your role cannot attach expense receipts.");
    if (entry.createdBy !== args.userId && !canManage) throw new Error("You can only attach receipts to expenses you created.");
    if (args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("This receipt request could not be verified. Try again.");
    const previous = await ctx.db.query("expenseReceipts").withIndex("by_business_and_idempotency", q => q.eq("businessId", business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (previous) {
      if (previous.entryId !== entry._id) throw new Error("This receipt request key was already used for another expense.");
      return { receiptId: previous._id, reused: true };
    }
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    if (!metadata?.contentType || !ALLOWED_CONTENT_TYPES.has(metadata.contentType) || metadata.size <= 0 || metadata.size > MAX_FILE_BYTES) throw new Error("Choose a PDF, JPEG, PNG, or WebP file under 5 MB.");
    const existing = await ctx.db.query("expenseReceipts").withIndex("by_business_and_entry", q => q.eq("businessId", business._id).eq("entryId", entry._id)).take(MAX_RECEIPTS_PER_ENTRY + 1);
    if (existing.length >= MAX_RECEIPTS_PER_ENTRY) throw new Error("An expense can have up to five receipt files.");
    const fileName = args.requestedFileName.trim().replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 160);
    if (!fileName) throw new Error("Enter a valid receipt file name.");
    const now = Date.now();
    const id = await ctx.db.insert("expenseReceipts", { businessId: business._id, entryId: entry._id, storageId: args.storageId, fileName, contentType: metadata.contentType, sizeBytes: metadata.size, idempotencyKey: args.idempotencyKey, createdBy: args.userId, createdAt: now });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: args.userId, action: "expense.receipt_attached", entityType: "expenseReceipt", entityId: id, occurredAt: now, summary: `Receipt attached to expense from ${entry.occurredOn}.`, details: JSON.stringify({ entryId: entry._id, contentType: metadata.contentType, sizeBytes: metadata.size }) });
    return { receiptId: id, reused: false };
  },
});

const receiptRow = v.object({ _id: v.id("expenseReceipts"), entryId: v.id("entries"), occurredOn: v.string(), category: v.string(), amountUgx: v.number(), entryState: v.union(v.literal("posted"), v.literal("void")), fileName: v.string(), contentType: v.string(), sizeBytes: v.number(), canRemove: v.boolean() });

export const listAccess = query({
  args: {},
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({ access: v.literal("ready"), canRemoveAll: v.boolean() })),
  handler: async ctx => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.view"))) return { access: "restricted" as const };
    return { access: "ready" as const, canRemoveAll: await hasPermission(ctx, current.membership, "expenses.update") };
  },
});

export const listRecent = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(receiptRow),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.view"))) throw new Error("Receipt access is restricted.");
    const page = await ctx.db.query("expenseReceipts").withIndex("by_business_and_created_at", q => q.eq("businessId", current.business._id)).order("desc").paginate(args.paginationOpts);
    const canManage = await hasPermission(ctx, current.membership, "expenses.update");
    const receipts = await Promise.all(page.page.map(async receipt => {
      const entry = await ctx.db.get(receipt.entryId);
      if (!entry || entry.businessId !== current.business._id || entry.kind !== "expense") return null;
      return { _id: receipt._id, entryId: receipt.entryId, occurredOn: entry.occurredOn, category: entry.category, amountUgx: entry.amountUgx, entryState: entry.state, fileName: receipt.fileName, contentType: receipt.contentType, sizeBytes: receipt.sizeBytes, canRemove: receipt.createdBy === current.userId || canManage || entry.createdBy === current.userId };
    }));
    return { ...page, page: receipts.filter((row): row is NonNullable<typeof row> => row !== null) };
  },
});

export const authorizedFile = internalQuery({
  args: { userId: v.id("users"), receiptId: v.id("expenseReceipts") },
  returns: v.union(v.null(), v.object({ storageId: v.id("_storage"), fileName: v.string(), contentType: v.string() })),
  handler: async (ctx, args) => {
    const receipt = await ctx.db.get(args.receiptId);
    if (!receipt) return null;
    const entry = await ctx.db.get(receipt.entryId);
    const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", receipt.businessId).eq("userId", args.userId)).unique();
    const business = await ctx.db.get("businesses", receipt.businessId);
    if (!entry || entry.businessId !== receipt.businessId || entry.kind !== "expense" || !membership?.active || !business || business.dataResetting || !(await hasPermission(ctx, membership, "expenses.view"))) return null;
    return { storageId: receipt.storageId, fileName: receipt.fileName, contentType: receipt.contentType };
  },
});

export const removeReceipt = mutation({
  args: { receiptId: v.id("expenseReceipts") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    const receipt = await ctx.db.get(args.receiptId);
    if (!current || !receipt || receipt.businessId !== current.business._id) throw new Error("Receipt is not available in this workspace.");
    const entry = await ctx.db.get(receipt.entryId);
    if (!(await hasPermission(ctx, current.membership, "expenses.update")) && receipt.createdBy !== current.userId && entry?.createdBy !== current.userId) throw new Error("Your role cannot remove this receipt.");
    await ctx.storage.delete(receipt.storageId);
    await ctx.db.delete(receipt._id);
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "expense.receipt_removed", entityType: "expenseReceipt", entityId: receipt._id, occurredAt: Date.now(), summary: "Receipt removed from an expense.", details: JSON.stringify({ entryId: receipt.entryId, fileName: receipt.fileName }) });
    return null;
  },
});
