/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const users = await t.run(async ctx => {
    const ownerId = await ctx.db.insert("users", { name: "Template owner" });
    const memberId = await ctx.db.insert("users", { name: "Template member" });
    const businessId = await ctx.db.insert("businesses", { name: "Template workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: ownerId, createdAt: Date.now() });
    await ctx.db.insert("memberships", { businessId, userId: ownerId, role: "owner", active: true, createdAt: Date.now() });
    await ctx.db.insert("memberships", { businessId, userId: memberId, role: "member", active: true, createdAt: Date.now() });
    const supplierId = await ctx.db.insert("suppliers", { businessId, name: "Power Co", normalizedName: "power co", active: true, createdBy: ownerId, createdAt: Date.now(), updatedBy: ownerId, updatedAt: Date.now() });
    return { ownerId, memberId, businessId, supplierId };
  });
  return { t, ...users, owner: t.withIdentity({ subject: users.ownerId }), member: t.withIdentity({ subject: users.memberId }) };
}

describe("recurring expense templates", () => {
  it("saves defaults, is idempotent, and supports pause/resume/archive with audit", async () => {
    const { t, owner, businessId, supplierId } = await setup();
    const id = await owner.mutation(api.expenseTemplates.save, { action: "create", name: "Power", category: "Utilities", amountUgx: 90_000, account: "mobile_money", recurrence: "monthly", nextDueOn: "2026-11-20", supplierId, idempotencyKey: "expense-template-create-001" });
    expect(await owner.mutation(api.expenseTemplates.save, { action: "create", name: "Power", category: "Utilities", amountUgx: 90_000, account: "mobile_money", recurrence: "monthly", nextDueOn: "2026-11-20", supplierId, idempotencyKey: "expense-template-create-001" })).toBe(id);
    await expect(owner.mutation(api.expenseTemplates.save, { action: "create", name: "Water", category: "Utilities", amountUgx: 90_000, account: "mobile_money", recurrence: "monthly", nextDueOn: "2026-11-20", supplierId, idempotencyKey: "expense-template-create-001" })).rejects.toThrow("different recurring expense template");
    expect(await owner.query(api.expenseTemplates.list, {})).toMatchObject({ access: "ready", templates: [{ name: "Power", supplierName: "Power Co", paused: false }] });
    await owner.mutation(api.expenseTemplates.save, { action: "pause", templateId: id, name: "Power", category: "", amountUgx: null, account: "cash", recurrence: "monthly", nextDueOn: "2000-01-01" });
    expect(await owner.query(api.expenseTemplates.list, {})).toMatchObject({ access: "ready", templates: [{ paused: true }] });
    await owner.mutation(api.expenseTemplates.save, { action: "resume", templateId: id, name: "Power", category: "", amountUgx: null, account: "cash", recurrence: "monthly", nextDueOn: "2000-01-01" });
    await owner.mutation(api.expenseTemplates.save, { action: "archive", templateId: id, name: "Power", category: "", amountUgx: null, account: "cash", recurrence: "monthly", nextDueOn: "2000-01-01" });
    expect(await owner.query(api.expenseTemplates.list, {})).toMatchObject({ access: "ready", templates: [] });
    expect((await t.run(ctx => ctx.db.query("auditEvents").collect())).map(row => row.action)).toEqual(["expense_template.created", "expense_template.paused", "expense_template.resumed", "expense_template.archived"]);
    expect(await t.run(ctx => ctx.db.query("entries").collect())).toHaveLength(0);
    expect((await t.run(ctx => ctx.db.get("businesses", businessId)))?.name).toBe("Template workspace");
  });

  it("enforces viewer and cross-workspace boundaries and safe amounts", async () => {
    const { t, owner, member, businessId, supplierId } = await setup();
    await expect(member.mutation(api.expenseTemplates.save, { action: "create", name: "Power", category: "Utilities", amountUgx: 90_000, account: "cash", recurrence: "monthly", nextDueOn: "2026-11-20", idempotencyKey: "expense-template-create-002" })).rejects.toThrow("cannot manage recurring expense templates");
    await expect(owner.mutation(api.expenseTemplates.save, { action: "create", name: "Power", category: "Utilities", amountUgx: Number.MAX_SAFE_INTEGER + 1, account: "cash", recurrence: "monthly", nextDueOn: "2026-11-20", idempotencyKey: "expense-template-create-003" })).rejects.toThrow("positive whole-shilling safe integer");
    const foreignSupplierId = await t.run(async ctx => {
      const foreignUser = await ctx.db.insert("users", { name: "Foreign owner" });
      const foreignBusiness = await ctx.db.insert("businesses", { name: "Foreign workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: foreignUser, createdAt: Date.now() });
      return ctx.db.insert("suppliers", { businessId: foreignBusiness, name: "Other", normalizedName: "other", active: true, createdBy: foreignUser, createdAt: Date.now(), updatedBy: foreignUser, updatedAt: Date.now() });
    });
    await expect(owner.mutation(api.expenseTemplates.save, { action: "create", name: "Power", category: "Utilities", amountUgx: null, account: "cash", recurrence: "monthly", nextDueOn: "2026-11-20", supplierId: foreignSupplierId, idempotencyKey: "expense-template-create-004" })).rejects.toThrow("active supplier in this workspace");
    expect(supplierId).toBeTruthy();
    expect(await owner.query(api.expenseTemplates.list, {})).toEqual({ access: "ready", canManage: true, complete: true, templates: [] });
    expect(businessId).toBeTruthy();
  });

  it("advances completed occurrences without posting an expense and preserves month-end cadence", async () => {
    const { t, owner, businessId } = await setup();
    const id = await owner.mutation(api.expenseTemplates.save, { action: "create", name: "Rent", category: "Rent", amountUgx: 200_000, account: "cash", recurrence: "monthly", nextDueOn: "2026-01-31", idempotencyKey: "expense-template-month-end-01" });
    await owner.mutation(api.expenseTemplates.save, { action: "complete", templateId: id, name: "Rent", category: "", amountUgx: null, account: "cash", recurrence: "monthly", nextDueOn: "2000-01-01", expectedNextDueOn: "2026-01-31" });
    expect(await owner.query(api.expenseTemplates.list, {})).toMatchObject({ access: "ready", templates: [{ nextDueOn: "2026-02-28" }] });
    await owner.mutation(api.expenseTemplates.save, { action: "complete", templateId: id, name: "Rent", category: "", amountUgx: null, account: "cash", recurrence: "monthly", nextDueOn: "2000-01-01", expectedNextDueOn: "2026-02-28" });
    await expect(owner.mutation(api.expenseTemplates.save, { action: "complete", templateId: id, name: "Rent", category: "", amountUgx: null, account: "cash", recurrence: "monthly", nextDueOn: "2000-01-01", expectedNextDueOn: "2026-02-28" })).rejects.toThrow("date changed in another session");
    expect(await owner.query(api.expenseTemplates.list, {})).toMatchObject({ access: "ready", templates: [{ nextDueOn: "2026-03-31" }] });
    expect(await t.run(ctx => ctx.db.query("entries").collect())).toHaveLength(0);
    expect((await t.run(ctx => ctx.db.query("auditEvents").collect())).map(row => row.action)).toEqual(["expense_template.created", "expense_template.occurrence_completed", "expense_template.occurrence_completed"]);
    expect(businessId).toBeTruthy();
  });

  it("does not allow an upcoming reminder occurrence to be completed early", async () => {
    const { owner } = await setup();
    const id = await owner.mutation(api.expenseTemplates.save, { action: "create", name: "Annual license", category: "Software", amountUgx: null, account: "cash", recurrence: "yearly", nextDueOn: "2026-12-01", idempotencyKey: "expense-template-future-001" });
    await expect(owner.mutation(api.expenseTemplates.save, { action: "complete", templateId: id, name: "Annual license", category: "", amountUgx: null, account: "cash", recurrence: "yearly", nextDueOn: "2000-01-01", expectedNextDueOn: "2026-12-01" })).rejects.toThrow("not due yet");
    const overview = await owner.query(api.expenseTemplates.list, {});
    expect(overview.access === "ready" ? overview.templates[0].nextDueOn : null).toBe("2026-12-01");
  });
});
