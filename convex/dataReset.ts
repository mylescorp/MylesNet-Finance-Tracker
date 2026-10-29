import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";

const PHASES = [
  "importReportDetails", "partnerPayouts", "partnerDistributionItems", "partnerDistributions",
  "partnerOwnershipHistory", "entries", "operationalRecords", "accountBalances",
  "balanceAdjustments", "dailyTotals", "movements", "savingsFlows", "savingsHoldings",
  "loanRepayments", "loans", "billPayments", "bills", "reconciliations", "issueReviews", "webhookReceipts", "importBatches",
] as const;
type Phase = typeof PHASES[number];

async function owner(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in as the workspace owner to reset data.");
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(1001);
  const active = memberships.filter(row => row.active);
  const selection = await ctx.db.query("workspaceSelections").withIndex("by_user", q => q.eq("userId", userId)).unique();
  const membership = selection ? active.find(row => row.businessId === selection.businessId) : active.length === 1 ? active[0] : undefined;
  const business = membership ? await ctx.db.get("businesses", membership.businessId) : null;
  if (!membership || !business || membership.role !== "owner" || membership.roleId) throw new ConvexError("Only the workspace owner can reset data.");
  return { userId, membership, business };
}

export const status = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { access: "restricted" as const };
    const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(1001);
    const active = memberships.filter(row => row.active);
    const selection = await ctx.db.query("workspaceSelections").withIndex("by_user", q => q.eq("userId", userId)).unique();
    const membership = selection ? active.find(row => row.businessId === selection.businessId) : active.length === 1 ? active[0] : undefined;
    const business = membership ? await ctx.db.get("businesses", membership.businessId) : null;
    if (!membership || !business || membership.role !== "owner" || membership.roleId) return { access: "restricted" as const };
    const latest = await ctx.db.query("workspaceDataResets").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").first();
    return { access: "ready" as const, businessName: business.name, resetting: business.dataResetting === true,
      latest: latest ? { resetId: latest._id, status: latest.status, phase: latest.phase, deletedRecords: latest.deletedRecords, startedAt: latest.startedAt, completedAt: latest.completedAt } : null };
  },
});

export const start = mutation({
  args: { confirmation: v.string() },
  returns: v.id("workspaceDataResets"),
  handler: async (ctx, args) => {
    const { userId, business } = await owner(ctx);
    if (business.dataResetting) throw new ConvexError("A workspace reset is already in progress.");
    if (args.confirmation.trim() !== business.name) throw new ConvexError("Enter the workspace name exactly to confirm the reset.");
    const now = Date.now();
    const resetId = await ctx.db.insert("workspaceDataResets", { businessId: business._id, status: "running", phase: 0, deletedRecords: 0, startedBy: userId, startedAt: now });
    await ctx.db.patch("businesses", business._id, { dataResetting: true });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "workspace.data_reset_started", entityType: "workspace", entityId: String(business._id), occurredAt: now, summary: "Owner started a workspace finance data reset. Memberships, workspace preferences, roles, partner profiles, and integration settings are preserved." });
    await ctx.scheduler.runAfter(0, internal.dataReset.runBatch, { resetId });
    return resetId;
  },
});

export const resume = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const { userId, business } = await owner(ctx);
    if (!business.dataResetting) throw new ConvexError("There is no paused workspace reset to resume.");
    const reset = await ctx.db.query("workspaceDataResets").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").first();
    if (!reset || reset.status !== "running") throw new ConvexError("The workspace reset has no resumable progress record.");
    await ctx.scheduler.runAfter(0, internal.dataReset.runBatch, { resetId: reset._id });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "workspace.data_reset_resumed", entityType: "workspace", entityId: String(business._id), occurredAt: Date.now(), summary: `Owner resumed workspace data reset at phase ${reset.phase + 1}.` });
    return null;
  },
});

async function pageFor(ctx: MutationCtx, phase: Phase, businessId: Id<"businesses">, cursor: string | null) {
  const opts = { numItems: 20, cursor };
  switch (phase) {
    case "partnerPayouts": return ctx.db.query("partnerPayouts").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId)).paginate(opts);
    case "partnerDistributionItems": return ctx.db.query("partnerDistributionItems").withIndex("by_business_and_distribution", q => q.eq("businessId", businessId)).paginate(opts);
    case "partnerDistributions": return ctx.db.query("partnerDistributions").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId)).paginate(opts);
    case "partnerOwnershipHistory": return ctx.db.query("partnerOwnershipHistory").withIndex("by_business_and_effectiveOn", q => q.eq("businessId", businessId)).paginate(opts);
    case "entries": return ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).paginate(opts);
    case "operationalRecords": return ctx.db.query("operationalRecords").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", businessId)).paginate(opts);
    case "accountBalances": return ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId)).paginate(opts);
    case "balanceAdjustments": return ctx.db.query("balanceAdjustments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).paginate(opts);
    case "dailyTotals": return ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", businessId)).paginate(opts);
    case "movements": return ctx.db.query("movements").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).paginate(opts);
    case "savingsFlows": return ctx.db.query("savingsFlows").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).paginate(opts);
    case "savingsHoldings": return ctx.db.query("savingsHoldings").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId)).paginate(opts);
    case "loanRepayments": return ctx.db.query("loanRepayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).paginate(opts);
    case "loans": return ctx.db.query("loans").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId)).paginate(opts);
    case "billPayments": return ctx.db.query("billPayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).paginate(opts);
    case "bills": return ctx.db.query("bills").withIndex("by_business_and_idempotency", q => q.eq("businessId", businessId)).paginate(opts);
    case "reconciliations": return ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).paginate(opts);
    case "issueReviews": return ctx.db.query("issueReviews").withIndex("by_business_and_updated", q => q.eq("businessId", businessId)).paginate(opts);
    case "importBatches": return ctx.db.query("importBatches").withIndex("by_business_and_created", q => q.eq("businessId", businessId)).paginate(opts);
    case "importReportDetails": return ctx.db.query("importBatches").withIndex("by_business_and_created", q => q.eq("businessId", businessId)).paginate(opts);
    default: throw new Error(`Unsupported reset phase: ${phase}`);
  }
}

export const runBatch = internalMutation({
  args: { resetId: v.id("workspaceDataResets") },
  handler: async (ctx, { resetId }) => {
    const job = await ctx.db.get("workspaceDataResets", resetId);
    if (!job || job.status !== "running") return null;
    const phase = PHASES[job.phase];
    const business = await ctx.db.get("businesses", job.businessId);
    if (!business || business.dataResetting !== true) return null;
    let deletedNow = 0;
    if (phase === "importReportDetails") {
      const page = await ctx.db.query("importBatches").withIndex("by_business_and_created", q => q.eq("businessId", job.businessId)).paginate({ numItems: 20, cursor: job.cursor ?? null });
      for (const batch of page.page) {
        const report = await ctx.db.query("importReportDetails").withIndex("by_batch", q => q.eq("batchId", batch._id)).unique();
        if (report?.businessId === job.businessId) { await ctx.db.delete(report._id); deletedNow++; }
      }
      const deletedRecords = job.deletedRecords + deletedNow;
      if (!page.isDone) {
        await ctx.db.patch("workspaceDataResets", resetId, { cursor: page.continueCursor, deletedRecords });
        await ctx.scheduler.runAfter(0, internal.dataReset.runBatch, { resetId });
        return null;
      }
      const nextPhase = job.phase + 1;
      await ctx.db.patch("workspaceDataResets", resetId, { phase: nextPhase, cursor: undefined, deletedRecords });
      await ctx.scheduler.runAfter(0, internal.dataReset.runBatch, { resetId });
      return null;
    }
    if (phase === "webhookReceipts") {
      const page = await ctx.db.query("webhookReceipts").withIndex("by_business_and_created", q => q.eq("businessId", job.businessId)).paginate({ numItems: 20, cursor: job.cursor ?? null });
      for (const receipt of page.page) {
        await ctx.db.patch("webhookReceipts", receipt._id, {
          status: receipt.status === "failed" ? "ignored" : receipt.status,
          errorMessage: receipt.status === "failed" ? "Retry suppressed during workspace data reset." : undefined,
          entryId: undefined,
        });
      }
      if (!page.isDone) await ctx.db.patch("workspaceDataResets", resetId, { cursor: page.continueCursor });
      else await ctx.db.patch("workspaceDataResets", resetId, { phase: job.phase + 1, cursor: undefined });
      await ctx.scheduler.runAfter(0, internal.dataReset.runBatch, { resetId });
      return null;
    }
    if (!phase) throw new Error("Workspace reset phase is invalid.");
    const page = await pageFor(ctx, phase, job.businessId, job.cursor ?? null);
    for (const row of page.page) await ctx.db.delete(row._id);
    deletedNow = page.page.length;
    const deletedRecords = job.deletedRecords + deletedNow;
    if (!page.isDone) {
      await ctx.db.patch("workspaceDataResets", resetId, { cursor: page.continueCursor, deletedRecords });
      await ctx.scheduler.runAfter(0, internal.dataReset.runBatch, { resetId });
      return null;
    }
    const nextPhase = job.phase + 1;
    if (nextPhase < PHASES.length) {
      await ctx.db.patch("workspaceDataResets", resetId, { phase: nextPhase, cursor: undefined, deletedRecords });
      await ctx.scheduler.runAfter(0, internal.dataReset.runBatch, { resetId });
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("workspaceDataResets", resetId, { status: "completed", phase: PHASES.length, cursor: undefined, deletedRecords, completedAt: now });
    await ctx.db.patch("businesses", job.businessId, { dataResetting: false });
    await ctx.db.insert("auditEvents", { businessId: job.businessId, actorId: job.startedBy, action: "workspace.data_reset_completed", entityType: "workspace", entityId: String(job.businessId), occurredAt: now, summary: `Workspace finance data reset completed. ${deletedRecords} stored records were removed.` });
    return null;
  },
});
