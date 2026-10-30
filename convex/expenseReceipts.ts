import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { hasPermission } from "./accessControl";
import { getSelectedWorkspace } from "./workspaceContext";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPTS_PER_ENTRY = 5;
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export const generateUploadUrl = mutation({
  args: {},
  returns: v.union(v.literal("restricted"), v.object({ uploadUrl: v.string(), uploadId: v.id("expenseReceiptUploads") })),
  handler: async ctx => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.create"))) return "restricted";
    const now = Date.now();
    const uploadUrl = await ctx.storage.generateUploadUrl();
    const uploadId = await ctx.db.insert("expenseReceiptUploads", { businessId: current.business._id, userId: current.userId, createdAt: now });
    await ctx.scheduler.runAfter(24 * 60 * 60 * 1000, internal.expenseReceipts.expireUpload, { uploadId });
    return { uploadUrl, uploadId };
  },
});

export const registerUpload = mutation({
  args: { uploadId: v.id("expenseReceiptUploads"), storageId: v.id("_storage") },
  returns: v.union(v.object({ ok: v.literal(true) }), v.object({ ok: v.literal(false), message: v.string() })),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.create"))) throw new Error("Your role cannot attach expense receipts.");
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.userId !== current.userId || upload.businessId !== current.business._id || Date.now() - upload.createdAt > 24 * 60 * 60 * 1000) throw new Error("This receipt upload session expired. Start the upload again.");
    if (upload.storageId && upload.storageId !== args.storageId) throw new Error("This upload session was already used for another file.");
    const otherUpload = await ctx.db.query("expenseReceiptUploads").withIndex("by_storage", q => q.eq("storageId", args.storageId)).unique();
    if (otherUpload && otherUpload._id !== upload._id) throw new Error("This storage file belongs to another upload session.");
    const metadata = await ctx.db.system.get("_storage", args.storageId);
    await ctx.db.patch(upload._id, { storageId: args.storageId });
    if (!metadata || !metadata.contentType || !ALLOWED_CONTENT_TYPES.has(metadata.contentType) || metadata.size <= 0 || metadata.size > MAX_FILE_BYTES) return { ok: false as const, message: "Choose a PDF, JPEG, PNG, or WebP file under 5 MB." };
    return { ok: true as const };
  },
});

export const discardUpload = mutation({
  args: { uploadId: v.id("expenseReceiptUploads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    if (!current) throw new Error("Workspace access is unavailable.");
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) return null;
    if (upload.userId !== current.userId || upload.businessId !== current.business._id) throw new Error("This upload is not available to your account.");
    if (upload.storageId) await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
    return null;
  },
});

export const attachToEntry = mutation({
  args: { entryId: v.id("entries"), uploadId: v.id("expenseReceiptUploads"), fileName: v.string() },
  returns: v.id("expenseReceipts"),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.create"))) throw new Error("Your role cannot attach expense receipts.");
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.businessId !== current.business._id || entry.kind !== "expense" || entry.state !== "posted") throw new Error("Choose a posted expense in this workspace.");
    if (entry.createdBy !== current.userId && !(await hasPermission(ctx, current.membership, "expenses.update"))) throw new Error("You can only attach receipts to expenses you created.");
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || !upload.storageId || upload.userId !== current.userId || upload.businessId !== current.business._id || Date.now() - upload.createdAt > 24 * 60 * 60 * 1000) throw new Error("Upload this receipt again before attaching it.");
    const metadata = await ctx.db.system.get("_storage", upload.storageId);
    if (!metadata || !metadata.contentType || !ALLOWED_CONTENT_TYPES.has(metadata.contentType) || metadata.size <= 0 || metadata.size > MAX_FILE_BYTES) throw new Error("This receipt upload is no longer valid.");
    const existing = await ctx.db.query("expenseReceipts").withIndex("by_business_and_entry", q => q.eq("businessId", current.business._id).eq("entryId", entry._id)).collect();
    if (existing.length >= MAX_RECEIPTS_PER_ENTRY) throw new Error("An expense can have up to five receipt files.");
    const fileName = args.fileName.trim().replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 160);
    if (!fileName) throw new Error("Enter a valid receipt file name.");
    const now = Date.now();
    const id = await ctx.db.insert("expenseReceipts", { businessId: current.business._id, entryId: entry._id, storageId: upload.storageId, fileName, contentType: metadata.contentType, sizeBytes: metadata.size, createdBy: current.userId, createdAt: now });
    await ctx.db.delete(upload._id);
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "expense.receipt_attached", entityType: "expenseReceipt", entityId: id, occurredAt: now, summary: `Receipt attached to expense from ${entry.occurredOn}.`, details: JSON.stringify({ entryId: entry._id, contentType: metadata.contentType, sizeBytes: metadata.size }) });
    return id;
  },
});

export const listRecent = query({
  args: {},
  returns: v.union(
    v.object({ access: v.literal("restricted") }),
    v.object({ access: v.literal("ready"), complete: v.boolean(), canRemoveAll: v.boolean(), receipts: v.array(v.object({ _id: v.id("expenseReceipts"), entryId: v.id("entries"), occurredOn: v.string(), category: v.string(), amountUgx: v.number(), entryState: v.union(v.literal("posted"), v.literal("void")), fileName: v.string(), contentType: v.string(), sizeBytes: v.number(), canRemove: v.boolean() })) }),
  ),
  handler: async ctx => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.view"))) return { access: "restricted" as const };
    const records = await ctx.db.query("expenseReceipts").withIndex("by_business_and_created_at", q => q.eq("businessId", current.business._id)).order("desc").take(101);
    const visible = records.slice(0, 100);
    const receipts = await Promise.all(visible.map(async receipt => {
      const entry = await ctx.db.get(receipt.entryId);
      if (!entry || entry.businessId !== current.business._id || entry.kind !== "expense") return null;
      return { _id: receipt._id, entryId: receipt.entryId, occurredOn: entry.occurredOn, category: entry.category, amountUgx: entry.amountUgx, entryState: entry.state, fileName: receipt.fileName, contentType: receipt.contentType, sizeBytes: receipt.sizeBytes, canRemove: receipt.createdBy === current.userId || await hasPermission(ctx, current.membership, "expenses.update") || entry.createdBy === current.userId };
    }));
    return { access: "ready" as const, complete: records.length <= 100, canRemoveAll: await hasPermission(ctx, current.membership, "expenses.update"), receipts: receipts.filter((row): row is NonNullable<typeof row> => row !== null) };
  },
});

export const getContent = mutation({
  args: { receiptId: v.id("expenseReceipts") },
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({ access: v.literal("ready"), fileName: v.string(), contentType: v.string(), data: v.bytes() })),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    const receipt = await ctx.db.get(args.receiptId);
    if (!current || !receipt || receipt.businessId !== current.business._id || !(await hasPermission(ctx, current.membership, "expenses.view"))) return { access: "restricted" as const };
    const entry = await ctx.db.get(receipt.entryId);
    if (!entry || entry.businessId !== current.business._id || entry.kind !== "expense") return { access: "restricted" as const };
    const blob = await ctx.storage.get(receipt.storageId);
    if (!blob) throw new Error("This receipt file is no longer available.");
    return { access: "ready" as const, fileName: receipt.fileName, contentType: receipt.contentType, data: await blob.arrayBuffer() };
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

export const expireUpload = internalMutation({
  args: { uploadId: v.id("expenseReceiptUploads") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) return null;
    if (upload.storageId) await ctx.storage.delete(upload.storageId);
    await ctx.db.delete(upload._id);
    return null;
  },
});
