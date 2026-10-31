/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function previousMonth() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" }).format(Date.now());
  const date = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  const from = date.toISOString().slice(0, 10);
  const toExclusive = new Date(`${today.slice(0, 7)}-01T00:00:00.000Z`).toISOString().slice(0, 10);
  const last = new Date(`${toExclusive}T00:00:00.000Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  return { periodFrom: from, periodToExclusive: toExclusive, lastDay: last.toISOString().slice(0, 10) };
}

async function setup({ complete = true }: { complete?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const period = previousMonth();
  const users = await t.run(async ctx => {
    const preparerId = await ctx.db.insert("users", { name: "Close preparer" });
    const reviewerId = await ctx.db.insert("users", { name: "Close reviewer" });
    const memberId = await ctx.db.insert("users", { name: "Read-only member" });
    const createdAt = Date.now();
    const businessId = await ctx.db.insert("businesses", { name: "Month close workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: preparerId, createdAt });
    await ctx.db.insert("memberships", { businessId, userId: preparerId, role: "owner", active: true, createdAt });
    await ctx.db.insert("memberships", { businessId, userId: reviewerId, role: "owner", active: true, createdAt });
    await ctx.db.insert("memberships", { businessId, userId: memberId, role: "member", active: true, createdAt });
    await ctx.db.insert("accountBalances", { businessId, account: "cash", balanceUgx: 100_000, openingBalanceUgx: 0, updatedAt: createdAt });
    await ctx.db.insert("accountBalances", { businessId, account: "mobile_money", balanceUgx: 50_000, openingBalanceUgx: 0, updatedAt: createdAt });
    await ctx.db.insert("entries", { businessId, kind: "sale", amountUgx: 500_000, occurredOn: `${period.periodFrom.slice(0, 8)}15`, account: "cash", category: "Shop sales", note: "Monthly sales", source: "manual", idempotencyKey: "close-test-sale-idempotency", state: "posted", createdBy: preparerId, createdAt });
    await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 120_000, occurredOn: `${period.periodFrom.slice(0, 8)}18`, account: "mobile_money", category: "Utilities", note: "Monthly power", source: "manual", idempotencyKey: "close-test-expense-idempotency", state: "posted", createdBy: preparerId, createdAt });
    await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 40_000, occurredOn: `${period.periodFrom.slice(0, 8)}20`, account: "cash", category: "Repairs", note: "Voided duplicate", source: "manual", idempotencyKey: "close-test-void-expense-idempotency", state: "void", createdBy: preparerId, createdAt, voidedAt: createdAt, voidedBy: preparerId, voidReason: "Duplicate entry." });
    await ctx.db.insert("categoryBudgets", { businessId, category: "Utilities", monthlyBudgetUgx: 200_000, warningAtPercent: 80, active: true, createdBy: preparerId, createdAt, updatedBy: preparerId, updatedAt: createdAt });
    if (complete) for (const account of ["cash", "mobile_money"] as const) {
      const bookBalanceUgx = account === "cash" ? 100_000 : 50_000;
      await ctx.db.insert("reconciliations", { businessId, account, asOfDate: period.lastDay, bookBalanceUgx, countedBalanceUgx: bookBalanceUgx, varianceUgx: 0, status: "closed", reviewedBy: reviewerId, reviewedByName: "Close reviewer", reviewedAt: createdAt, reviewNote: "Final account count approved.", note: "Final-day count", idempotencyKey: `close-count-${account}-idempotency`, createdBy: preparerId, createdAt });
    }
    return { businessId, preparerId, reviewerId, memberId };
  });
  const preparer = t.withIdentity({ subject: users.preparerId });
  if (complete) {
    for (let date = new Date(`${period.periodFrom}T00:00:00.000Z`); date.toISOString().slice(0, 10) < period.periodToExclusive; date.setUTCDate(date.getUTCDate() + 1)) {
      const day = date.toISOString().slice(0, 10);
      const hasActivity = day.endsWith("15") || day.endsWith("18");
      await preparer.mutation(api.monthEndClose.reviewSourceDay, { businessId: users.businessId, day, status: hasActivity ? "source_reviewed" : "confirmed_no_activity", note: hasActivity ? "Checked the day's source records." : "Confirmed the business had no posted activity.", expectedUpdatedAt: null });
    }
  }
  return { t, period, ...users, preparer, reviewer: t.withIdentity({ subject: users.reviewerId }), member: t.withIdentity({ subject: users.memberId }) };
}

describe("month-end close controls", () => {
  it("requires the full checklist, snapshots cashbook and budget totals, and requires a separate reviewer", async () => {
    const { t, period, businessId, preparer, reviewer, member } = await setup();
    const overview = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    expect(overview).toMatchObject({ access: "ready", snapshot: { ready: true, complete: true, totals: { salesUgx: 500_000, expensesUgx: 120_000, cashbookNetUgx: 380_000 }, postedEntryCount: 2, excludedVoidEntryCount: 1, movementsByAccount: [{ account: "cash", salesUgx: 500_000, expensesUgx: 0, netUgx: 500_000 }, { account: "mobile_money", salesUgx: 0, expensesUgx: 120_000, netUgx: -120_000 }], reconciliationEvidence: expect.arrayContaining([expect.objectContaining({ account: "cash", asOfDate: period.lastDay, bookBalanceUgx: 100_000, countedBalanceUgx: 100_000, varianceUgx: 0, status: "closed", reviewedByName: "Close reviewer", reviewNote: "Final account count approved." })]) } });
    if (overview.access !== "ready") throw new Error("Expected close access.");
    expect(overview.snapshot.categoryBudgets).toEqual([{ category: "Utilities", limitUgx: 200_000, warningAtPercent: 80, actualUgx: 120_000 }]);
    expect(await member.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive })).toEqual({ access: "restricted" });

    const closureId = await preparer.mutation(api.monthEndClose.prepare, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    const prepared = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    if (prepared.access !== "ready" || !prepared.closure) throw new Error("Expected prepared close.");
    expect(prepared.closure.status).toBe("awaiting_review");
    await expect(preparer.mutation(api.monthEndClose.approve, { businessId, closureId, expectedSnapshotJson: prepared.closure.snapshotJson })).rejects.toThrow("different workspace reviewer");
    await reviewer.mutation(api.monthEndClose.approve, { businessId, closureId, expectedSnapshotJson: prepared.closure.snapshotJson });
    const closed = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    if (closed.access !== "ready" || !closed.closure) throw new Error("Expected approved close.");
    expect(closed.closure.status).toBe("closed");
    expect(JSON.parse(closed.closure.snapshotJson)).toMatchObject({ totals: { salesUgx: 500_000, expensesUgx: 120_000, cashbookNetUgx: 380_000 }, excludedVoidEntryCount: 1, reconciliationEvidence: expect.arrayContaining([expect.objectContaining({ account: "mobile_money", asOfDate: period.lastDay, status: "closed", reviewedByName: "Close reviewer", reviewNote: "Final account count approved." })]) });

    await reviewer.mutation(api.monthEndClose.reopen, { businessId, closureId, reason: "Correct the month-end source records." });
    const reopened = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    if (reopened.access !== "ready" || !reopened.closure) throw new Error("Expected reopened close.");
    expect(reopened.closure).toMatchObject({ status: "reopened", reopenReason: "Correct the month-end source records." });
    expect(reopened.events.map(event => event.action)).toEqual(["reopened", "approved", "prepared"]);
    const audit = await t.run(ctx => ctx.db.query("auditEvents").collect());
    expect(audit.map(event => event.action)).toContain("month_end_close.prepared");
    expect(audit.map(event => event.action)).toContain("month_end_close.approved");
    expect(audit.map(event => event.action)).toContain("month_end_close.reopened");
  });

  it("blocks preparation when final-day account sign-off is missing", async () => {
    const { preparer, businessId, period } = await setup({ complete: false });
    const overview = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    expect(overview.access).toBe("ready");
    if (overview.access !== "ready") throw new Error("Expected close access.");
    expect(overview.snapshot.ready).toBe(false);
    expect(overview.snapshot.checklist.find(item => item.key === "cash-count")?.ready).toBe(false);
    await expect(preparer.mutation(api.monthEndClose.prepare, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive })).rejects.toThrow("Final-day cash count is signed off");
  });

  it("requires a truthful day-by-day source coverage note", async () => {
    const { preparer, businessId, period } = await setup({ complete: false });
    const activeDay = `${period.periodFrom.slice(0, 8)}15`;
    await expect(preparer.mutation(api.monthEndClose.reviewSourceDay, {
      businessId, day: activeDay, status: "confirmed_no_activity", note: "No activity", expectedUpdatedAt: null,
    })).rejects.toThrow("Posted cashbook entries exist");
    await preparer.mutation(api.monthEndClose.reviewSourceDay, {
      businessId, day: activeDay, status: "source_reviewed", note: "Checked the source receipts.", expectedUpdatedAt: null,
    });
    const overview = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    if (overview.access !== "ready") throw new Error("Expected close access.");
    expect(overview.snapshot.activityDays).toContainEqual({ day: activeDay, status: "source_reviewed", note: "Checked the source receipts." });
  });

  it("does not let a monthly-report viewer attest source coverage", async () => {
    const { t, businessId, period } = await setup({ complete: false });
    const viewerId = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { name: "Report viewer" });
      const roleId = await ctx.db.insert("workspaceRoles", { businessId, name: "Report viewer", description: "View monthly reports", permissions: ["monthlyPnl.view"], active: true, createdBy: userId, createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.insert("memberships", { businessId, userId, role: "member", roleId, active: true, createdAt: Date.now() });
      return userId;
    });
    await expect(t.withIdentity({ subject: viewerId }).mutation(api.monthEndClose.reviewSourceDay, { businessId, day: `${period.periodFrom.slice(0, 8)}01`, status: "confirmed_no_activity", note: "Reviewed source coverage.", expectedUpdatedAt: null })).rejects.toThrow("cannot review month-end source coverage");
  });

  it("keeps completed imports and resolved historical issue reviews out of current close limits", async () => {
    const { t, preparer, businessId, period, preparerId } = await setup();
    await t.run(async ctx => {
      const now = Date.now();
      for (let index = 0; index < 501; index += 1) await ctx.db.insert("importBatches", { businessId, fileName: `closed-${index}.csv`, importType: "cashbook", sourceHash: `hash-${index}`, totalRows: 0, importedCount: 0, skippedCount: 0, progressRows: 0, status: "completed", createdBy: preparerId, createdAt: now });
      for (let index = 0; index < 1001; index += 1) await ctx.db.insert("issueReviews", { businessId, issueKey: `${period.periodFrom}:2026-12-01:old-${index}:0`, issueId: `old-${index}`, status: "resolved", updatedBy: preparerId, updatedAt: now, createdAt: now });
    });
    const overview = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    expect(overview.access === "ready" && overview.snapshot.checklist.every(item => item.ready)).toBe(true);
  });

  it("rejects approval when source data changes after preparation", async () => {
    const { t, preparerId, reviewerId, preparer, reviewer, businessId, period } = await setup();
    const closureId = await preparer.mutation(api.monthEndClose.prepare, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    const prepared = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    if (prepared.access !== "ready" || !prepared.closure) throw new Error("Expected prepared close.");
    await t.run(async ctx => {
      await ctx.db.insert("entries", { businessId, kind: "expense", amountUgx: 10_000, occurredOn: `${period.periodFrom.slice(0, 8)}15`, account: "cash", category: "Repairs", note: "Late correction", source: "manual", idempotencyKey: "close-late-entry-idempotency", state: "posted", createdBy: preparerId, createdAt: Date.now() });
      expect(await ctx.db.get("users", reviewerId)).toBeTruthy();
    });
    await expect(reviewer.mutation(api.monthEndClose.approve, { businessId, closureId, expectedSnapshotJson: prepared.closure.snapshotJson })).rejects.toThrow("Source records changed");
    const after = await preparer.query(api.monthEndClose.overview, { businessId, periodFrom: period.periodFrom, periodToExclusive: period.periodToExclusive });
    expect(after.access === "ready" ? after.closure?.status : null).toBe("awaiting_review");
    expect(after.access === "ready" && after.snapshot.unreviewedSourceDays.some(row => row.day === `${period.periodFrom.slice(0, 8)}15`)).toBe(true);
  });
});
