/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const pdfBytes = () => new TextEncoder().encode("receipt bytes").buffer;

async function setup() {
  const t = convexTest(schema, modules);
  const { userId, outsiderId, businessId, entryId, foreignEntryId, salesEntryId } = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Receipt owner" });
    const outsiderId = await ctx.db.insert("users", { name: "Receipt outsider" });
    const businessId = await ctx.db.insert("businesses", { name: "Receipt test workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
    await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt: Date.now() });
    const entryId = await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 25000, occurredOn: "2026-10-01", account: "cash", category: "Supplies", note: "Paper", source: "manual", idempotencyKey: "receipt-entry-idempotency", state: "posted", createdBy: userId, createdAt: Date.now() });
    const otherBusinessId = await ctx.db.insert("businesses", { name: "Other receipt workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
    const foreignEntryId = await ctx.db.insert("entries", { businessId: otherBusinessId, kind: "expense", amountUgx: 5000, occurredOn: "2026-10-01", account: "cash", category: "Supplies", note: "Private", source: "manual", idempotencyKey: "receipt-foreign-idempotency", state: "posted", createdBy: userId, createdAt: Date.now() });
    const salesEntryId = await ctx.db.insert("entries", { businessId, kind: "sale", amountUgx: 1000, occurredOn: "2026-10-01", account: "cash", category: "Sales", note: "", source: "manual", idempotencyKey: "receipt-sales-idempotency", state: "posted", createdBy: userId, createdAt: Date.now() });
    return { userId, outsiderId, businessId, entryId, foreignEntryId, salesEntryId };
  });
  return { t, owner: t.withIdentity({ subject: userId }), userId, outsiderId, businessId, entryId, foreignEntryId, salesEntryId };
}

describe("expense receipt authorization and lifecycle", () => {
  it("records an uploaded receipt idempotently and audits removal", async () => {
    const { t, owner, userId, outsiderId, entryId } = await setup();
    const storageId = await t.run(ctx => ctx.storage.store(new Blob([pdfBytes()], { type: "application/pdf" })));
    const first = await t.mutation(internal.expenseReceipts.recordUploadedFile, { userId, entryId, storageId, requestedFileName: "supply receipt.pdf", idempotencyKey: "receipt-upload-idempotency-1" });
    const retriedStorageId = await t.run(ctx => ctx.storage.store(new Blob([pdfBytes()], { type: "application/pdf" })));
    await expect(t.mutation(internal.expenseReceipts.recordUploadedFile, { userId, entryId, storageId: retriedStorageId, requestedFileName: "supply receipt.pdf", idempotencyKey: "receipt-upload-idempotency-1" })).resolves.toEqual({ receiptId: first.receiptId, reused: true });
    await t.run(ctx => ctx.db.patch(entryId, { state: "void" }));
    const access = await owner.query(api.expenseReceipts.listAccess, {});
    expect(access).toMatchObject({ access: "ready", canRemoveAll: true });
    const receipts = await owner.query(api.expenseReceipts.listRecent, { paginationOpts: { numItems: 20, cursor: null } });
    expect(receipts.page).toMatchObject([{ entryId, fileName: "supply receipt.pdf", contentType: "application/pdf", entryState: "void" }]);
    expect("url" in receipts.page[0]).toBe(false);
    const receiptId = first.receiptId;
    await expect(t.query(internal.expenseReceipts.authorizedFile, { userId: outsiderId, receiptId })).resolves.toBeNull();
    await owner.mutation(api.expenseReceipts.removeReceipt, { receiptId });
    expect(await t.run(ctx => ctx.db.query("expenseReceipts").collect())).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("auditEvents").collect())).toHaveLength(2);
  });

  it("rejects unsupported, oversized, cross-workspace, and non-expense files before storage", async () => {
    const { t, userId, salesEntryId, foreignEntryId, entryId } = await setup();
    const wrongType = await t.run(ctx => ctx.storage.store(new Blob(["bad"], { type: "text/plain" })));
    const tooLarge = await t.run(ctx => ctx.storage.store(new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "application/pdf" })));
    const save = (target: Id<"entries">, storageId: Id<"_storage">, idempotencyKey = "receipt-upload-idempotency-2") => t.mutation(internal.expenseReceipts.recordUploadedFile, { userId, entryId: target, storageId, requestedFileName: "receipt.pdf", idempotencyKey });
    await expect(save(entryId, wrongType)).rejects.toThrow("Choose a PDF, JPEG, PNG, or WebP file under 5 MB.");
    await expect(save(entryId, tooLarge, "receipt-upload-idempotency-3")).rejects.toThrow("Choose a PDF, JPEG, PNG, or WebP file under 5 MB.");
    await expect(save(salesEntryId, wrongType, "receipt-upload-idempotency-4")).rejects.toThrow("Choose a posted expense in an active workspace.");
    await expect(save(foreignEntryId, wrongType, "receipt-upload-idempotency-5")).rejects.toThrow("Choose a posted expense in an active workspace.");
    expect(await t.run(ctx => ctx.db.query("expenseReceipts").collect())).toHaveLength(0);
  });
});
