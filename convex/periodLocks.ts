import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/** Reject writes that would change a date covered by an approved month close. */
export async function isPeriodClosed(ctx: MutationCtx, businessId: Id<"businesses">, day: string) {
  const periodFrom = `${day.slice(0, 7)}-01`;
  const closure = await ctx.db.query("monthEndClosures")
    .withIndex("by_business_and_period", q => q.eq("businessId", businessId).eq("periodFrom", periodFrom))
    .unique();
  return closure?.status === "closed";
}

export async function assertPeriodUnlocked(ctx: MutationCtx, businessId: Id<"businesses">, day: string) {
  const periodFrom = `${day.slice(0, 7)}-01`;
  if (await isPeriodClosed(ctx, businessId, day)) {
    throw new ConvexError(`This period is closed. Reopen ${periodFrom.slice(0, 7)} with a reason before changing its financial records.`);
  }
}
