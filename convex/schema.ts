import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const role = v.union(
  v.literal("owner"),
  v.literal("partner"),
  v.literal("cashier"),
);

export default defineSchema({
  ...authTables,
  businesses: defineTable({
    name: v.string(),
    currency: v.literal("UGX"),
    timezone: v.string(),
    weekStartsOn: v.optional(v.union(v.literal("monday"), v.literal("sunday"))),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }),
  memberships: defineTable({
    businessId: v.id("businesses"),
    userId: v.id("users"),
    role,
    partnerId: v.optional(v.id("partners")),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_business_and_user", ["businessId", "userId"]),
  invitations: defineTable({
    email: v.string(),
    role,
    businessId: v.id("businesses"),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    active: v.boolean(),
  })
    .index("by_email", ["email"])
    .index("by_business_and_active", ["businessId", "active"]),
  partners: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    ownershipBps: v.number(),
    active: v.boolean(),
  }).index("by_business_and_active", ["businessId", "active"]),
  entries: defineTable({
    businessId: v.id("businesses"),
    kind: v.union(v.literal("sale"), v.literal("expense")),
    amountUgx: v.number(),
    occurredOn: v.string(),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    category: v.string(),
    note: v.string(),
    source: v.union(v.literal("manual"), v.literal("import")),
    idempotencyKey: v.string(),
    state: v.union(v.literal("posted"), v.literal("void")),
    createdBy: v.id("users"),
    createdAt: v.number(),
    voidedAt: v.optional(v.number()),
    voidedBy: v.optional(v.id("users")),
    voidReason: v.optional(v.string()),
  })
    .index("by_business_and_date", ["businessId", "occurredOn"])
    .index("by_business_and_kind_and_date", ["businessId", "kind", "occurredOn"])
    .index("by_business_and_idempotency", ["businessId", "idempotencyKey"]),
  accountBalances: defineTable({
    businessId: v.id("businesses"),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    balanceUgx: v.number(),
    updatedAt: v.number(),
  }).index("by_business_and_account", ["businessId", "account"]),
  dailyTotals: defineTable({
    businessId: v.id("businesses"),
    day: v.string(),
    salesUgx: v.number(),
    expensesUgx: v.number(),
    saleCount: v.number(),
    expenseCount: v.number(),
  }).index("by_business_and_day", ["businessId", "day"]),
  auditEvents: defineTable({
    businessId: v.id("businesses"),
    actorId: v.id("users"),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    occurredAt: v.number(),
    summary: v.string(),
    details: v.optional(v.string()),
  }).index("by_business_and_time", ["businessId", "occurredAt"]),
});
