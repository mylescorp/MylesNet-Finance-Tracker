import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { hasPermission } from "./accessControl";

const account = v.union(v.literal("cash"), v.literal("mobile_money"), v.literal("unallocated"));
const importType = v.union(v.literal("cashbook"), v.literal("centipid_analytics"));

async function ownerContext(ctx: MutationCtx | QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in before importing data.");
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(20);
  const active = memberships.filter(item => item.active);
  if (memberships.length >= 20 || active.length !== 1 || !(await hasPermission(ctx, active[0], "imports.manage"))) {
    throw new ConvexError("Your role cannot import data.");
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
    batchId: v.id("importBatches"),
    startRow: v.number(),
    rows: v.array(v.object({
      rowNumber: v.number(), kind: v.union(v.literal("sale"), v.literal("expense")),
      amountUgx: v.number(), occurredOn: v.string(), account,
      category: v.string(), note: v.string(),
    })),
  },
  returns: v.object({ imported: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id || batch.currency !== business.currency || batch.status !== "in_progress" || args.startRow !== batch.progressRows || args.rows.length < 1 || args.rows.length > 25 || batch.progressRows + args.rows.length > batch.totalRows) {
      throw new ConvexError("Import batch is invalid. Use batches of 1 to 25 rows.");
    }
    if (batch.importType === "centipid_analytics" && business.currency !== "UGX") throw new ConvexError("Centipid analytics totals are UGX; the workspace must use UGX.");
    let imported = 0;
    let skipped = 0;
    for (const row of args.rows) {
      if (!Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1 || !Number.isSafeInteger(row.amountUgx) || row.amountUgx <= 0 || !validDay(row.occurredOn)) {
        throw new ConvexError(`Row ${row.rowNumber} has an invalid date or amount.`);
      }
      if (batch.importType === "centipid_analytics" && (row.kind !== "sale" || row.account !== "unallocated")) throw new ConvexError("Centipid daily totals must be unallocated sales.");
      if (batch.importType === "cashbook" && row.account === "unallocated") throw new ConvexError("Cashbook rows need an explicit account mapping.");
      const category = row.category.trim();
      const note = row.note.trim();
      if (category.length < 1 || category.length > 80 || note.length > 300) throw new ConvexError(`Row ${row.rowNumber} has an invalid category or note.`);
      const idempotencyKey = `csv:${batch.sourceHash}:${row.rowNumber}`;
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
    await ctx.db.patch("importBatches", batch._id, {
      importedCount: batch.importedCount + imported,
      skippedCount: batch.skippedCount + skipped,
      progressRows: batch.progressRows + args.rows.length,
    });
    return { imported, skipped };
  },
});

export const beginBatch = mutation({
  args: {
    sourceHash: v.string(), fileName: v.string(), importType, currency: v.string(), totalRows: v.number(), reportSummary: v.optional(v.string()),
  },
  returns: v.object({ batchId: v.id("importBatches"), status: v.union(v.literal("in_progress"), v.literal("completed")), progressRows: v.number(), importedCount: v.number(), skippedCount: v.number() }),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx);
    if (!/^[a-f0-9]{64}$/.test(args.sourceHash) || args.fileName.trim().length < 1 || args.fileName.length > 180 || !Number.isSafeInteger(args.totalRows) || args.totalRows < 0 || args.totalRows > 10_000 || (args.reportSummary?.length ?? 0) > 64_000) throw new ConvexError("Import summary is invalid.");
    if (args.currency !== business.currency) throw new ConvexError("Workspace currency changed while you prepared the import. Reload the page and review the CSV again.");
    if (args.importType === "centipid_analytics" && business.currency !== "UGX") throw new ConvexError("Centipid analytics reports are denominated in UGX. Set the workspace currency to UGX first.");
    const duplicate = await ctx.db.query("importBatches").withIndex("by_business_and_source", q => q.eq("businessId", business._id).eq("sourceHash", args.sourceHash)).unique();
    if (duplicate) {
      if (duplicate.importType !== args.importType || duplicate.totalRows !== args.totalRows || duplicate.currency !== args.currency) throw new ConvexError("This file hash is already associated with a different import shape.");
      if (duplicate.status === "cancelled") {
        await ctx.db.patch("importBatches", duplicate._id, { status: "in_progress" });
        await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.resumed", entityType: "import", entityId: duplicate._id, occurredAt: Date.now(), summary: `Resumed import ${duplicate.fileName} from row ${duplicate.progressRows + 1}.` });
        return { batchId: duplicate._id, status: "in_progress" as const, progressRows: duplicate.progressRows, importedCount: duplicate.importedCount, skippedCount: duplicate.skippedCount };
      }
      return { batchId: duplicate._id, status: duplicate.status, progressRows: duplicate.progressRows, importedCount: duplicate.importedCount, skippedCount: duplicate.skippedCount };
    }
    const { reportSummary, ...batchArgs } = args;
    const now = Date.now();
    const batchId = await ctx.db.insert("importBatches", { ...batchArgs, fileName: args.fileName.trim(), businessId: business._id, createdBy: userId, createdAt: now, importedCount: 0, skippedCount: 0, progressRows: 0, status: "in_progress" });
    if (reportSummary) await ctx.db.insert("importReportDetails", { businessId: business._id, batchId, reportSummary });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.started", entityType: "import", entityId: batchId, occurredAt: now, summary: `Started ${args.importType} import: ${args.fileName.trim()} (${args.totalRows} rows).` });
    return { batchId, status: "in_progress" as const, progressRows: 0, importedCount: 0, skippedCount: 0 };
  },
});

export const completeBatch = mutation({
  args: { batchId: v.id("importBatches") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id) throw new ConvexError("Import batch not found.");
    if (batch.status === "completed") return null;
    if (batch.progressRows !== batch.totalRows) throw new ConvexError("Import still has rows to process.");
    await ctx.db.patch("importBatches", batch._id, { status: "completed" });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.completed", entityType: "import", entityId: batch._id, occurredAt: Date.now(), summary: `Imported ${batch.importedCount} rows from ${batch.fileName}; ${batch.skippedCount} duplicates skipped.` });
    return null;
  },
});

export const cancelBatch = mutation({
  args: { batchId: v.id("importBatches") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id) throw new ConvexError("Import batch not found.");
    if (batch.status !== "in_progress") return null;
    await ctx.db.patch("importBatches", batch._id, { status: "cancelled" });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.cancelled", entityType: "import", entityId: batch._id, occurredAt: Date.now(), summary: `Cancelled import ${batch.fileName} after ${batch.progressRows} of ${batch.totalRows} rows; previously imported rows remain in the ledger.` });
    return null;
  },
});

export const history = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("importBatches"), fileName: v.string(), importType, totalRows: v.number(), importedCount: v.number(), skippedCount: v.number(), progressRows: v.number(), status: v.union(v.literal("in_progress"), v.literal("completed"), v.literal("cancelled")), createdAt: v.number() })),
  handler: async (ctx) => {
    const { business } = await ownerContext(ctx);
    return (await ctx.db.query("importBatches").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").take(20)).map(({ _id, fileName, importType, totalRows, importedCount, skippedCount, progressRows, status, createdAt }) => ({ _id, fileName, importType, totalRows, importedCount, skippedCount, progressRows, status, createdAt }));
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
