import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { hasPermission } from "./accessControl";

async function authorizedWorkspace(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(20);
  const active = memberships.filter(membership => membership.active);
  if (memberships.length === 20 || active.length !== 1) return null;
  const membership = active[0];
  const business = await ctx.db.get("businesses", membership.businessId);
  if (!business || !(await hasPermission(ctx, membership, "audit.view"))) return null;
  return { business, membership };
}

function parseDate(value: string | undefined, label: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error(`Choose a valid ${label} date.`);
  return timestamp;
}

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    from: v.optional(v.string()),
    toExclusive: v.optional(v.string()),
    action: v.optional(v.string()),
    actorId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const current = await authorizedWorkspace(ctx);
    if (!current) throw new Error("Audit history is not available for this account.");
    const from = parseDate(args.from, "start");
    const to = parseDate(args.toExclusive, "end");
    if (from !== undefined && to !== undefined && from >= to) throw new Error("Choose an end date after the start date.");
    let events = ctx.db.query("auditEvents").withIndex("by_business_and_time", q => {
      const businessRange = q.eq("businessId", current.business._id);
      if (from !== undefined && to !== undefined) return businessRange.gte("occurredAt", from).lt("occurredAt", to);
      if (from !== undefined) return businessRange.gte("occurredAt", from);
      if (to !== undefined) return businessRange.lt("occurredAt", to);
      return businessRange;
    }).order("desc");
    if (args.action) events = events.filter(q => q.eq(q.field("action"), args.action));
    if (args.actorId) events = events.filter(q => q.eq(q.field("actorId"), args.actorId));
    const page = await events.paginate(args.paginationOpts);
    const rows = await Promise.all(page.page.map(async event => {
      const [actor, profile] = await Promise.all([
        ctx.db.get("users", event.actorId),
        ctx.db.query("userProfiles").withIndex("by_user", q => q.eq("userId", event.actorId)).unique(),
      ]);
      return {
        id: event._id,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        summary: event.summary,
        details: event.details,
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        actorName: profile?.displayName?.trim() || actor?.email || "Workspace member",
      };
    }));
    return { ...page, page: rows };
  },
});

export const filterOptions = query({
  args: {},
  returns: v.union(v.object({ access: v.literal("restricted") }), v.object({
    access: v.literal("ready"),
    actors: v.array(v.object({ id: v.id("users"), name: v.string() })),
    actions: v.array(v.string()),
  })),
  handler: async ctx => {
    const current = await authorizedWorkspace(ctx);
    if (!current) return { access: "restricted" as const };
    const [memberships, events] = await Promise.all([
      ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", current.business._id)).take(500),
      ctx.db.query("auditEvents").withIndex("by_business_and_time", q => q.eq("businessId", current.business._id)).order("desc").take(500),
    ]);
    const actors = await Promise.all(memberships.map(async membership => {
      const [user, profile] = await Promise.all([
        ctx.db.get("users", membership.userId),
        ctx.db.query("userProfiles").withIndex("by_user", q => q.eq("userId", membership.userId)).unique(),
      ]);
      return { id: membership.userId, name: profile?.displayName?.trim() || user?.email || "Workspace member" };
    }));
    return { access: "ready" as const, actors: [...new Map(actors.map(actor => [actor.id, actor])).values()], actions: [...new Set(events.map(event => event.action))].sort() };
  },
});
