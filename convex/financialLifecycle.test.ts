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
