import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export async function getSelectedWorkspace(ctx: Ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(1001);
  if (memberships.length > 1000) return null;
  const activeMemberships = memberships.filter(row => row.active);
  if (!activeMemberships.length) return null;
  const selection = await ctx.db.query("workspaceSelections").withIndex("by_user", q => q.eq("userId", userId)).unique();
  const selectedMembership = selection ? activeMemberships.find(row => row.businessId === selection.businessId) : undefined;
  const membership = selectedMembership ?? (activeMemberships.length === 1 ? activeMemberships[0] : undefined);
  if (!membership) return null;
  const business = await ctx.db.get("businesses", membership.businessId);
  return business ? { userId, membership, business } : null;
}

export async function listUserWorkspaces(ctx: Ctx, userId: Id<"users">) {
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(1001);
  if (memberships.length > 1000) return [];
  const activeMemberships = memberships.filter(row => row.active);
  const workspaces = [];
  for (const membership of activeMemberships) {
    const business = await ctx.db.get("businesses", membership.businessId);
    if (business) workspaces.push({ businessId: business._id, businessName: business.name, role: membership.role });
  }
  return workspaces;
}
