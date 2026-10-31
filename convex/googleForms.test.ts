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

  it("lets an integration manager with expense access approve a saved needs-review retry", async () => {
    const t = convexTest(schema, modules);
    const { managerUserId, restrictedManagerUserId, businessId, receiptId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Review owner" });
      const createdAt = Date.now();
      const businessId = await ctx.db.insert("businesses", { name: "Review workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt });
      const managerUserId = await ctx.db.insert("users", { name: "Integration manager" });
      const managerRoleId = await ctx.db.insert("workspaceRoles", { businessId, name: "Integration manager", description: "Manage integrations and expenses.", permissions: ["integrations.manage", "expenses.create"], active: true, createdBy: userId, createdAt, updatedAt: createdAt });
      await ctx.db.insert("memberships", { businessId, userId: managerUserId, role: "member", roleId: managerRoleId, active: true, createdAt });
      const restrictedManagerUserId = await ctx.db.insert("users", { name: "Restricted integration manager" });
      const restrictedRoleId = await ctx.db.insert("workspaceRoles", { businessId, name: "Restricted integration manager", description: "Manage integration settings only.", permissions: ["integrations.manage"], active: true, createdBy: userId, createdAt, updatedAt: createdAt });
      await ctx.db.insert("memberships", { businessId, userId: restrictedManagerUserId, role: "member", roleId: restrictedRoleId, active: true, createdAt });
      await ctx.db.insert("workspacePreferences", { businessId, expenseCategories: ["Utilities"], duplicateWindowDays: 0, negativeBalanceWarning: false, updatedBy: userId, updatedAt: createdAt });
      await ctx.db.insert("accountBalances", { businessId, account: "cash", balanceUgx: 10_000, updatedAt: createdAt });
      const receiptId = await ctx.db.insert("googleFormReceipts", { businessId, sourceKey: "retry-source-001", submissionKind: "expense", status: "needs_review", occurredOn: "2026-10-30", summary: "Needs owner review", detailsJson: JSON.stringify({ "Expense amount (UGX)": "2,000", Category: "Utilities", "Paid from": "Cash", "Paid to / description": "Power", "Expense note (optional)": "October bill" }), createdAt, attemptCount: 1 });
      return { managerUserId, restrictedManagerUserId, businessId, receiptId };
    });
    const integrationManager = t.withIdentity({ subject: managerUserId });
    const restrictedManager = t.withIdentity({ subject: restrictedManagerUserId });
    const page = await integrationManager.query(api.googleForms.history, { businessId, paginationOpts: { numItems: 20, cursor: null } });
    expect(page.page[0]?.canReprocess).toBe(true);
    expect(await integrationManager.query(api.googleForms.reviewDetails, { businessId, receiptId })).toContain("Expense amount");
    expect((await restrictedManager.query(api.googleForms.history, { businessId, paginationOpts: { numItems: 20, cursor: null } })).page[0]?.canReprocess).toBe(false);
    await expect(restrictedManager.mutation(api.googleForms.reprocessNeedsReview, { businessId, receiptId, reason: "Attempt without transaction access." })).rejects.toThrow();
    const result = await integrationManager.mutation(api.googleForms.reprocessNeedsReview, { businessId, receiptId, reason: "I checked the source form and confirmed this expense." });
    expect(result.status).toBe("posted");
    const stored = await t.run(async ctx => ({ receipt: await ctx.db.get("googleFormReceipts", receiptId), entry: await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId).eq("idempotencyKey", "google-form:retry-source-001:0")).unique(), balance: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(), audit: await ctx.db.query("auditEvents").withIndex("by_business_and_time", q => q.eq("businessId", businessId)).order("desc").first() }));
    expect(stored.receipt?.status).toBe("posted");
    expect(stored.entry).toMatchObject({ amountUgx: 2_000, category: "Utilities", note: "Power · October bill", source: "google_form" });
    expect(stored.balance?.balanceUgx).toBe(8_000);
    expect(stored.audit).toMatchObject({ action: "google_form.receipt_reprocessed", actorId: managerUserId });
    expect(stored.audit?.details).toContain("I checked the source form");
    await expect(integrationManager.mutation(api.googleForms.reprocessNeedsReview, { businessId, receiptId, reason: "Should not be eligible after posting." })).rejects.toThrow();
  });
});
