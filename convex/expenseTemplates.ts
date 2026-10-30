import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { hasPermission } from "./accessControl";
import { getSelectedWorkspace } from "./workspaceContext";

const recurrenceV = v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("yearly"));
const accountV = v.union(v.literal("cash"), v.literal("mobile_money"));

function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === day;
}

export const list = query({
  args: {},
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({
    access: v.literal("ready"), canManage: v.boolean(), complete: v.boolean(),
    templates: v.array(v.object({ _id: v.id("expenseTemplates"), name: v.string(), category: v.string(), amountUgx: v.union(v.number(), v.null()), account: accountV, recurrence: recurrenceV, nextDueOn: v.string(), supplierName: v.union(v.string(), v.null()), supplierId: v.union(v.id("suppliers"), v.null()), paused: v.boolean(), active: v.boolean() })),
  })),
  handler: async ctx => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.view"))) return { access: "restricted" as const };
    const [rows, canManage] = await Promise.all([
      ctx.db.query("expenseTemplates").withIndex("by_business_and_due", q => q.eq("businessId", current.business._id).eq("active", true)).take(101),
      hasPermission(ctx, current.membership, "expenses.update"),
    ]);
    return { access: "ready" as const, canManage, complete: rows.length <= 100, templates: rows.slice(0, 100).map(row => ({ _id: row._id, name: row.name, category: row.category, amountUgx: row.amountUgx ?? null, account: row.account, recurrence: row.recurrence, nextDueOn: row.nextDueOn, supplierName: row.supplierName ?? null, supplierId: row.supplierId ?? null, paused: row.paused, active: row.active })) };
  },
});

export const save = mutation({
  args: {
    action: v.union(v.literal("create"), v.literal("edit"), v.literal("pause"), v.literal("resume"), v.literal("archive")),
    templateId: v.optional(v.id("expenseTemplates")), name: v.string(), category: v.string(), amountUgx: v.union(v.number(), v.null()),
    account: accountV, recurrence: recurrenceV, nextDueOn: v.string(), supplierId: v.optional(v.id("suppliers")), idempotencyKey: v.optional(v.string()),
  },
  returns: v.union(v.id("expenseTemplates"), v.null()),
  handler: async (ctx, args) => {
    const current = await getSelectedWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "expenses.update"))) throw new Error("Your role cannot manage recurring expense templates.");
    const existing = args.templateId ? await ctx.db.get(args.templateId) : null;
    if (args.action !== "create" && (!existing || existing.businessId !== current.business._id)) throw new Error("Choose a recurring expense template in this workspace.");
    if (args.action === "create" && (args.templateId || !args.idempotencyKey || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120)) throw new Error("Refresh the template form and try again.");
    if (args.action === "create") {
      const prior = await ctx.db.query("expenseTemplates").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey!)).unique();
      if (prior) {
        if (prior.name !== args.name.trim().replace(/\s+/g, " ") || prior.category !== args.category.trim().replace(/\s+/g, " ") || prior.amountUgx !== (args.amountUgx ?? undefined) || prior.account !== args.account || prior.recurrence !== args.recurrence || prior.nextDueOn !== args.nextDueOn || prior.supplierId !== args.supplierId) throw new Error("This request key was already used for a different recurring expense template.");
        return prior._id;
      }
    }
    const now = Date.now();
    if (["pause", "resume", "archive"].includes(args.action)) {
      const active = args.action !== "archive";
      const paused = args.action === "pause";
      await ctx.db.patch(existing!._id, { active, paused, updatedBy: current.userId, updatedAt: now });
      await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: `expense_template.${args.action}d`, entityType: "expenseTemplate", entityId: existing!._id, occurredAt: now, summary: `${args.action === "archive" ? "Archived" : args.action === "pause" ? "Paused" : "Resumed"} recurring expense ${existing!.name}.`, details: JSON.stringify({ name: existing!.name, active, paused }) });
      return existing!._id;
    }
    const name = args.name.trim().replace(/\s+/g, " ");
    const category = args.category.trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 100 || category.length < 1 || category.length > 80 || !validDay(args.nextDueOn)) throw new Error("Enter a valid name, category, and next due date.");
    if (args.amountUgx !== null && (!Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0)) throw new Error("Expected amount must be a positive whole-shilling safe integer, or left blank when it varies.");
    const supplier = args.supplierId ? await ctx.db.get(args.supplierId) : null;
    if (args.supplierId && (!supplier || supplier.businessId !== current.business._id || !supplier.active)) throw new Error("Choose an active supplier in this workspace.");
    const values = { name, category, amountUgx: args.amountUgx ?? undefined, account: args.account, recurrence: args.recurrence, nextDueOn: args.nextDueOn, supplierId: supplier?._id, supplierName: supplier?.name, updatedBy: current.userId, updatedAt: now };
    if (existing) {
      await ctx.db.patch(existing._id, values);
      await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "expense_template.updated", entityType: "expenseTemplate", entityId: existing._id, occurredAt: now, summary: `Updated recurring expense ${name}.`, details: JSON.stringify({ before: { name: existing.name, category: existing.category, amountUgx: existing.amountUgx, account: existing.account, recurrence: existing.recurrence, nextDueOn: existing.nextDueOn }, after: { name, category, amountUgx: args.amountUgx, account: args.account, recurrence: args.recurrence, nextDueOn: args.nextDueOn } }) });
      return existing._id;
    }
    const id = await ctx.db.insert("expenseTemplates", { businessId: current.business._id, ...values, paused: false, active: true, idempotencyKey: args.idempotencyKey!, createdBy: current.userId, createdAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "expense_template.created", entityType: "expenseTemplate", entityId: id, occurredAt: now, summary: `Created recurring expense ${name}.`, details: JSON.stringify({ name, category, amountUgx: args.amountUgx, account: args.account, recurrence: args.recurrence, nextDueOn: args.nextDueOn, supplierName: supplier?.name ?? null }) });
    return id;
  },
});
