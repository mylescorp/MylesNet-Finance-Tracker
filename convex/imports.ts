import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasPermission } from "./accessControl";
import { assertPeriodUnlocked } from "./periodLocks";

const account = v.union(v.literal("cash"), v.literal("mobile_money"), v.literal("unallocated"));
const importType = v.union(v.literal("cashbook"), v.literal("centipid_analytics"));

async function ownerContext(ctx: MutationCtx | QueryCtx, businessId: Id<"businesses">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in to manage imports.");
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  if (!membership?.active) throw new ConvexError("Select an active workspace membership before importing data.");
  const business = await ctx.db.get("businesses", businessId);
  const current = business ? { userId, membership, business } : null;
  if (!current || current.business.dataResetting || !(await hasPermission(ctx, current.membership, "imports.manage"))) throw new ConvexError("Your role cannot import workspace data while the workspace is resetting.");
  return { userId: current.userId, business: current.business };
}

function validDay(day: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`)) && new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
}

function safeAdd(a: number, b: number, label: string) {
  const total = a + b;
  if (!Number.isSafeInteger(total)) throw new ConvexError(`${label} exceeds the safe amount range.`);
  return total;
}

export const previewImpact = query({
  args: { businessId: v.id("businesses"), rowsJsonChunks: v.array(v.string()) },
  returns: v.object({ error: v.string(), totals: v.object({ cash: v.number(), mobile_money: v.number(), unallocated: v.number() }), potentialDuplicateRows: v.number() }),
  handler: async (ctx, args) => {
    await ownerContext(ctx, args.businessId);
    const totals = { cash: 0, mobile_money: 0, unallocated: 0 };
    let potentialDuplicateRows = 0;
    if (!args.rowsJsonChunks.length || args.rowsJsonChunks.length > 20 || args.rowsJsonChunks.some(chunk => chunk.length > 900_000)) return { error: "Import preview is too large to safely calculate.", totals, potentialDuplicateRows };
    const seen = new Set<string>();
    let totalRows = 0;
    for (const rowsJson of args.rowsJsonChunks) {
      let parsed: unknown;
      try { parsed = JSON.parse(rowsJson); } catch { return { error: "Import preview data is invalid.", totals, potentialDuplicateRows }; }
      if (!Array.isArray(parsed) || parsed.length > 500) return { error: "Import preview chunk is invalid.", totals, potentialDuplicateRows };
      totalRows += parsed.length;
      if (totalRows > 10_000) return { error: "Use a preview with no more than 10,000 rows.", totals, potentialDuplicateRows };
      for (const value of parsed) {
        if (!value || typeof value !== "object") return { error: "Import preview data is invalid.", totals, potentialDuplicateRows };
        const row = value as Record<string, unknown>;
        if ((row.kind !== "sale" && row.kind !== "expense") || !Number.isSafeInteger(row.amountUgx) || Number(row.amountUgx) <= 0 || typeof row.occurredOn !== "string" || !validDay(row.occurredOn) || (row.account !== "cash" && row.account !== "mobile_money" && row.account !== "unallocated") || typeof row.category !== "string" || typeof row.note !== "string") return { error: "An import row is invalid. Review the mapping and values before continuing.", totals, potentialDuplicateRows };
        const signature = [row.occurredOn, row.kind, row.account, row.category, row.amountUgx, row.note].join("\u0000");
        if (seen.has(signature)) potentialDuplicateRows++;
        seen.add(signature);
        const signed = row.kind === "sale" ? Number(row.amountUgx) : -Number(row.amountUgx);
        try { totals[row.account] = safeAdd(totals[row.account], signed, "Account impact"); }
        catch { return { error: "The account impact exceeds the supported safe amount range.", totals, potentialDuplicateRows }; }
      }
    }
    return { error: "", totals, potentialDuplicateRows };
  },
});

export const importRows = mutation({
  args: {
    businessId: v.id("businesses"),
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
    const { userId, business } = await ownerContext(ctx, args.businessId);
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
      await assertPeriodUnlocked(ctx, business._id, row.occurredOn);

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
    businessId: v.id("businesses"),
    sourceHash: v.string(), fileName: v.string(), importType, currency: v.string(), totalRows: v.number(), reportSummary: v.optional(v.string()),
  },
  returns: v.object({ batchId: v.id("importBatches"), status: v.union(v.literal("in_progress"), v.literal("completed")), progressRows: v.number(), importedCount: v.number(), skippedCount: v.number() }),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx, args.businessId);
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
      if (duplicate.status === "reversing") throw new ConvexError("This import is currently being reversed. Resume or review it in import history before starting another import.");
      if (duplicate.status === "reversed") throw new ConvexError("This source file was already reversed. Review the import history before importing changed data.");
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
  args: { businessId: v.id("businesses"), batchId: v.id("importBatches") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx, args.businessId);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id) throw new ConvexError("Import batch not found.");
    if (batch.status === "completed") return null;
    if (batch.status !== "in_progress") throw new ConvexError("Only an active import can be completed.");
    if (batch.progressRows !== batch.totalRows) throw new ConvexError("Import still has rows to process.");
    await ctx.db.patch("importBatches", batch._id, { status: "completed" });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.completed", entityType: "import", entityId: batch._id, occurredAt: Date.now(), summary: `Imported ${batch.importedCount} rows from ${batch.fileName}; ${batch.skippedCount} duplicates skipped.` });
    return null;
  },
});

export const cancelBatch = mutation({
  args: { businessId: v.id("businesses"), batchId: v.id("importBatches") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx, args.businessId);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id) throw new ConvexError("Import batch not found.");
    if (batch.status !== "in_progress") return null;
    await ctx.db.patch("importBatches", batch._id, { status: "cancelled" });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.cancelled", entityType: "import", entityId: batch._id, occurredAt: Date.now(), summary: `Cancelled import ${batch.fileName} after ${batch.progressRows} of ${batch.totalRows} rows; previously imported rows remain in the ledger.` });
    return null;
  },
});

export const startBatchReversal = mutation({
  args: { businessId: v.id("businesses"), batchId: v.id("importBatches"), reason: v.string() },
  returns: v.object({ status: v.union(v.literal("reversing"), v.literal("reversed")), rollbackProgressRows: v.number(), cursor: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx, args.businessId);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id) throw new ConvexError("Import batch not found.");
    if (batch.status === "reversed") return { status: "reversed" as const, rollbackProgressRows: batch.rollbackProgressRows ?? 0, cursor: null };
    if (batch.status === "reversing") return { status: "reversing" as const, rollbackProgressRows: batch.rollbackProgressRows ?? 0, cursor: batch.rollbackCursor ?? null };
    if (batch.status !== "completed" && batch.status !== "cancelled") throw new ConvexError("Cancel an in-progress import before reversing its saved rows.");
    if (batch.importedCount <= 0 || batch.progressRows <= 0) throw new ConvexError("This batch has no imported ledger rows to reverse.");
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300) throw new ConvexError("Enter a reversal reason between 5 and 300 characters.");
    const now = Date.now();
    await ctx.db.patch("importBatches", batch._id, { status: "reversing", rollbackCursor: undefined, rollbackProgressRows: 0, rollbackReason: reason, rollbackStartedAt: now, rollbackCompletedAt: undefined });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.reversal_started", entityType: "import", entityId: batch._id, occurredAt: now, summary: `Started reversing ${batch.fileName}: ${reason}` });
    return { status: "reversing" as const, rollbackProgressRows: 0, cursor: null };
  },
});

export const reverseBatchChunk = mutation({
  args: { businessId: v.id("businesses"), batchId: v.id("importBatches"), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ status: v.union(v.literal("reversing"), v.literal("reversed")), rollbackProgressRows: v.number(), cursor: v.union(v.string(), v.null()), processedRows: v.number() }),
  handler: async (ctx, args) => {
    const { userId, business } = await ownerContext(ctx, args.businessId);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id) throw new ConvexError("Import batch not found.");
    if (batch.status === "reversed") return { status: "reversed" as const, rollbackProgressRows: batch.rollbackProgressRows ?? 0, cursor: null, processedRows: 0 };
    if (batch.status !== "reversing") throw new ConvexError("Start the import reversal before processing its rows.");
    if (args.cursor !== (batch.rollbackCursor ?? null)) throw new ConvexError("The reversal cursor is stale. Reload import history and continue from its current progress.");
    const prefix = `csv:${batch.sourceHash}:`;
    const result = await ctx.db.query("entries")
      .withIndex("by_business_and_idempotency", q => q.eq("businessId", business._id).gte("idempotencyKey", prefix).lt("idempotencyKey", `${prefix}\uffff`))
      .order("asc")
      .paginate({ numItems: 25, cursor: args.cursor });
    const reason = batch.rollbackReason ?? "Import batch reversal";
    const now = Date.now();
    let reversedNow = 0;
    for (const entry of result.page) {
      if (!entry.idempotencyKey.startsWith(prefix) || entry.source !== "import") throw new ConvexError("The batch contains a row that is not a matching imported cashbook entry.");
      let effectiveEntry = entry;
      if (entry.state === "void") {
        if (!entry.correctedBy) continue;
        const replacement = await ctx.db.get("entries", entry.correctedBy);
        if (!replacement || replacement.businessId !== business._id || replacement.source !== "import" || replacement.correctionOf !== entry._id) throw new ConvexError("The corrected import row has inconsistent replacement history; reconcile it before reversing this batch.");
        if (replacement.state === "void") continue;
        effectiveEntry = replacement;
      }
      await assertPeriodUnlocked(ctx, business._id, effectiveEntry.occurredOn);
      if (effectiveEntry.operationSource) throw new ConvexError("An imported row is linked to an operation and cannot be safely reversed with this batch.");
      const day = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", business._id).eq("day", effectiveEntry.occurredOn)).unique();
      if (!day) throw new ConvexError(`Daily totals for ${effectiveEntry.occurredOn} are missing; reconcile them before reversing this import.`);
      const isSale = effectiveEntry.kind === "sale";
      if (isSale && (day.salesUgx < effectiveEntry.amountUgx || day.saleCount < 1)) throw new ConvexError(`Daily sales totals for ${effectiveEntry.occurredOn} need reconciliation before reversing this import.`);
      if (!isSale && (day.expensesUgx < effectiveEntry.amountUgx || day.expenseCount < 1)) throw new ConvexError(`Daily expense totals for ${effectiveEntry.occurredOn} need reconciliation before reversing this import.`);
      await ctx.db.patch("dailyTotals", day._id, {
        salesUgx: isSale ? safeAdd(day.salesUgx, -effectiveEntry.amountUgx, "Daily sales") : day.salesUgx,
        expensesUgx: isSale ? day.expensesUgx : safeAdd(day.expensesUgx, -effectiveEntry.amountUgx, "Daily expenses"),
        saleCount: isSale ? safeAdd(day.saleCount, -1, "Daily sale count") : day.saleCount,
        expenseCount: isSale ? day.expenseCount : safeAdd(day.expenseCount, -1, "Daily expense count"),
      });
      if (effectiveEntry.account === "cash" || effectiveEntry.account === "mobile_money") {
        const accountName: "cash" | "mobile_money" = effectiveEntry.account;
        const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", business._id).eq("account", accountName)).unique();
        const change = isSale ? -effectiveEntry.amountUgx : effectiveEntry.amountUgx;
        if (balance) await ctx.db.patch("accountBalances", balance._id, { balanceUgx: safeAdd(balance.balanceUgx, change, "Account balance"), updatedAt: now });
        else await ctx.db.insert("accountBalances", { businessId: business._id, account: accountName, balanceUgx: change, updatedAt: now });
      }
      await ctx.db.patch("entries", effectiveEntry._id, { state: "void", voidedAt: now, voidedBy: userId, voidReason: reason });
      await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "entry.import_reversed", entityType: "entry", entityId: effectiveEntry._id, occurredAt: now, summary: `Reversed imported ${effectiveEntry.kind} · ${effectiveEntry.occurredOn} · ${effectiveEntry.category}.`, details: JSON.stringify({ batchId: batch._id, importEntryId: entry._id, correctionReplacementId: effectiveEntry._id === entry._id ? undefined : effectiveEntry._id, reason, amountUgx: effectiveEntry.amountUgx, account: effectiveEntry.account }) });
      reversedNow++;
    }
    const status = result.isDone ? "reversed" as const : "reversing" as const;
    const rollbackProgressRows = safeAdd(batch.rollbackProgressRows ?? 0, reversedNow, "Import reversal progress");
    await ctx.db.patch("importBatches", batch._id, { status, rollbackProgressRows, rollbackCursor: result.isDone ? undefined : result.continueCursor, rollbackCompletedAt: result.isDone ? now : undefined });
    if (result.isDone) await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "import.reversed", entityType: "import", entityId: batch._id, occurredAt: now, summary: `Reversed ${rollbackProgressRows} imported ledger entries from ${batch.fileName}.`, details: JSON.stringify({ reason, importedCount: batch.importedCount, progressRows: batch.progressRows }) });
    return { status, rollbackProgressRows, cursor: result.isDone ? null : result.continueCursor, processedRows: result.page.length };
  },
});

export const history = query({
  args: { businessId: v.id("businesses"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { business } = await ownerContext(ctx, args.businessId);
    const result = await ctx.db.query("importBatches").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(({ _id, fileName, importType, totalRows, importedCount, skippedCount, progressRows, status, rollbackProgressRows, createdAt }) => ({ _id, fileName, importType, totalRows, importedCount, skippedCount, progressRows, status, rollbackProgressRows: rollbackProgressRows ?? 0, createdAt })) };
  },
});

export const reportDetails = query({
  args: { businessId: v.id("businesses"), batchId: v.id("importBatches") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { business } = await ownerContext(ctx, args.businessId);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id || batch.importType !== "centipid_analytics") return null;
    return (await ctx.db.query("importReportDetails").withIndex("by_batch", q => q.eq("batchId", batch._id)).unique())?.reportSummary ?? null;
  },
});

function csvCell(value: string | number) {
  const text = String(value);
  const safe = typeof value === "string" && /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const cashbookReport = query({
  args: { businessId: v.id("businesses"), batchId: v.id("importBatches") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const { business } = await ownerContext(ctx, args.businessId);
    const batch = await ctx.db.get("importBatches", args.batchId);
    if (!batch || batch.businessId !== business._id || batch.importType !== "cashbook") return null;
    if (!Number.isSafeInteger(batch.totalRows) || batch.totalRows < 0 || batch.totalRows > 10_000) throw new ConvexError("This import is outside the supported report size.");
    const prefix = `csv:${batch.sourceHash}:`;
    const rows = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", business._id).gte("idempotencyKey", prefix).lt("idempotencyKey", `${prefix}\uffff`)).take(10_001);
    if (rows.length > 10_000) throw new ConvexError("This import contains too many rows to export safely.");
    if (rows.some(row => row.source !== "import" || !row.idempotencyKey.startsWith(prefix))) throw new ConvexError("This import contains inconsistent source rows; reconcile it before exporting.");
    const headers = ["source_row", "entry_id", "date", "kind", "amount_ugx", "account", "category", "note", "state", "void_reason", "corrected_by_entry_id", "correction_of_entry_id", "created_at_utc"];
    const data = rows.map(row => {
      const sourceRow = row.idempotencyKey.slice(prefix.length);
      if (!/^\d+$/.test(sourceRow) || Number(sourceRow) > batch.totalRows) throw new ConvexError("This import contains an invalid source row reference.");
      return [sourceRow, row._id, row.occurredOn, row.kind, row.amountUgx, row.account, row.category, row.note, row.state, row.voidReason ?? "", row.correctedBy ?? "", row.correctionOf ?? "", new Date(row.createdAt).toISOString()];
    });
    return [headers, ...data].map(row => row.map(csvCell).join(",")).join("\r\n");
  },
});
