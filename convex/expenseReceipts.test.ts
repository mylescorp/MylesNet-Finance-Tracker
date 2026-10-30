/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const { userId, businessId, entryId, foreignEntryId } = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Receipt owner" });
    const businessId = await ctx.db.insert("businesses", { name: "Receipt test workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
    await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt: Date.now() });
    const entryId = await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 25000, occurredOn: "2026-10-01", account: "cash", category: "Supplies", note: "Paper", source: "manual", idempotencyKey: "receipt-entry-idempotency", state: "posted", createdBy: userId, createdAt: Date.now() });
    const otherBusinessId = await ctx.db.insert("businesses", { name: "Other receipt workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
    const foreignEntryId = await ctx.db.insert("entries", { businessId: otherBusinessId, kind: "expense", amountUgx: 5000, occurredOn: "2026-10-01", account: "cash", category: "Supplies", note: "Private", source: "manual", idempotencyKey: "receipt-foreign-idempotency", state: "posted", createdBy: userId, createdAt: Date.now() });
    return { userId, businessId, entryId, foreignEntryId };
  });
  return { t, owner: t.withIdentity({ subject: userId }), userId, businessId, entryId, foreignEntryId };
}

describe("expense receipt authorization and lifecycle", () => {
  it("attaches private receipt metadata to an expense and audits removal", async () => {
    const { t, owner, userId, businessId, entryId } = await setup();
    const storageId = await t.run(ctx => ctx.storage.store(new Blob(["receipt bytes"], { type: "application/pdf" })));
    const uploadId = await t.run(ctx => ctx.db.insert("expenseReceiptUploads", { businessId, userId, storageId, createdAt: Date.now() }));
    await expect(owner.mutation(api.expenseReceipts.registerUpload, { uploadId, storageId })).resolves.toEqual({ ok: true });
    await owner.mutation(api.expenseReceipts.attachToEntry, { entryId, uploadId, fileName: "supply receipt.pdf" });
    await t.run(ctx => ctx.db.patch(entryId, { state: "void" }));
    const receipts = await owner.query(api.expenseReceipts.listRecent, {});
    expect(receipts.access).toBe("ready");
    if (receipts.access === "ready") {
      expect(receipts.receipts).toMatchObject([{ entryId, fileName: "supply receipt.pdf", contentType: "application/pdf", entryState: "void" }]);
      expect("url" in receipts.receipts[0]).toBe(false);
    }
    const receiptId = await t.run(async ctx => (await ctx.db.query("expenseReceipts").collect())[0]._id);
    await expect(t.mutation(api.expenseReceipts.getContent, { receiptId })).resolves.toEqual({ access: "restricted" });
    await owner.mutation(api.expenseReceipts.removeReceipt, { receiptId });
    expect(await t.run(ctx => ctx.db.query("expenseReceipts").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("auditEvents").collect())).toHaveLength(2);
  });

  it("rejects unsupported, oversized, cross-workspace, and non-expense attachments", async () => {
    const { t, owner, userId, businessId, entryId, foreignEntryId } = await setup();
    const invalidType = await t.run(ctx => ctx.storage.store(new Blob(["bad"], { type: "text/plain" })));
    const invalidUploadId = await t.run(ctx => ctx.db.insert("expenseReceiptUploads", { businessId, userId, createdAt: Date.now() }));
    await expect(owner.mutation(api.expenseReceipts.registerUpload, { uploadId: invalidUploadId, storageId: invalidType })).resolves.toEqual({ ok: false, message: "Choose a PDF, JPEG, PNG, or WebP file under 5 MB." });
    const largeFile = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" });
    const oversized = await t.run(ctx => ctx.storage.store(largeFile));
    const oversizedUploadId = await t.run(ctx => ctx.db.insert("expenseReceiptUploads", { businessId, userId, createdAt: Date.now() }));
    await expect(owner.mutation(api.expenseReceipts.registerUpload, { uploadId: oversizedUploadId, storageId: oversized })).resolves.toEqual({ ok: false, message: "Choose a PDF, JPEG, PNG, or WebP file under 5 MB." });
    const salesEntry = await t.run(ctx => ctx.db.insert("entries", { businessId, kind: "sale", amountUgx: 1000, occurredOn: "2026-10-01", account: "cash", category: "Sales", note: "", source: "manual", idempotencyKey: "receipt-sales-idempotency", state: "posted", createdBy: userId, createdAt: Date.now() }));
    const pdf = await t.run(ctx => ctx.storage.store(new Blob(["receipt"], { type: "application/pdf" })));
    const uploadId = await t.run(ctx => ctx.db.insert("expenseReceiptUploads", { businessId, userId, storageId: pdf, createdAt: Date.now() }));
    await expect(owner.mutation(api.expenseReceipts.attachToEntry, { entryId: salesEntry, uploadId, fileName: "sales.pdf" })).rejects.toThrow("Choose a posted expense in this workspace.");
    await expect(owner.mutation(api.expenseReceipts.attachToEntry, { entryId: foreignEntryId, uploadId, fileName: "foreign.pdf" })).rejects.toThrow("Choose a posted expense in this workspace.");
    expect(entryId).toBeTruthy();
  });
});
