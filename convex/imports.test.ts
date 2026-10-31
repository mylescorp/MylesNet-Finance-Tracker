/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("import impact preview", () => {
  it("calculates large previews across bounded chunks and detects cross-chunk duplicates", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Import owner" });
      const createdAt = Date.now();
      const businessId = await ctx.db.insert("businesses", { name: "Import workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt });
      return { userId, businessId };
    });
    const duplicateRow = { kind: "sale", amountUgx: 100, occurredOn: "2026-10-31", account: "cash", category: "Sales", note: "x".repeat(300) };
    const chunks = Array.from({ length: 5 }, (_, chunkIndex) => JSON.stringify(Array.from({ length: 500 }, (_, rowIndex) =>
      (chunkIndex === 0 && rowIndex === 0) || (chunkIndex === 1 && rowIndex === 0) ? duplicateRow : { ...duplicateRow, note: `${"x".repeat(294)}${String(chunkIndex).padStart(3, "0")}${String(rowIndex).padStart(3, "0")}` },
    )));
    expect(chunks.reduce((size, chunk) => size + chunk.length, 0)).toBeGreaterThan(900_000);
    const result = await t.withIdentity({ subject: userId }).query(api.imports.previewImpact, { businessId, rowsJsonChunks: chunks });
    expect(result.error).toBe("");
    expect(result.totals.cash).toBe(250_000);
    expect(result.potentialDuplicateRows).toBe(1);
  });

  it("exports only the authorized batch rows with correction state and spreadsheet-safe cells", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId, batchId, entryId, replacementId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Import owner" });
      const createdAt = Date.now();
      const businessId = await ctx.db.insert("businesses", { name: "Import workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt });
      const batchId = await ctx.db.insert("importBatches", { businessId, fileName: "cash.csv", importType: "cashbook", sourceHash: "sourcehash", currency: "UGX", totalRows: 2, importedCount: 2, skippedCount: 0, progressRows: 2, status: "completed", createdBy: userId, createdAt });
      const entryId = await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 1200, occurredOn: "2026-10-30", account: "cash", category: "=2+2", note: 'Paper, "A"', source: "import", idempotencyKey: "csv:sourcehash:1", state: "void", createdBy: userId, createdAt, voidReason: "duplicate" });
      const replacementId = await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 1300, occurredOn: "2026-10-30", account: "cash", category: "Supplies", note: "Corrected", source: "import", idempotencyKey: "csv:sourcehash:2", state: "posted", correctionOf: entryId, createdBy: userId, createdAt });
      await ctx.db.patch("entries", entryId, { correctedBy: replacementId });
      await ctx.db.insert("entries", { businessId, kind: "sale", amountUgx: 5, occurredOn: "2026-10-30", account: "cash", category: "Other", note: "unrelated", source: "import", idempotencyKey: "csv:anotherhash:1", state: "posted", createdBy: userId, createdAt });
      return { userId, businessId, batchId, entryId, replacementId };
    });
    const csv = await t.withIdentity({ subject: userId }).query(api.imports.cashbookReport, { businessId, batchId });
    expect(csv).toContain('"source_row","entry_id","date"');
    expect(csv).toContain(`"1","${entryId}"`);
    expect(csv).toContain("\"'=2+2\"");
    expect(csv).toContain('"Paper, ""A"""');
    expect(csv).toContain(`"${replacementId}",""`);
    expect(csv).not.toContain("unrelated");
    await expect(t.query(api.imports.cashbookReport, { businessId, batchId })).rejects.toThrow();
  });

  it("includes confirmed split provenance in the imported source-row report", async () => {
    const t = convexTest(schema, modules);
    const { userId, businessId, batchId, entryId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Split export owner" });
      const createdAt = Date.now();
      const businessId = await ctx.db.insert("businesses", { name: "Split export workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt });
      const sourceHash = "d".repeat(64);
      const batchId = await ctx.db.insert("importBatches", { businessId, fileName: "split.csv", importType: "cashbook", sourceHash, currency: "UGX", totalRows: 1, importedCount: 1, skippedCount: 0, progressRows: 1, status: "completed", createdBy: userId, createdAt });
      const entryId = await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 1_000, occurredOn: "2026-10-30", account: "cash", category: "General", note: "Mixed receipt", source: "import", idempotencyKey: `csv:${sourceHash}:1`, state: "void", createdBy: userId, createdAt, voidReason: "Split correction" });
      const splitId = await ctx.db.insert("entrySplitCorrections", { businessId, sourceEntryId: entryId, totalUgx: 1_000, occurredOn: "2026-10-30", reason: "Receipt lines confirmed", allocations: [{ amountUgx: 400, account: "cash", category: "Paper" }, { amountUgx: 600, account: "mobile_money", category: "Ink" }], provenance: "confirmed", idempotencyKey: "split-export-idempotency-key", createdBy: userId, createdAt });
      await ctx.db.patch("entries", entryId, { splitCorrectionId: splitId });
      return { userId, businessId, batchId, entryId };
    });
    const csv = await t.withIdentity({ subject: userId }).query(api.imports.cashbookReport, { businessId, batchId });
    expect(csv).toContain('"split_correction_id","split_provenance","split_allocations_json"');
    expect(csv).toContain(`"${entryId}"`);
    expect(csv).toContain('"confirmed"');
    expect(csv).toContain('""amountUgx"":400');
    expect(csv).toContain('""account"":""mobile_money""');
  });
});
