/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const { userId, businessId } = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Lifecycle owner" });
    const businessId = await ctx.db.insert("businesses", { name: "Lifecycle workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
    await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt: Date.now() });
    await ctx.db.insert("workspacePreferences", { businessId, negativeBalanceWarning: false, duplicateWindowDays: 0, updatedBy: userId, updatedAt: Date.now() });
    await ctx.db.insert("accountBalances", { businessId, account: "cash", balanceUgx: 100_000, updatedAt: Date.now() });
    return { userId, businessId };
  });
  const owner = t.withIdentity({ subject: userId });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
  return { t, owner, userId, businessId, today };
}

describe("financial lifecycle invariants", () => {
  it("reverses a savings contribution once and restores its account and holding balances", async () => {
    const { t, owner, businessId, today } = await setup();
    const holdingId = await owner.mutation(api.operations.createSavingsHolding, { businessId, name: "School fees", idempotencyKey: "lifecycle-saving-hold-001" });
    const flowId = await owner.mutation(api.operations.recordSavingsFlow, { businessId, holdingId, kind: "contribution", amountUgx: 12_000, account: "cash", occurredOn: today, note: "Weekly savings", idempotencyKey: "lifecycle-saving-flow-001" });
    await owner.mutation(api.operations.reverseSavingsFlow, { businessId, flowId, reason: "Recorded twice" });
    await owner.mutation(api.operations.reverseSavingsFlow, { businessId, flowId, reason: "Recorded twice" });
    const stored = await t.run(async ctx => ({ holding: await ctx.db.get("savingsHoldings", holdingId), flow: await ctx.db.get("savingsFlows", flowId), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique() }));
    expect(stored.holding?.balanceUgx).toBe(0);
    expect(stored.flow).toMatchObject({ state: "void", voidReason: "Recorded twice" });
    expect(stored.cash?.balanceUgx).toBe(100_000);
    expect((await t.run(ctx => ctx.db.query("auditEvents").collect())).filter(event => event.action === "savings.flow_reversed")).toHaveLength(1);
  });

  it("reverses loan principal and interest with the linked expense and day totals", async () => {
    const { t, owner, businessId, today } = await setup();
    await owner.mutation(api.workspace.createEntry, { businessId, kind: "expense", amountUgx: 700, occurredOn: today, account: "cash", category: "Unrelated", note: "Office water", idempotencyKey: "lifecycle-loan-unrelated-001" });
    const loanId = await owner.mutation(api.operations.createLoan, { businessId, lender: "Community lender", principalUgx: 30_000, annualRateBps: 1200, termMonths: 12, startedOn: today, account: "cash", note: "Working capital", idempotencyKey: "lifecycle-loan-create-001" });
    const repaymentId = await owner.mutation(api.operations.recordLoanRepayment, { businessId, loanId, principalUgx: 5_000, interestUgx: 1_000, paidOn: today, account: "cash", idempotencyKey: "lifecycle-loan-payment-001" });
    const linkedExpense = await t.run(ctx => ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId).eq("idempotencyKey", "loan-interest:lifecycle-loan-payment-001")).unique());
    await owner.mutation(api.operations.reverseLoanRepayment, { businessId, repaymentId, reason: "Incorrect repayment" });
    const stored = await t.run(async ctx => ({ loan: await ctx.db.get("loans", loanId), repayment: await ctx.db.get("loanRepayments", repaymentId), expense: linkedExpense ? await ctx.db.get("entries", linkedExpense._id) : null, day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique(), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique() }));
    expect(stored.loan).toMatchObject({ outstandingPrincipalUgx: 30_000, status: "active" });
    expect(stored.repayment).toMatchObject({ state: "void", amountUgx: 6_000 });
    expect(stored.expense).toMatchObject({ state: "void", amountUgx: 1_000 });
    expect(stored.day).toMatchObject({ expensesUgx: 700, expenseCount: 1 });
    expect(stored.cash?.balanceUgx).toBe(129_300);
  });

  it("restores the bill recurrence snapshot and linked cashbook expense on payment reversal", async () => {
    const { t, owner, businessId, today } = await setup();
    const billId = await owner.mutation(api.operations.createBill, { businessId, name: "Internet", category: "Utilities", amountUgx: 8_000, account: "cash", recurrence: "monthly", nextDueOn: today, idempotencyKey: "lifecycle-bill-create-001" });
    const paymentId = await owner.mutation(api.operations.recordBillPayment, { businessId, billId, paidOn: today, account: "cash", idempotencyKey: "lifecycle-bill-payment-001" });
    const payment = await t.run(ctx => ctx.db.get("billPayments", paymentId));
    await owner.mutation(api.operations.reverseBillPayment, { businessId, paymentId, reason: "Wrong schedule" });
    const stored = await t.run(async ctx => ({ bill: await ctx.db.get("bills", billId), payment: await ctx.db.get("billPayments", paymentId), expense: payment ? await ctx.db.get("entries", payment.entryId) : null, cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique() }));
    expect(stored.bill).toMatchObject({ nextDueOn: today, scheduleStartDueOn: today });
    expect(stored.payment).toMatchObject({ state: "void", voidReason: "Wrong schedule" });
    expect(stored.expense).toMatchObject({ state: "void", operationSource: "bill_payment" });
    expect(stored.cash?.balanceUgx).toBe(100_000);
  });

  it("corrects a manual expense atomically and treats an identical retry as idempotent", async () => {
    const { t, owner, businessId, today } = await setup();
    const entryId = await owner.mutation(api.workspace.createEntry, { businessId, kind: "expense", amountUgx: 4_000, occurredOn: today, account: "cash", category: "Supplies", note: "Wrong amount", idempotencyKey: "lifecycle-entry-create-001" });
    const correction = { businessId, entryId, amountUgx: 3_000, occurredOn: today, account: "cash" as const, category: "Supplies", note: "Corrected amount", reason: "Receipt total was lower", idempotencyKey: "lifecycle-entry-correct-001" };
    const replacementId = await owner.mutation(api.workspace.correctEntry, correction);
    expect(await owner.mutation(api.workspace.correctEntry, correction)).toBe(replacementId);
    const stored = await t.run(async ctx => ({ original: await ctx.db.get("entries", entryId), replacement: await ctx.db.get("entries", replacementId), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(), day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique() }));
    expect(stored.original).toMatchObject({ state: "void", correctedBy: replacementId });
    expect(stored.replacement).toMatchObject({ state: "posted", correctionOf: entryId, amountUgx: 3_000 });
    expect(stored.cash?.balanceUgx).toBe(97_000);
    expect(stored.day).toMatchObject({ expensesUgx: 3_000, expenseCount: 1 });
  });

  it("keeps a split as an estimate until confirmation, then preserves account totals and idempotent retries", async () => {
    const { t, owner, businessId, today } = await setup();
    await t.run(async ctx => {
      const preferences = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", businessId)).unique();
      if (preferences) await ctx.db.patch("workspacePreferences", preferences._id, { negativeBalanceWarning: true });
    });
    const entryId = await owner.mutation(api.workspace.createEntry, { businessId, kind: "expense", amountUgx: 4_000, occurredOn: today, account: "cash", category: "General", note: "Mixed supplies", idempotencyKey: "lifecycle-split-source-001" });
    const args = { businessId, entryId, allocations: [{ amountUgx: 1_500, category: "Stationery", account: "cash" as const }, { amountUgx: 2_500, category: "Cleaning", account: "mobile_money" as const }], reason: "Receipt lists two categories", idempotencyKey: "lifecycle-split-estimate-001" };
    const splitId = await owner.mutation(api.splitCorrections.saveEstimate, args);
    expect(await owner.mutation(api.splitCorrections.saveEstimate, args)).toBe(splitId);
    const snapshot = await t.run(async ctx => ({ source: await ctx.db.get("entries", entryId), split: await ctx.db.get("entrySplitCorrections", splitId), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(), mobile: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "mobile_money")).unique(), day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique() }));
    expect(snapshot.source).toMatchObject({ state: "posted", amountUgx: 4_000 });
    expect(snapshot.split?.provenance).toBe("estimated");
    expect(snapshot.cash?.balanceUgx).toBe(96_000);
    expect(snapshot.mobile).toBeNull();
    expect(snapshot.day).toMatchObject({ expensesUgx: 4_000, expenseCount: 1 });
    await expect(owner.mutation(api.splitCorrections.confirmEstimate, { businessId, splitCorrectionId: splitId })).rejects.toThrow("below zero");
    const replacements = await owner.mutation(api.splitCorrections.confirmEstimate, { businessId, splitCorrectionId: splitId, confirmNegativeBalance: true });
    expect(await owner.mutation(api.splitCorrections.confirmEstimate, { businessId, splitCorrectionId: splitId })).toEqual(replacements);
    const confirmed = await t.run(async ctx => ({ source: await ctx.db.get("entries", entryId), split: await ctx.db.get("entrySplitCorrections", splitId), rows: await Promise.all(replacements.map(id => ctx.db.get("entries", id))), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(), mobile: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "mobile_money")).unique(), day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique() }));
    expect(confirmed.source).toMatchObject({ state: "void", correctedBy: replacements[0] });
    expect(confirmed.split).toMatchObject({ provenance: "confirmed", replacementEntryIds: replacements, totalUgx: 4_000 });
    expect(confirmed.rows).toMatchObject([{ amountUgx: 1_500, category: "Stationery", account: "cash", state: "posted" }, { amountUgx: 2_500, category: "Cleaning", account: "mobile_money", state: "posted" }]);
    expect(confirmed.cash?.balanceUgx).toBe(98_500);
    expect(confirmed.mobile?.balanceUgx).toBe(-2_500);
    expect(confirmed.day).toMatchObject({ expensesUgx: 4_000, expenseCount: 2 });
    expect((await t.run(ctx => ctx.db.query("auditEvents").collect())).filter(event => event.action === "entry.split_confirmed")).toHaveLength(1);
    const reopenArgs = { businessId, splitCorrectionId: splitId, reason: "Found the original allocation detail", idempotencyKey: "lifecycle-split-reopen-001" };
    await owner.mutation(api.splitCorrections.reopenConfirmed, reopenArgs);
    await owner.mutation(api.splitCorrections.reopenConfirmed, reopenArgs);
    const reopened = await t.run(async ctx => ({ source: await ctx.db.get("entries", entryId), split: await ctx.db.get("entrySplitCorrections", splitId), rows: await Promise.all(replacements.map(id => ctx.db.get("entries", id))), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(), mobile: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "mobile_money")).unique(), day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique() }));
    expect(reopened.source).toMatchObject({ state: "posted", amountUgx: 4_000 });
    expect(reopened.source?.splitCorrectionId).toBeUndefined();
    expect(reopened.split).toMatchObject({ provenance: "reversed", reopenIdempotencyKey: reopenArgs.idempotencyKey });
    expect(reopened.rows.every(row => row?.state === "void")).toBe(true);
    expect(reopened.cash?.balanceUgx).toBe(96_000);
    expect(reopened.mobile?.balanceUgx).toBe(0);
    expect(reopened.day).toMatchObject({ expensesUgx: 4_000, expenseCount: 1 });
  });

  it("requires split allocations to preserve the source amount and keeps cancelled estimates out of the ledger", async () => {
    const { t, owner, businessId, today } = await setup();
    const entryId = await owner.mutation(api.workspace.createEntry, { businessId, kind: "sale", amountUgx: 5_000, occurredOn: today, account: "cash", category: "Retail", note: "Mixed sale", idempotencyKey: "lifecycle-split-cancel-source" });
    await expect(owner.mutation(api.splitCorrections.saveEstimate, { businessId, entryId, allocations: [{ amountUgx: 1_000, category: "Food", account: "cash" }, { amountUgx: 3_000, category: "Household", account: "cash" }], reason: "Breakdown from notes", idempotencyKey: "lifecycle-split-bad-sum" })).rejects.toThrow("add up exactly");
    const splitCorrectionId = await owner.mutation(api.splitCorrections.saveEstimate, { businessId, entryId, allocations: [{ amountUgx: 2_000, category: "Food", account: "cash" }, { amountUgx: 3_000, category: "Household", account: "cash" }], reason: "Breakdown from notes", idempotencyKey: "lifecycle-split-cancel-estimate" });
    await owner.mutation(api.splitCorrections.cancelEstimate, { businessId, splitCorrectionId, reason: "Found the correct receipt" });
    const stored = await t.run(async ctx => ({ source: await ctx.db.get("entries", entryId), split: await ctx.db.get("entrySplitCorrections", splitCorrectionId), day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique() }));
    expect(stored.source).toMatchObject({ state: "posted", amountUgx: 5_000 });
    expect(stored.source?.splitCorrectionId).toBeUndefined();
    expect(stored.split?.provenance).toBe("cancelled");
    expect(stored.day).toMatchObject({ salesUgx: 5_000, saleCount: 1 });
  });

  it("reverses a confirmed split import once as a group and restores original totals", async () => {
    const { t, owner, businessId, today } = await setup();
    const sourceHash = "c".repeat(64);
    const batch = await owner.mutation(api.imports.beginBatch, { businessId, sourceHash, fileName: "split.csv", importType: "cashbook", currency: "UGX", totalRows: 1 });
    await owner.mutation(api.imports.importRows, { businessId, batchId: batch.batchId, startRow: 0, rows: [{ rowNumber: 1, kind: "expense", amountUgx: 4_000, occurredOn: today, account: "cash", category: "General", note: "Mixed supplies" }] });
    await owner.mutation(api.imports.completeBatch, { businessId, batchId: batch.batchId });
    const original = await t.run(ctx => ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId).eq("idempotencyKey", `csv:${sourceHash}:1`)).unique());
    expect(original).not.toBeNull();
    const splitCorrectionId = await owner.mutation(api.splitCorrections.saveEstimate, { businessId, entryId: original!._id, allocations: [{ amountUgx: 1_500, category: "Stationery", account: "cash" }, { amountUgx: 2_500, category: "Cleaning", account: "cash" }], reason: "Receipt lists two categories", idempotencyKey: "lifecycle-import-split-estimate" });
    await owner.mutation(api.splitCorrections.confirmEstimate, { businessId, splitCorrectionId });
    await owner.mutation(api.imports.startBatchReversal, { businessId, batchId: batch.batchId, reason: "Wrong imported allocation" });
    const first = await owner.mutation(api.imports.reverseBatchChunk, { businessId, batchId: batch.batchId, cursor: null });
    const retry = await owner.mutation(api.imports.reverseBatchChunk, { businessId, batchId: batch.batchId, cursor: null });
    const stored = await t.run(async ctx => ({ batch: await ctx.db.get("importBatches", batch.batchId), split: await ctx.db.get("entrySplitCorrections", splitCorrectionId), original: await ctx.db.get("entries", original!._id), replacements: await Promise.all((await ctx.db.get("entrySplitCorrections", splitCorrectionId))!.replacementEntryIds!.map(id => ctx.db.get("entries", id))), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(), day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique() }));
    expect(first).toMatchObject({ status: "reversed", rollbackProgressRows: 1 });
    expect(retry).toMatchObject({ status: "reversed", rollbackProgressRows: 1 });
    expect(stored.batch?.status).toBe("reversed");
    expect(stored.split?.provenance).toBe("reversed");
    expect(stored.original).toMatchObject({ state: "void", splitCorrectionId });
    expect(stored.replacements.every(row => row?.state === "void")).toBe(true);
    expect(stored.cash?.balanceUgx).toBe(100_000);
    expect(stored.day).toMatchObject({ expensesUgx: 0, expenseCount: 0 });
    const report = await owner.query(api.imports.cashbookReport, { businessId, batchId: batch.batchId });
    expect(report).toContain('"reversed"');
  });

  it("rejects unauthenticated and cross-workspace split estimates", async () => {
    const { t, owner, businessId, today } = await setup();
    const sourceEntryId = await owner.mutation(api.workspace.createEntry, { businessId, kind: "expense", amountUgx: 2_000, occurredOn: today, account: "cash", category: "General", note: "Shared receipt", idempotencyKey: "lifecycle-split-access-source" });
    const other = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Other owner" });
      const businessId = await ctx.db.insert("businesses", { name: "Other workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: userId, createdAt: Date.now() });
      await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt: Date.now() });
      return { userId, businessId };
    });
    const args = { businessId, entryId: sourceEntryId, allocations: [{ amountUgx: 1_000, category: "A", account: "cash" as const }, { amountUgx: 1_000, category: "B", account: "cash" as const }], reason: "Separate receipt lines", idempotencyKey: "lifecycle-split-access-key" };
    await expect(t.mutation(api.splitCorrections.saveEstimate, args)).rejects.toThrow();
    await expect(t.withIdentity({ subject: other.userId }).mutation(api.splitCorrections.saveEstimate, args)).rejects.toThrow();
    await expect(owner.mutation(api.splitCorrections.saveEstimate, { ...args, businessId: other.businessId })).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("entrySplitCorrections").collect())).toHaveLength(0);
  });

  it("reverses a completed import through its bounded chunk and restores balances and totals", async () => {
    const { t, owner, businessId, today } = await setup();
    await owner.mutation(api.workspace.createEntry, { businessId, kind: "expense", amountUgx: 500, occurredOn: today, account: "cash", category: "Unrelated", note: "Packaging", idempotencyKey: "lifecycle-import-unrelated-001" });
    const sourceHash = "a".repeat(64);
    const batch = await owner.mutation(api.imports.beginBatch, { businessId, sourceHash, fileName: "cashbook.csv", importType: "cashbook", currency: "UGX", totalRows: 1 });
    await owner.mutation(api.imports.importRows, { businessId, batchId: batch.batchId, startRow: 0, rows: [{ rowNumber: 1, kind: "expense", amountUgx: 2_500, occurredOn: today, account: "cash", category: "Supplies", note: "Imported paper" }] });
    await owner.mutation(api.imports.completeBatch, { businessId, batchId: batch.batchId });
    await owner.mutation(api.imports.startBatchReversal, { businessId, batchId: batch.batchId, reason: "Duplicate source file" });
    const result = await owner.mutation(api.imports.reverseBatchChunk, { businessId, batchId: batch.batchId, cursor: null });
    const stored = await t.run(async ctx => ({ batch: await ctx.db.get("importBatches", batch.batchId), entry: await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId).eq("idempotencyKey", `csv:${sourceHash}:1`)).unique(), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(), day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique() }));
    expect(result).toMatchObject({ status: "reversed", rollbackProgressRows: 1, processedRows: 1 });
    expect(stored.batch?.status).toBe("reversed");
    expect(stored.entry).toMatchObject({ state: "void", source: "import" });
    expect(stored.cash?.balanceUgx).toBe(99_500);
    expect(stored.day).toMatchObject({ expensesUgx: 500, expenseCount: 1 });
  });

  it("reverses a corrected import when its original period is closed but the replacement period is open", async () => {
    const { t, owner, userId, businessId, today } = await setup();
    const currentMonth = `${today.slice(0, 7)}-01`;
    const previous = new Date(`${currentMonth}T00:00:00.000Z`);
    previous.setUTCMonth(previous.getUTCMonth() - 1);
    const previousMonthStart = previous.toISOString().slice(0, 10);
    const originalDay = `${previousMonthStart.slice(0, 8)}10`;
    const sourceHash = "b".repeat(64);
    const now = Date.now();
    const { batchId, originalId, replacementId } = await t.run(async ctx => {
      const batchId = await ctx.db.insert("importBatches", { businessId, fileName: "corrected.csv", importType: "cashbook", sourceHash, currency: "UGX", totalRows: 1, importedCount: 1, skippedCount: 0, progressRows: 1, status: "completed", createdBy: userId, createdAt: now });
      const originalId = await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 100, occurredOn: originalDay, account: "cash", category: "Supplies", note: "Old date", source: "import", idempotencyKey: `csv:${sourceHash}:1`, state: "void", createdBy: userId, createdAt: now, voidedAt: now, voidedBy: userId, voidReason: "Corrected date" });
      const replacementId = await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 100, occurredOn: today, account: "cash", category: "Supplies", note: "Corrected date", source: "import", idempotencyKey: "corrected-import-replacement-001", state: "posted", correctionOf: originalId, createdBy: userId, createdAt: now });
      await ctx.db.patch("entries", originalId, { correctedBy: replacementId });
      await ctx.db.insert("monthEndClosures", { businessId, periodFrom: previousMonthStart, periodToExclusive: currentMonth, status: "closed", snapshotJson: "{}", preparedBy: userId, preparedAt: now, reviewedBy: userId, reviewedAt: now, updatedAt: now });
      await ctx.db.insert("dailyTotals", { businessId, day: today, salesUgx: 0, expensesUgx: 100, saleCount: 0, expenseCount: 1 });
      await ctx.db.patch("accountBalances", (await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique())!._id, { balanceUgx: 99_900 });
      return { batchId, originalId, replacementId };
    });
    await owner.mutation(api.imports.startBatchReversal, { businessId, batchId, reason: "Reverse corrected source" });
    const result = await owner.mutation(api.imports.reverseBatchChunk, { businessId, batchId, cursor: null });
    const stored = await t.run(async ctx => ({ replacement: await ctx.db.get("entries", replacementId), batch: await ctx.db.get("importBatches", batchId), original: await ctx.db.get("entries", originalId) }));
    expect(result).toMatchObject({ status: "reversed", rollbackProgressRows: 1, processedRows: 1 });
    expect(stored.original).toMatchObject({ state: "void", correctedBy: replacementId });
    expect(stored.replacement).toMatchObject({ state: "void", correctionOf: originalId });
    expect(stored.batch?.status).toBe("reversed");
  });

  it("rejects a correction without a reason before changing the ledger", async () => {
    const { t, owner, businessId, today } = await setup();
    const entryId = await owner.mutation(api.workspace.createEntry, { businessId, kind: "expense", amountUgx: 4_000, occurredOn: today, account: "cash", category: "Supplies", note: "Paper", idempotencyKey: "lifecycle-rejected-entry-001" });
    await expect(owner.mutation(api.workspace.correctEntry, { businessId, entryId, amountUgx: 3_000, occurredOn: today, account: "cash", category: "Supplies", note: "Updated", reason: "no", idempotencyKey: "lifecycle-rejected-correction-001" })).rejects.toThrow("correction reason of 5 to 300 characters");
    const stored = await t.run(async ctx => ({ entry: await ctx.db.get("entries", entryId), cash: await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId).eq("account", "cash")).unique(), day: await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId).eq("day", today)).unique() }));
    expect(stored.entry).toMatchObject({ state: "posted", amountUgx: 4_000 });
    expect(stored.cash?.balanceUgx).toBe(96_000);
    expect(stored.day).toMatchObject({ expensesUgx: 4_000, expenseCount: 1 });
  });
});
