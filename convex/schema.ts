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
    currency: v.string(),
    countryCode: v.optional(v.string()),
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
    tokenHash: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_business_and_active", ["businessId", "active"])
    .index("by_token_hash", ["tokenHash"]),
  workspacePreferences: defineTable({
    businessId: v.id("businesses"),
    locale: v.optional(v.string()),
    dateFormat: v.optional(v.union(v.literal("DD/MM/YYYY"), v.literal("MM/DD/YYYY"), v.literal("YYYY-MM-DD"))),
    fiscalYearStartMonth: v.optional(v.number()),
    incomeCategories: v.optional(v.array(v.string())),
    expenseCategories: v.optional(v.array(v.string())),
    highExpenseReviewUgx: v.optional(v.number()),
    weakDaySalesUgx: v.optional(v.number()),
    monthlySalesTargetUgx: v.optional(v.number()),
    monthlyExpenseWarningUgx: v.optional(v.number()),
    duplicateWindowDays: v.optional(v.number()),
    requireEntryNote: v.optional(v.boolean()),
    negativeBalanceWarning: v.optional(v.boolean()),
    updatedAt: v.number(),
    updatedBy: v.id("users"),
  }).index("by_business", ["businessId"]),
  partners: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    ownershipBps: v.number(),
    active: v.boolean(),
    idempotencyKey: v.optional(v.string()),
  }).index("by_business_and_active", ["businessId", "active"]).index("by_business_and_idempotency", ["businessId", "idempotencyKey"]),
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
    .index("by_business_and_idempotency", ["businessId", "idempotencyKey"])
    .searchIndex("search_note", { searchField: "note", filterFields: ["businessId"] })
    .searchIndex("search_category", { searchField: "category", filterFields: ["businessId"] }),
  accountBalances: defineTable({
    businessId: v.id("businesses"),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    balanceUgx: v.number(),
    openingBalanceUgx: v.optional(v.number()),
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
  movements: defineTable({
    businessId: v.id("businesses"),
    kind: v.union(v.literal("transfer"), v.literal("withdrawal"), v.literal("deposit"), v.literal("capital_contribution")),
    amountUgx: v.number(),
    feeUgx: v.optional(v.number()),
    fromAccount: v.optional(v.union(v.literal("cash"), v.literal("mobile_money"))),
    toAccount: v.optional(v.union(v.literal("cash"), v.literal("mobile_money"))),
    partnerId: v.optional(v.id("partners")),
    occurredOn: v.string(),
    note: v.string(),
    idempotencyKey: v.string(),
    state: v.union(v.literal("posted"), v.literal("void")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_business_and_date", ["businessId", "occurredOn"])
    .index("by_business_and_idempotency", ["businessId", "idempotencyKey"]),
  savingsHoldings: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    targetUgx: v.optional(v.number()),
    balanceUgx: v.number(),
    active: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    idempotencyKey: v.string(),
  }).index("by_business_and_active", ["businessId", "active"]).index("by_business_and_idempotency", ["businessId", "idempotencyKey"]),
  savingsFlows: defineTable({
    businessId: v.id("businesses"),
    holdingId: v.id("savingsHoldings"),
    kind: v.union(v.literal("contribution"), v.literal("withdrawal")),
    amountUgx: v.number(),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    occurredOn: v.string(),
    note: v.string(),
    idempotencyKey: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_business_and_date", ["businessId", "occurredOn"])
    .index("by_business_and_idempotency", ["businessId", "idempotencyKey"])
    .index("by_holding_and_date", ["holdingId", "occurredOn"]),
  loans: defineTable({
    businessId: v.id("businesses"),
    lender: v.string(),
    principalUgx: v.number(),
    outstandingPrincipalUgx: v.number(),
    annualRateBps: v.number(),
    termMonths: v.number(),
    startedOn: v.string(),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    status: v.union(v.literal("active"), v.literal("paid_off")),
    note: v.string(),
    idempotencyKey: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_business_and_status", ["businessId", "status"])
    .index("by_business_and_idempotency", ["businessId", "idempotencyKey"]),
  loanRepayments: defineTable({
    businessId: v.id("businesses"),
    loanId: v.id("loans"),
    amountUgx: v.number(),
    principalUgx: v.number(),
    interestUgx: v.number(),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    paidOn: v.string(),
    idempotencyKey: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_business_and_date", ["businessId", "paidOn"])
    .index("by_business_and_idempotency", ["businessId", "idempotencyKey"])
    .index("by_loan_and_date", ["loanId", "paidOn"]),
  bills: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    category: v.string(),
    amountUgx: v.number(),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    recurrence: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("yearly")),
    nextDueOn: v.string(),
    active: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    idempotencyKey: v.string(),
  }).index("by_business_and_active_due", ["businessId", "active", "nextDueOn"]).index("by_business_and_idempotency", ["businessId", "idempotencyKey"]),
  billPayments: defineTable({
    businessId: v.id("businesses"),
    billId: v.id("bills"),
    entryId: v.id("entries"),
    amountUgx: v.number(),
    paidOn: v.string(),
    idempotencyKey: v.string(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_business_and_date", ["businessId", "paidOn"])
    .index("by_business_and_idempotency", ["businessId", "idempotencyKey"])
    .index("by_bill_and_date", ["billId", "paidOn"]),
  reconciliations: defineTable({
    businessId: v.id("businesses"),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    asOfDate: v.string(),
    bookBalanceUgx: v.number(),
    countedBalanceUgx: v.number(),
    varianceUgx: v.number(),
    status: v.union(v.literal("matched"), v.literal("open"), v.literal("explained")),
    note: v.string(),
    explanation: v.optional(v.string()),
    idempotencyKey: v.string(),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_business_and_date", ["businessId", "asOfDate"]).index("by_business_and_idempotency", ["businessId", "idempotencyKey"]),
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
