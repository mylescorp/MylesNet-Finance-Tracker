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
});
