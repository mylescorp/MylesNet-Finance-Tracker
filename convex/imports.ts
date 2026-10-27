import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const account = v.union(v.literal("cash"), v.literal("mobile_money"), v.literal("unallocated"));
const importType = v.union(v.literal("cashbook"), v.literal("centipid_analytics"));

async function ownerContext(ctx: MutationCtx | QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in before importing data.");
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(20);
  const active = memberships.filter(item => item.active);
  if (memberships.length >= 20 || active.length !== 1 || active[0].role !== "owner") {
    throw new ConvexError("Only the owner of one active workspace can import data.");
  }
  const business = await ctx.db.get("businesses", active[0].businessId);
  if (!business) throw new ConvexError("Workspace not found.");
  return { userId, business };
}

function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`)) && new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
}

function safeAdd(a: number, b: number, label: string) {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw new ConvexError(`${label} exceeds the safe amount range.`);
  return total;
}

export const importRows = mutation({
  args: {
    sourceHash: v.string(),
    rows: v.array(v.object({
      rowNumber: v.number(), kind: v.union(v.literal("sale"), v.literal("expense")),
      amountUgx: v.number(), occurredOn: v.string(), account,
      category: v.string(), note: v.string(),
    })),
  },
  returns: v.object({ imported: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx);
    if (!/^[a-f0-9]{64}$/.test(args.sourceHash) || args.rows.length < 1 || args.rows.length > 25) {
      throw new ConvexError("Import batch is invalid. Use batches of 1 to 25 rows.");
    }
    let imported = 0;
    let skipped = 0;
    for (const row of args.rows) {
      if (!Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1 || !Number.isSafeInteger(row.amountUgx) || row.amountUgx <= 0 || !validDay(row.occurredOn)) {
        throw new ConvexError(`Row ${row.rowNumber} has an invalid date or amount.`);
      }
      const category = row.category.trim();
      const note = row.note.trim();
      if (category.length < 1 || category.length > 80 || note.length > 300) throw new ConvexError(`Row ${row.rowNumber} has an invalid category or note.`);
      const idempotencyKey = `csv:${args.sourceHash}:${row.rowNumber}`;
      const existing = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", business._id).eq("idempotencyKey", idempotencyKey)).unique();
      if (existing) { skipped++; continue; }

      if (row.account !== "unallocated") {
        const financialAccount: "cash" | "mobile_money" = row.account;
        const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", business._id).eq("account", financialAccount)).unique();
        const change = row.kind === "sale" ? row.amountUgx : -row.amountUgx;
        if (balance) await ctx.db.patch("accountBalances", balance._id, { balanceUgx: safeAdd(balance.balanceUgx, change, "Account balance"), updatedAt: Date.now() });
        else await ctx.db.insert("accountBalances", { businessId: business._id, account: financialAccount, balanceUgx: change, updatedAt: Date.now() });
      }
      const entryId = await ctx.db.insert("entries", {
        businessId: business._id, kind: row.kind, amountUgx: row.amountUgx, occurredOn: row.occurredOn,
        account: row.account, category, note, source: "import", idempotencyKey, state: "posted", createdBy: userId, createdAt: Date.now(),
      });
      const day = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", business._id).eq("day", row.occurredOn)).unique();
      const sales = row.kind === "sale" ? row.amountUgx : 0;
      const expenses = row.kind === "expense" ? row.amountUgx : 0;
      if (day) await ctx.db.patch("dailyTotals", day._id, {
        salesUgx: safeAdd(day.salesUgx, sales, "Daily sales"), expensesUgx: safeAdd(day.expensesUgx, expenses, "Daily expenses"),
        saleCount: day.saleCount + (row.kind === "sale" ? 1 : 0), expenseCount: day.expenseCount + (row.kind === "expense" ? 1 : 0),
      });
      else await ctx.db.insert("dailyTotals", { businessId: business._id, day: row.occurredOn, salesUgx: sales, expensesUgx: expenses, saleCount: row.kind === "sale" ? 1 : 0, expenseCount: row.kind === "expense" ? 1 : 0 });
      await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "entry.imported", entityType: "entry", entityId: entryId, occurredAt: Date.now(), summary: `${row.kind} imported · ${row.occurredOn} · ${category}` });
      imported++;
    }
    return { imported, skipped };
  },
});

export const recordBatch = mutation({
  args: {
    sourceHash: v.string(), fileName: v.string(), importType,
    importedCount: v.number(), skippedCount: v.number(), reportSummary: v.optional(v.string()),
  },
  returns: v.id("importBatches"),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx);
    if (!/^[a-f0-9]{64}$/.test(args.sourceHash) || args.fileName.trim().length < 1 || args.fileName.length > 180 || !Number.isSafeInteger(args.importedCount) || args.importedCount < 0 || !Number.isSafeInteger(args.skippedCount) || args.skippedCount < 0 || (args.reportSummary?.length ?? 0) > 64_000) throw new ConvexError("Import summary is invalid.");
    const existing = await ctx.db.query("importBatches").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").take(100);
    const duplicate = existing.find(batch => batch.sourceHash === args.sourceHash && batch.importType === args.importType);
    if (duplicate) return duplicate._id;
    const { reportSummary, ...batchArgs } = args;
    const id = await ctx.db.insert("importBatches", { ...batchArgs, fileName: args.fileName.trim(), businessId: business._id, createdBy: userId, createdAt: Date.now() });
    if (reportSummary) await ctx.db.insert("importReportDetails", { businessId: business._id, batchId: id, reportSummary });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.completed", entityType: "import", entityId: id, occurredAt: Date.now(), summary: `Imported ${args.importedCount} rows from ${args.fileName.trim()}; ${args.skippedCount} duplicates skipped.` });
    return id;
  },
});

export const history = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("importBatches"), fileName: v.string(), importType, importedCount: v.number(), skippedCount: v.number(), createdAt: v.number() })),
  handler: async (ctx) => {
    const { business } = await ownerContext(ctx);
    return (await ctx.db.query("importBatches").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").take(20)).map(({ _id, fileName, importType, importedCount, skippedCount, createdAt }) => ({ _id, fileName, importType, importedCount, skippedCount, createdAt }));
  },
});

export const reportDetails = query({
  args: { batchId: v.id("importBatches") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { business } = await ownerContext(ctx);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id || batch.importType !== "centipid_analytics") return null;
    return (await ctx.db.query("importReportDetails").withIndex("by_batch", q => q.eq("batchId", batch._id)).unique())?.reportSummary ?? null;
  },
});
