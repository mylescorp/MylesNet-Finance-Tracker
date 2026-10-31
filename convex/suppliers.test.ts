/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const { userId, businessId } = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Supplier owner" });
    const businessId = await ctx.db.insert("businesses", { name: "Supplier workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
    await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt: Date.now() });
    await ctx.db.insert("workspacePreferences", { businessId, negativeBalanceWarning: false, updatedBy: userId, updatedAt: Date.now() });
    return { userId, businessId };
  });
  return { t, owner: t.withIdentity({ subject: userId }), userId, businessId };
}

describe("supplier records and expense linkage", () => {
  it("allows bill creators to load supplier defaults without expense-create access", async () => {
    const { t, businessId } = await setup();
    const owner = t.withIdentity({ subject: await t.run(async ctx => {
      const ownerId = (await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId)).unique())!.userId;
      return ownerId;
    }) });
    await owner.mutation(api.suppliers.save, { action: "create", name: "Utilities Co" });
    const billManagerId = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Bill manager" });
      const roleId = await ctx.db.insert("workspaceRoles", { businessId, name: "Bill manager", description: "Manage recurring bills", permissions: ["bills.create"], active: true, createdBy: userId, createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("memberships", { businessId, userId, role: "member", roleId, active: true, createdAt: Date.now() });
      return userId;
    });
    const options = await t.withIdentity({ subject: billManagerId }).query(api.suppliers.activeOptions, {});
    expect(options).toMatchObject({ access: "ready", suppliers: [{ name: "Utilities Co" }] });
  });
  it("normalizes unique names, links expenses, retains history, and audits changes", async () => {
    const { t, owner, businessId } = await setup();
    const supplierId = await owner.mutation(api.suppliers.save, { action: "create", name: "  North  Supply  ", phone: "+256700000000" });
    const found = await owner.query(api.suppliers.directory, { search: "NORTH" });
    expect(found.access === "ready" && found.suppliers.map(row => row.name)).toEqual(["North Supply"]);
    await expect(owner.mutation(api.suppliers.save, { action: "create", name: "north supply" })).rejects.toThrow("A supplier with this name already exists in this workspace.");
    const entryId = await owner.mutation(api.workspace.createEntry, { businessId, kind: "expense", amountUgx: 25000, occurredOn: "2026-10-04", account: "cash", category: "Supplies", note: "Paper order", supplierId, supplierReference: "INV-042", idempotencyKey: "supplier-entry-key-0001" });
    const entry = await t.run(ctx => ctx.db.get(entryId));
    expect(entry).toMatchObject({ supplierId, supplierName: "North Supply", supplierReference: "INV-042" });
    const history = await owner.query(api.suppliers.expenseHistory, { supplierId });
    expect(history).toMatchObject({ access: "ready", complete: true, totalUgx: 25000 });
    if (history.access === "ready") expect(history.expenses[0]).toMatchObject({ entryId, category: "Supplies", reference: "INV-042" });
    await owner.mutation(api.suppliers.save, { action: "archive", supplierId, name: "North Supply" });
    const options = await owner.query(api.suppliers.activeOptions, {});
    expect(options.access === "ready" && options.suppliers).toHaveLength(0);
    expect((await t.run(ctx => ctx.db.get(entryId)))?.supplierName).toBe("North Supply");
    const audit = await t.run(ctx => ctx.db.query("auditEvents").collect());
    expect(audit.map(row => row.action)).toEqual(["supplier.created", "entry.created", "supplier.archived"]);
  });

  it("rejects supplier ids from another workspace and includes linkage in idempotency", async () => {
    const { t, owner, userId, businessId } = await setup();
    const supplierId = await owner.mutation(api.suppliers.save, { action: "create", name: "Workspace Supplier" });
    const foreignSupplierId = await t.run(async ctx => {
      const otherUserId = await ctx.db.insert("users", { name: "Other owner" });
      const otherBusinessId = await ctx.db.insert("businesses", { name: "Other supplier workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: otherUserId, createdAt: Date.now() });
      await ctx.db.insert("memberships", { businessId: otherBusinessId, userId: otherUserId, role: "owner", active: true, createdAt: Date.now() });
      return await ctx.db.insert("suppliers", { businessId: otherBusinessId, name: "Foreign Supplier", normalizedName: "foreign supplier", active: true, createdBy: otherUserId, createdAt: Date.now(), updatedBy: otherUserId, updatedAt: Date.now() });
    });
    await expect(owner.mutation(api.workspace.createEntry, { businessId, kind: "expense", amountUgx: 1000, occurredOn: "2026-10-04", account: "cash", category: "Supplies", note: "", supplierId: foreignSupplierId, idempotencyKey: "supplier-foreign-key-01" })).rejects.toThrow("Choose an active supplier in this workspace.");
    const args = { businessId, kind: "expense" as const, amountUgx: 1000, occurredOn: "2026-10-04", account: "cash" as const, category: "Supplies", note: "", supplierId, supplierReference: "INV-1", idempotencyKey: "supplier-idempotency-0001" };
    await owner.mutation(api.workspace.createEntry, args);
    await expect(owner.mutation(api.workspace.createEntry, { ...args, supplierReference: "INV-2" })).rejects.toThrow("This request key was already used for another entry.");
    expect(userId).toBeTruthy();
  });

  it("records supplier item prices and rejects totals that do not match the expense", async () => {
    const { t, owner, businessId } = await setup();
    const supplierId = await owner.mutation(api.suppliers.save, { action: "create", name: "Produce Market" });
    const item = { name: "Rice", quantity: 2, unit: "bag", unitPriceUgx: 12000, lineTotalUgx: 24000 };
    const args = { businessId, kind: "expense" as const, amountUgx: 24000, occurredOn: "2026-10-06", account: "cash" as const, category: "Stock", note: "", supplierId, lineItems: [item], idempotencyKey: "supplier-item-key-00001" };
    const entryId = await owner.mutation(api.workspace.createEntry, args);
    await expect(owner.mutation(api.workspace.createEntry, { ...args, lineItems: [{ ...item, quantity: 3, unitPriceUgx: 8000, lineTotalUgx: 24000 }] })).rejects.toThrow("This request key was already used for another entry.");
    await expect(owner.mutation(api.workspace.createEntry, { ...args, idempotencyKey: "supplier-item-key-00002", amountUgx: 25000 })).rejects.toThrow("Item line totals must add up to the expense amount.");
    const history = await owner.query(api.suppliers.expenseHistory, { supplierId });
    expect(history.access).toBe("ready");
    if (history.access === "ready") expect(history.expenses[0]).toMatchObject({ entryId, lineItems: [item] });
    expect((await t.run(ctx => ctx.db.get(entryId)))?.lineItems).toEqual([item]);
  });

  it("lets recurring-template managers load supplier choices with expenses view and update", async () => {
    const { t, businessId, owner } = await setup();
    await owner.mutation(api.suppliers.save, { action: "create", name: "Template supplier" });
    const managerId = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Template manager" });
      const roleId = await ctx.db.insert("workspaceRoles", { businessId, name: "Template manager", description: "Manage recurring expense defaults", permissions: ["expenses.view", "expenses.update"], active: true, createdBy: userId, createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("memberships", { businessId, userId, role: "member", roleId, active: true, createdAt: Date.now() });
      return userId;
    });
    const options = await t.withIdentity({ subject: managerId }).query(api.suppliers.activeOptions, {});
    expect(options).toMatchObject({ access: "ready", suppliers: [{ name: "Template supplier" }] });
  });
});
