import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

export const PERMISSIONS = [
  "dashboard.view",
  "analytics.view", "dailyReport.view", "monthlyPnl.view",
  "sales.view", "sales.create", "sales.update", "sales.void",
  "expenses.view", "expenses.create", "expenses.update", "expenses.void",
  "movements.view", "movements.create", "movements.update", "movements.void",
  "savings.view", "savings.create", "savings.update", "savings.delete",
  "loans.view", "loans.create", "loans.update", "loans.approve", "loans.repay", "loans.void",
  "bills.view", "bills.create", "bills.update", "bills.pay", "bills.void",
  "reconcile.view", "reconcile.create", "reconcile.resolve",
  "reports.view", "partners.view", "partners.manage", "partners.distributions.manage", "partners.distributions.approve",
  "settings.view", "settings.update", "data.export",
  "imports.manage", "integrations.manage", "balanceAdjustments.manage",
  "access.view", "access.manage", "roles.manage", "audit.view",
] as const;
export type Permission = typeof PERMISSIONS[number];

const OWNER = [...PERMISSIONS];
const MEMBER: Permission[] = ["dashboard.view", "analytics.view", "reports.view"];
const CASHIER: Permission[] = ["dashboard.view", "sales.view", "sales.create", "expenses.view", "expenses.create", "reports.view"];
const PARTNER: Permission[] = ["dashboard.view", "partners.view"];
const FINANCE_APPROVER: Permission[] = ["partners.view", "partners.distributions.approve"];

export async function permissionsForMembership(ctx: QueryCtx | MutationCtx, membership: Doc<"memberships">) {
  if (membership.role === "owner" && !membership.roleId) return OWNER;
  if (membership.roleId) {
    const role = await ctx.db.get("workspaceRoles", membership.roleId);
    if (!role || !role.active || role.businessId !== membership.businessId) return [] as string[];
    return role.permissions;
  }
  const templates = await ctx.db.query("workspaceRoles")
    .withIndex("by_business", q => q.eq("businessId", membership.businessId))
    .take(100);
  const legacyTemplate = templates.find(role => role.builtIn === membership.role || role.name.toLowerCase() === membership.role.toLowerCase());
  if (legacyTemplate?.active) return legacyTemplate.permissions;
  if (membership.role === "member") return MEMBER;
  if (membership.role === "cashier") return CASHIER;
  if (membership.role === "partner") return PARTNER;
  if (membership.role === "finance_approver") return FINANCE_APPROVER;
  return [] as string[];
}

export async function hasPermission(ctx: QueryCtx | MutationCtx, membership: Doc<"memberships">, permission: Permission) {
  if (membership.role === "owner" && !membership.roleId) return true;
  return (await permissionsForMembership(ctx, membership)).includes(permission);
}

export function isOwnerMembership(membership: Doc<"memberships">) {
  return membership.role === "owner" && !membership.roleId;
}
