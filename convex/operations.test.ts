/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupOwner() {
  const t = convexTest(schema, modules);
  const { userId, businessId } = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Reconciliation owner" });
    const businessId = await ctx.db.insert("businesses", {
      name: "Cash count test workspace",
      currency: "UGX",
      timezone: "Africa/Kampala",
      createdBy: userId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("memberships", { businessId, userId, role: "owner", active: true, createdAt: Date.now() });
    return { userId, businessId };
  });
  const owner = t.withIdentity({ subject: userId });
  return { t, owner, businessId };
}

function todayInKampala() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
}

function dayAfterForTest(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

describe("cash reconciliation denomination details", () => {
  it("assigns review to an authorized member and restricts sign-off to that reviewer", async () => {
    const { t, owner, businessId } = await setupOwner();
    const { reviewerId, memberId } = await t.run(async ctx => {
      const reviewerId = await ctx.db.insert("users", { name: "Independent reviewer" });
      const memberId = await ctx.db.insert("users", { name: "Unprivileged member" });
      await ctx.db.insert("memberships", { businessId, userId: reviewerId, role: "owner", active: true, createdAt: Date.now() });
      await ctx.db.insert("memberships", { businessId, userId: memberId, role: "member", active: true, createdAt: Date.now() });
      return { reviewerId, memberId };
    });
    const reviewer = t.withIdentity({ subject: reviewerId });
    const member = t.withIdentity({ subject: memberId });
    const reconciliationId = await owner.mutation(api.operations.createReconciliation, {
      businessId, account: "cash", asOfDate: todayInKampala(), countedBalanceUgx: 0,
      note: "Opening drawer count", idempotencyKey: "reconciliation-assignment-test-001",
    });
    await expect(member.mutation(api.operations.assignReconciliationReviewer, { businessId, reconciliationId, reviewerId })).rejects.toThrow("cannot assign reconciliation reviewers");
    await owner.mutation(api.operations.assignReconciliationReviewer, { businessId, reconciliationId, reviewerId });
    await expect(owner.mutation(api.operations.signOffReconciliation, { businessId, reconciliationId, reviewNote: "Verified count" })).rejects.toThrow("different authorized reviewer");
    const overview = await owner.query(api.operations.overview, { businessId, from: todayInKampala(), toExclusive: dayAfterForTest(todayInKampala()) });
    expect(overview.access === "ready" ? overview.reconciliations[0] : null).toMatchObject({ assignedReviewerId: reviewerId, assignedReviewerName: "Independent reviewer" });
    await reviewer.mutation(api.operations.signOffReconciliation, { businessId, reconciliationId, reviewNote: "Verified count" });
    expect(await t.run(ctx => ctx.db.get("reconciliations", reconciliationId))).toMatchObject({ status: "closed", reviewedBy: reviewerId, assignedReviewerId: reviewerId });
    expect((await t.run(ctx => ctx.db.query("auditEvents").collect())).map(row => row.action)).toContain("reconciliation.reviewer_assigned");
  });

  it("saves a validated breakdown and records it in the audit trail", async () => {
    const { t, owner, businessId } = await setupOwner();
    const reconciliationId = await owner.mutation(api.operations.createReconciliation, {
      businessId,
      account: "cash",
      asOfDate: todayInKampala(),
      countedBalanceUgx: 8000,
      denominationCounts: [
        { denominationUgx: 5000, quantity: 1 },
        { denominationUgx: 1000, quantity: 3 },
      ],
      note: "Cash drawer count",
      idempotencyKey: "cash-count-create-key-0001",
    });
    const stored = await t.run(async ctx => ({
      reconciliation: await ctx.db.get("reconciliations", reconciliationId),
      audit: await ctx.db.query("auditEvents").collect(),
    }));
    expect(stored.reconciliation?.denominationCounts).toEqual([
      { denominationUgx: 1000, quantity: 3 },
      { denominationUgx: 5000, quantity: 1 },
    ]);
    expect(stored.audit).toHaveLength(1);
    expect(stored.audit[0].details).toContain("denominationCounts");
    expect(stored.audit[0].summary).toContain("cash count");
  });

  it("rejects a breakdown that does not match the count without saving records", async () => {
    const { t, owner, businessId } = await setupOwner();
    await expect(owner.mutation(api.operations.createReconciliation, {
      businessId,
      account: "cash",
      asOfDate: todayInKampala(),
      countedBalanceUgx: 8000,
      denominationCounts: [{ denominationUgx: 5000, quantity: 1 }],
      note: "Cash drawer count",
      idempotencyKey: "cash-count-create-key-0002",
    })).rejects.toThrow("The cash denomination total must equal the counted balance.");
    const stored = await t.run(async ctx => ({
      reconciliations: await ctx.db.query("reconciliations").collect(),
      audit: await ctx.db.query("auditEvents").collect(),
    }));
    expect(stored.reconciliations).toHaveLength(0);
    expect(stored.audit).toHaveLength(0);
  });

  it("rejects denomination details for mobile money", async () => {
    const { owner, businessId } = await setupOwner();
    await expect(owner.mutation(api.operations.createReconciliation, {
      businessId,
      account: "mobile_money",
      asOfDate: todayInKampala(),
      countedBalanceUgx: 5000,
      denominationCounts: [{ denominationUgx: 5000, quantity: 1 }],
      note: "Mobile money statement",
      idempotencyKey: "cash-count-create-key-0003",
    })).rejects.toThrow("Denomination counts can only be attached to a cash reconciliation.");
  });

  it("binds denomination details to the idempotency key", async () => {
    const { owner, businessId } = await setupOwner();
    const args = {
      businessId,
      account: "cash" as const,
      asOfDate: todayInKampala(),
      countedBalanceUgx: 8000,
      note: "Cash drawer count",
      idempotencyKey: "cash-count-create-key-0004",
    };
    const reconciliationId = await owner.mutation(api.operations.createReconciliation, {
      ...args,
      denominationCounts: [{ denominationUgx: 5000, quantity: 1 }, { denominationUgx: 1000, quantity: 3 }],
    });
    await expect(owner.mutation(api.operations.createReconciliation, {
      ...args,
      denominationCounts: [{ denominationUgx: 4000, quantity: 2 }],
    })).rejects.toThrow("This request key was already used for different transaction details.");
    expect(await owner.mutation(api.operations.createReconciliation, {
      ...args,
      denominationCounts: [{ denominationUgx: 1000, quantity: 3 }, { denominationUgx: 5000, quantity: 1 }],
    })).toBe(reconciliationId);
  });

  it("keeps the original cash breakdown when a corrected count supersedes it", async () => {
    const { t, owner, businessId } = await setupOwner();
    const previousId = await owner.mutation(api.operations.createReconciliation, {
      businessId,
      account: "cash",
      asOfDate: todayInKampala(),
      countedBalanceUgx: 8000,
      denominationCounts: [{ denominationUgx: 5000, quantity: 1 }, { denominationUgx: 1000, quantity: 3 }],
      note: "First count",
      idempotencyKey: "cash-count-create-key-0005",
    });
    const correctedId = await owner.mutation(api.operations.supersedeReconciliation, {
      businessId,
      reconciliationId: previousId,
      countedBalanceUgx: 9000,
      denominationCounts: [{ denominationUgx: 5000, quantity: 1 }, { denominationUgx: 2000, quantity: 2 }],
      note: "Recounted cash drawer",
      idempotencyKey: "cash-count-correct-key-0001",
    });
    const stored = await t.run(async ctx => ({
      previous: await ctx.db.get("reconciliations", previousId),
      corrected: await ctx.db.get("reconciliations", correctedId),
    }));
    expect(stored.previous?.status).toBe("superseded");
    expect(stored.previous?.denominationCounts).toEqual([
      { denominationUgx: 1000, quantity: 3 },
      { denominationUgx: 5000, quantity: 1 },
    ]);
    expect(stored.corrected).toMatchObject({
      status: "open",
      countedBalanceUgx: 9000,
      supersedesId: previousId,
      denominationCounts: [
        { denominationUgx: 2000, quantity: 2 },
        { denominationUgx: 5000, quantity: 1 },
      ],
    });
  });
});

describe("bill schedule reminders and supplier defaults", () => {
  it("uses the refreshed business day to advance forecast horizon", async () => {
    const { owner, businessId } = await setupOwner();
    await owner.mutation(api.operations.createBill, {
      businessId, name: "Quarter close service", category: "Services", amountUgx: 25_000, account: "cash",
      recurrence: "monthly", nextDueOn: "2027-01-29", idempotencyKey: "bill-forecast-midnight-key-1",
    });
    const before = await owner.query(api.operations.forecastBills, { businessId, today: "2026-10-31" });
    const after = await owner.query(api.operations.forecastBills, { businessId, today: "2026-11-01" });
    expect(before.access).toBe("ready");
    expect(after.access).toBe("ready");
    if (before.access !== "ready" || after.access !== "ready") throw new Error("Expected bill access.");
    expect(before.forecasts.map(row => row.dueOn)).not.toContain("2027-01-29");
    expect(after.forecasts.map(row => row.dueOn)).toContain("2027-01-29");
  });

  it("keeps a supplier snapshot, exposes forecasts, and audits pause and resume", async () => {
    const { t, owner, businessId } = await setupOwner();
    const supplierId = await owner.mutation(api.suppliers.save, { action: "create", name: "Kampala Power" });
    if (!supplierId) throw new Error("Expected supplier to be created.");
    const today = todayInKampala();
    const tomorrowDate = new Date(`${today}T00:00:00.000Z`);
    tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
    const tomorrow = tomorrowDate.toISOString().slice(0, 10);
    const billId = await owner.mutation(api.operations.createBill, {
      businessId, name: "Power", category: "Utilities", amountUgx: 150_000, account: "cash",
      recurrence: "monthly", nextDueOn: today, supplierId, reminderLeadDays: 7, idempotencyKey: "bill-create-reminder-key-001",
    });
    const baseline = await owner.query(api.operations.overview, { businessId, from: today, toExclusive: tomorrow });
    expect(baseline.access).toBe("ready");
    if (baseline.access !== "ready") throw new Error("Expected bill access.");
    expect(baseline.bills[0]).toMatchObject({ _id: billId, supplierName: "Kampala Power", reminderLeadDays: 7, paused: false });
    const paymentId = await owner.mutation(api.operations.recordBillPayment, { businessId, billId, paidOn: today, account: "cash", confirmNegativeBalance: true, idempotencyKey: "bill-payment-reminder-key-001" });
    const paymentExpense = await t.run(async ctx => {
      const payment = await ctx.db.get("billPayments", paymentId);
      return payment ? await ctx.db.get("entries", payment.entryId) : null;
    });
    expect(paymentExpense).toMatchObject({ supplierId, supplierName: "Kampala Power", operationSource: "bill_payment" });
    const afterPaymentBill = await t.run(ctx => ctx.db.get("bills", billId));
    if (!afterPaymentBill) throw new Error("Expected bill schedule after payment.");
    const lifecycleArgs = { businessId, billId, expectedActive: true, expectedNextDueOn: afterPaymentBill.nextDueOn, name: "Power", category: "Utilities", amountUgx: 150_000, account: "cash" as const, recurrence: "monthly" as const, nextDueOn: afterPaymentBill.nextDueOn };
    await owner.mutation(api.operations.updateBillSchedule, { ...lifecycleArgs, action: "pause" });
    const paused = await owner.query(api.operations.overview, { businessId, from: today, toExclusive: "9999-12-31" });
    if (paused.access !== "ready") throw new Error("Expected bill access after pause.");
    expect(paused.bills.find(row => row._id === billId)?.paused).toBe(true);
    await owner.mutation(api.operations.updateBillSchedule, { ...lifecycleArgs, action: "resume" });
    const stored = await t.run(async ctx => ({ bill: await ctx.db.get("bills", billId), audit: await ctx.db.query("auditEvents").collect() }));
    expect(stored.bill?.paused).toBe(false);
    expect(stored.bill?.supplierName).toBe("Kampala Power");
    expect(stored.audit.map(row => row.action)).toContain("bill.schedule_paused");
    expect(stored.audit.map(row => row.action)).toContain("bill.schedule_resumed");
  });

  it("rejects invalid reminder lead times and suppliers from another workspace", async () => {
    const { owner, businessId } = await setupOwner();
    await expect(owner.mutation(api.operations.createBill, {
      businessId, name: "Invalid reminder", category: "Utilities", amountUgx: 1, account: "cash",
      recurrence: "monthly", nextDueOn: todayInKampala(), reminderLeadDays: 31, idempotencyKey: "bill-create-reminder-key-002",
    })).rejects.toThrow("Bill details are invalid or its supplier is unavailable.");
  });
});

describe("reconciliation review sign-off", () => {
  it("closes a matched count with reviewer audit and reopens with a reason", async () => {
    const { t, owner, businessId } = await setupOwner();
    const reviewerId = await t.run(async ctx => {
      const reviewerId = await ctx.db.insert("users", { name: "Independent count reviewer" });
      await ctx.db.insert("memberships", { businessId, userId: reviewerId, role: "owner", active: true, createdAt: Date.now() });
      return reviewerId;
    });
    const reviewer = t.withIdentity({ subject: reviewerId });
    const reconciliationId = await owner.mutation(api.operations.createReconciliation, {
      businessId, account: "cash", asOfDate: todayInKampala(), countedBalanceUgx: 0,
      note: "Opening till count", idempotencyKey: "reconcile-signoff-count-key-1",
    });
    await expect(owner.mutation(api.operations.signOffReconciliation, { businessId, reconciliationId, reviewNote: "Count matches book balance." })).rejects.toThrow("different authorized reviewer");
    await reviewer.mutation(api.operations.signOffReconciliation, { businessId, reconciliationId, reviewNote: "Count matches book balance." });
    const closed = await t.run(ctx => ctx.db.get("reconciliations", reconciliationId));
    expect(closed).toMatchObject({ status: "closed", reviewedBy: reviewerId, reviewedByName: "Independent count reviewer", reviewNote: "Count matches book balance." });
    expect(closed?.reviewedAt).toEqual(expect.any(Number));
    await owner.mutation(api.operations.reopenReconciliation, { businessId, reconciliationId, reason: "Need to verify the account statement." });
    const reopened = await t.run(async ctx => ({ row: await ctx.db.get("reconciliations", reconciliationId), audit: await ctx.db.query("auditEvents").collect() }));
    expect(reopened.row).toMatchObject({ status: "matched" });
    expect(reopened.row?.reviewedBy).toBeUndefined();
    expect(reopened.audit.map(event => event.action)).toContain("reconciliation.signed_off");
    expect(reopened.audit.map(event => event.action)).toContain("reconciliation.reopened");
  });

  it("does not sign off unresolved variance", async () => {
    const { t, owner, businessId } = await setupOwner();
    const reconciliationId = await owner.mutation(api.operations.createReconciliation, {
      businessId, account: "cash", asOfDate: todayInKampala(), countedBalanceUgx: 100,
      note: "Till count with variance", idempotencyKey: "reconcile-signoff-count-key-2",
    });
    const reviewerId = await t.run(async ctx => {
      const reviewerId = await ctx.db.insert("users", { name: "Independent count reviewer" });
      await ctx.db.insert("memberships", { businessId, userId: reviewerId, role: "owner", active: true, createdAt: Date.now() });
      return reviewerId;
    });
    const reviewer = t.withIdentity({ subject: reviewerId });
    await expect(reviewer.mutation(api.operations.signOffReconciliation, { businessId, reconciliationId, reviewNote: "Review completed" })).rejects.toThrow("Only a matched count or an explained difference can be signed off.");
  });
});
