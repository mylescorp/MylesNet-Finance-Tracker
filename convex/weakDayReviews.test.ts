/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const ownerId = await ctx.db.insert("users", { name: "Diary owner" });
    const memberId = await ctx.db.insert("users", { name: "Diary member" });
    const businessId = await ctx.db.insert("businesses", { name: "Diary workspace", currency: "UGX", timezone: "Africa/Kampala", createdBy: ownerId, createdAt: Date.now() });
    await ctx.db.insert("memberships", { businessId, userId: ownerId, role: "owner", active: true, createdAt: Date.now() });
    await ctx.db.insert("memberships", { businessId, userId: memberId, role: "member", active: true, createdAt: Date.now() });
    await ctx.db.insert("workspacePreferences", { businessId, weakDaySalesUgx: 100_000, updatedBy: ownerId, updatedAt: Date.now() });
    await ctx.db.insert("entries", { businessId, kind: "sale", amountUgx: 50_000, occurredOn: "2026-10-15", account: "cash", category: "Sales", note: "Recorded sale", source: "manual", idempotencyKey: "weak-day-sale-entry-key-1", state: "posted", createdBy: ownerId, createdAt: Date.now() });
    return { ownerId, memberId, businessId };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: ids.ownerId }), member: t.withIdentity({ subject: ids.memberId }) };
}

describe("weak-day diary", () => {
  it("stores an audited explanation and preserves the sale entry", async () => {
    const { t, owner, businessId, ownerId } = await setup();
    await owner.mutation(api.weakDayReviews.save, { businessId, day: "2026-10-15", explanation: "Local market was closed early.", expectedUpdatedAt: null });
    const diary = await owner.query(api.weakDayReviews.list, { businessId, from: "2026-10-01", toExclusive: "2026-11-01" });
    expect(diary).toMatchObject({ access: "ready", complete: true, canReview: true, reviews: [{ day: "2026-10-15", explanation: "Local market was closed early.", salesUgxAtReview: 50_000, thresholdUgxAtReview: 100_000, author: "Diary owner" }] });
    const beforeUpdate = diary.access === "ready" ? diary.reviews[0] : null;
    if (!beforeUpdate) throw new Error("Expected saved weak-day review.");
    await owner.mutation(api.weakDayReviews.save, { businessId, day: "2026-10-15", explanation: "Rain reduced afternoon foot traffic.", expectedUpdatedAt: beforeUpdate.updatedAt });
    expect((await t.run(ctx => ctx.db.query("entries").collect()))[0].amountUgx).toBe(50_000);
    const events = await t.run(ctx => ctx.db.query("auditEvents").collect());
    expect(events).toHaveLength(2);
    expect(events.map(row => row.action)).toEqual(["sales.weak_day_reviewed", "sales.weak_day_reviewed"]);
    expect(events.every(row => row.actorId === ownerId)).toBe(true);
  });

  it("requires report-review permission and a day that still meets the saved threshold", async () => {
    const { owner, member, businessId } = await setup();
    await expect(member.mutation(api.weakDayReviews.save, { businessId, day: "2026-10-15", explanation: "Local market closed early.", expectedUpdatedAt: null })).rejects.toThrow("cannot update weak-day reviews");
    await expect(owner.mutation(api.weakDayReviews.save, { businessId, day: "2026-10-15", explanation: "No", expectedUpdatedAt: null })).rejects.toThrow("between 5 and 500 characters");
    await expect(owner.mutation(api.weakDayReviews.save, { businessId, day: "2026-10-01", explanation: "No sales were recorded.", expectedUpdatedAt: null })).rejects.toThrow("does not currently meet");
  });
});
