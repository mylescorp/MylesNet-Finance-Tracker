/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("Google Forms receipt export", () => {
  it("exports visible receipt summaries without raw form fields or source keys", async () => {
    const t = convexTest(schema, modules);
    const { userId, deniedUserId, foreignUserId, businessId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Form owner" });
      const createdAt = Date.now();
      const businessId = await ctx.db.insert("businesses", { name: "Form workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt });
      const deniedUserId = await ctx.db.insert("users", { name: "Member without integration access" });
      await ctx.db.insert("memberships", { businessId, userId: deniedUserId, role: "member", active: true, createdAt });
      const foreignUserId = await ctx.db.insert("users", { name: "Owner of another workspace" });
      const foreignBusinessId = await ctx.db.insert("businesses", { name: "Other workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: foreignUserId, createdAt });
      await ctx.db.insert("memberships", { businessId: foreignBusinessId, userId: foreignUserId, role: "owner", active: true, createdAt });
      await ctx.db.insert("googleFormReceipts", { businessId, sourceKey: "private-source-key", submissionKind: "expense", status: "needs_review", occurredOn: "2026-10-30", amountUgx: 1000, summary: "Missing account mapping", detailsJson: JSON.stringify({ email: "private@example.com" }), createdAt, attemptCount: 2 });
      return { userId, deniedUserId, foreignUserId, businessId };
    });
    const csv = await t.withIdentity({ subject: userId }).query(api.googleForms.exportHistory, { businessId });
    expect(csv).toContain('"submission_type","date","amount_ugx"');
    expect(csv).toContain('"expense","2026-10-30","1000","needs_review","2"');
    expect(csv).toContain("Missing account mapping");
    expect(csv).not.toContain("private-source-key");
    expect(csv).not.toContain("private@example.com");
    await expect(t.query(api.googleForms.exportHistory, { businessId })).rejects.toThrow();
    await expect(t.withIdentity({ subject: deniedUserId }).query(api.googleForms.exportHistory, { businessId })).rejects.toThrow();
    await expect(t.withIdentity({ subject: foreignUserId }).query(api.googleForms.exportHistory, { businessId })).rejects.toThrow();
  });
});
