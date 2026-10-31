import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { hasPermission } from "./accessControl";
import { getSelectedWorkspace } from "./workspaceContext";

const cleanOptional = (value: string | undefined, max: number, label: string) => {
  const cleaned = value?.trim() ?? "";
  if (cleaned.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return cleaned || undefined;
};

export const activeOptions = query({
  args: {},
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({ access: v.literal("ready"), complete: v.boolean(), suppliers: v.array(v.object({ _id: v.id("suppliers"), name: v.string() })) })),
  handler: async ctx => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || (!(await hasPermission(ctx, current.membership, "expenses.create")) && !(await hasPermission(ctx, current.membership, "expenses.update")) && !(await hasPermission(ctx, current.membership, "bills.create")))) return { access: "restricted" as const };
    const rows = await ctx.db.query("suppliers").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(251);
    return { access: "ready" as const, complete: rows.length <= 250, suppliers: rows.slice(0, 250).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName)).map(row => ({ _id: row._id, name: row.name })) };
  },
});

export const directory = query({
  args: { search: v.optional(v.string()) },
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({ access: v.literal("ready"), complete: v.boolean(), canCreate: v.boolean(), canManage: v.boolean(), suppliers: v.array(v.object({ _id: v.id("suppliers"), name: v.string(), phone: v.union(v.string(), v.null()), email: v.union(v.string(), v.null()), note: v.union(v.string(), v.null()), active: v.boolean() })) })),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.view"))) return { access: "restricted" as const };
    const search = args.search?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en") ?? "";
    if (search.length > 100) throw new Error("Supplier search can be up to 100 characters.");
    const limit = search ? 250 : 500;
    const rows = search
      ? await ctx.db.query("suppliers").withIndex("by_business_and_name", q => q.eq("businessId", current.business._id).gte("normalizedName", search).lt("normalizedName", `${search}\u{10ffff}`)).take(limit + 1)
      : await ctx.db.query("suppliers").withIndex("by_business", q => q.eq("businessId", current.business._id)).take(limit + 1);
    const [canCreate, canManage] = await Promise.all([hasPermission(ctx, current.membership, "expenses.create"), hasPermission(ctx, current.membership, "expenses.update")]);
    return { access: "ready" as const, complete: rows.length <= limit, canCreate, canManage, suppliers: rows.slice(0, limit).map(({ _id, name, phone, email, note, active }) => ({ _id, name, phone: phone ?? null, email: email ?? null, note: note ?? null, active })) };
  },
});

export const save = mutation({
  args: { action: v.union(v.literal("create"), v.literal("edit"), v.literal("archive"), v.literal("restore")), supplierId: v.optional(v.id("suppliers")), name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()), note: v.optional(v.string()) },
  returns: v.union(v.id("suppliers"), v.null()),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    const requiredPermission = args.action === "create" ? "expenses.create" : "expenses.update";
    if (!current || !(await hasPermission(ctx, current.membership, requiredPermission))) throw new Error("Your role cannot manage this supplier record.");
    const now = Date.now();
    const existing = args.supplierId ? await ctx.db.get(args.supplierId) : null;
    if (args.action !== "create" && (!existing || existing.businessId !== current.business._id)) throw new Error("Choose a supplier in this workspace.");
    if (args.action === "create" && args.supplierId) throw new Error("A new supplier cannot include an existing supplier id.");
    if (args.action === "archive" || args.action === "restore") {
      const active = args.action === "restore";
      if (existing!.active === active) return existing!._id;
      await ctx.db.patch(existing!._id, { active, updatedBy: current.userId, updatedAt: now });
      await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: active ? "supplier.restored" : "supplier.archived", entityType: "supplier", entityId: existing!._id, occurredAt: now, summary: `${active ? "Restored" : "Archived"} supplier ${existing!.name}.`, details: JSON.stringify({ name: existing!.name, active }) });
      return existing!._id;
    }
    const name = args.name.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 100) throw new Error("Supplier name must be between 2 and 100 characters.");
    const normalizedName = name.toLocaleLowerCase("en");
    const duplicate = await ctx.db.query("suppliers").withIndex("by_business_and_name", q => q.eq("businessId", current.business._id).eq("normalizedName", normalizedName)).unique();
    if (duplicate && duplicate._id !== existing?._id) throw new Error("A supplier with this name already exists in this workspace.");
    const phone = cleanOptional(args.phone, 40, "Phone");
    const email = cleanOptional(args.email, 120, "Email");
    const note = cleanOptional(args.note, 300, "Note");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid supplier email address.");
    if (existing) {
      const before = { name: existing.name, phone: existing.phone, email: existing.email, note: existing.note };
      await ctx.db.patch(existing._id, { name, normalizedName, phone, email, note, active: true, updatedBy: current.userId, updatedAt: now });
      await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "supplier.updated", entityType: "supplier", entityId: existing._id, occurredAt: now, summary: `Updated supplier ${name}.`, details: JSON.stringify({ before, after: { name, phone, email, note } }) });
      return existing._id;
    }
    const id = await ctx.db.insert("suppliers", { businessId: current.business._id, name, normalizedName, phone, email, note, active: true, createdBy: current.userId, createdAt: now, updatedBy: current.userId, updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "supplier.created", entityType: "supplier", entityId: id, occurredAt: now, summary: `Created supplier ${name}.`, details: JSON.stringify({ name, phone, email, note }) });
    return id;
  },
});

export const expenseHistory = query({
  args: { supplierId: v.id("suppliers") },
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({ access: v.literal("ready"), complete: v.boolean(), priceHistoryComplete: v.boolean(), totalUgx: v.number(), expenses: v.array(v.object({ entryId: v.id("entries"), occurredOn: v.string(), category: v.string(), amountUgx: v.number(), reference: v.union(v.string(), v.null()), lineItems: v.array(v.object({ name: v.string(), quantity: v.number(), unit: v.string(), unitPriceUgx: v.number(), lineTotalUgx: v.number() })) })) })),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.view"))) return { access: "restricted" as const };
    const supplier = await ctx.db.get(args.supplierId);
    if (!supplier || supplier.businessId !== current.business._id) return { access: "restricted" as const };
    const rows = await ctx.db.query("entries").withIndex("by_business_and_supplier_and_date", q => q.eq("businessId", current.business._id).eq("supplierId", supplier._id)).order("desc").take(501);
    const posted = rows.filter(row => row.kind === "expense" && row.state === "posted").slice(0, 500);
    let totalUgx = 0;
    for (const row of posted) {
      totalUgx += row.amountUgx;
      if (!Number.isSafeInteger(totalUgx)) throw new Error("Supplier expense total exceeds the supported amount range.");
    }
    let remainingPriceRows = 500;
    let priceHistoryComplete = true;
    const expenses = posted.map(row => {
      const savedLineItems = row.lineItems ?? [];
      const lineItems = savedLineItems.slice(0, remainingPriceRows);
      remainingPriceRows -= lineItems.length;
      if (lineItems.length < savedLineItems.length) priceHistoryComplete = false;
      return { entryId: row._id, occurredOn: row.occurredOn, category: row.category, amountUgx: row.amountUgx, reference: row.supplierReference ?? null, lineItems };
    });
    return { access: "ready" as const, complete: rows.length <= 500, priceHistoryComplete, totalUgx, expenses };
  },
});
