import { getAuthUserId } from "@convex-dev/auth/server";
import { countries } from "countries-list";
import { currencies } from "countries-list/currencies";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getSelectedWorkspace } from "./workspaceContext";
import { hasPermission, isOwnerMembership, PERMISSIONS } from "./accessControl";

const roleIdValidator = v.id("workspaceRoles");
function currencyMinorDigits(currency: string) {
  return currencies[currency as keyof typeof currencies]?.decimals ?? 0;
}

function toMinorUnits(amount: number, scale: number) {
  return Math.round(amount * scale);
}

function isValidCurrencyAmount(amount: number, scale: number) {
  const scaled = amount * scale;
  return Number.isFinite(amount) && Number.isSafeInteger(Math.round(scaled)) && Math.abs(scaled - Math.round(scaled)) < 1e-7;
}

async function activeWorkspace(ctx: QueryCtx | MutationCtx) {
  return await getSelectedWorkspace(ctx);
}

async function hasCurrencySensitiveData(ctx: MutationCtx, businessId: Id<"businesses">) {
  const checks = await Promise.all([
    ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("operationalRecords").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("movements").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("savingsHoldings").withIndex("by_business_and_active", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("savingsFlows").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("loans").withIndex("by_business_and_status", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("loanRepayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("bills").withIndex("by_business_and_active_due", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("categoryBudgets").withIndex("by_business", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("expenseTemplates").withIndex("by_business_and_amount", q => q.eq("businessId", businessId).gt("amountUgx", 0)).first(),
    ctx.db.query("billPayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("balanceAdjustments").withIndex("by_business_and_created_at", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", businessId)).take(2),
  ]);
  const balances = checks.at(-1) as { openingBalanceUgx?: number }[];
  return checks.slice(0, -1).some(Boolean) || balances.some(balance => (balance.openingBalanceUgx ?? 0) !== 0);
}

async function hasPostedLedgerActivity(ctx: QueryCtx | MutationCtx, businessId: Id<"businesses">) {
  const checks = await Promise.all([
    ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("operationalRecords").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("movements").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("savingsFlows").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("loans").withIndex("by_business_and_status", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("loanRepayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("billPayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("balanceAdjustments").withIndex("by_business_and_created_at", q => q.eq("businessId", businessId)).first(),
  ]);
  return checks.some(Boolean);
}

function defaults() {
  return {
    locale: "en-UG",
    dateFormat: "DD/MM/YYYY" as const,
    fiscalYearStartMonth: 1,
    incomeCategories: ["Product sales", "Service income", "Other income"],
    expenseCategories: ["Transport", "Supplies", "Utilities", "Rent", "Equipment", "Other expense"],
    highExpenseReviewUgx: 500000,
    weakDaySalesUgx: 50000,
    monthlySalesTargetUgx: 0,
    monthlyExpenseWarningUgx: 0,
    lowCashAlertUgx: 100000,
    duplicateWindowDays: 1,
    requireEntryNote: false,
    negativeBalanceWarning: true,
  };
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const current = await activeWorkspace(ctx);
    if (!current) return { access: "pending" as const };
    if (!(await hasPermission(ctx, current.membership, "settings.view"))) return { access: "restricted" as const, role: current.membership.role };
    const prefs = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    const firstEntry = await ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", current.business._id)).first();
    const firstOperationalRecord = await ctx.db.query("operationalRecords").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", current.business._id)).first();
    const balances = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id)).take(2);
    const firstBalanceAdjustment = await ctx.db.query("balanceAdjustments").withIndex("by_business_and_created_at", q => q.eq("businessId", current.business._id)).first();
    const openingBalancesLocked = await hasPostedLedgerActivity(ctx, current.business._id);
    const fallback = defaults();
    const digits = currencyMinorDigits(current.business.currency);
    const scale = 10 ** digits;
    return {
      access: "ready" as const,
      role: current.membership.role,
      businessId: current.business._id,
      canUpdate: await hasPermission(ctx, current.membership, "settings.update"),
      canManageBalanceAdjustments: await hasPermission(ctx, current.membership, "balanceAdjustments.manage"),
      businessName: current.business.name,
      countryCode: current.business.countryCode ?? "UG",
      currency: current.business.currency,
      currencyMinorDigits: digits,
      settingsUpdatedAt: prefs?.updatedAt ?? current.business.createdAt,
      currencyLocked: Boolean(firstEntry || firstOperationalRecord || firstBalanceAdjustment || balances.some(b => (b.openingBalanceUgx ?? 0) !== 0)),
      openingBalancesLocked,
      cashOpeningBalance: (balances.find(b => b.account === "cash")?.openingBalanceUgx ?? 0) / scale,
      mobileOpeningBalance: (balances.find(b => b.account === "mobile_money")?.openingBalanceUgx ?? 0) / scale,
      timezone: current.business.timezone,
      weekStartsOn: current.business.weekStartsOn ?? "monday",
      locale: prefs?.locale ?? fallback.locale,
      dateFormat: prefs?.dateFormat ?? fallback.dateFormat,
      fiscalYearStartMonth: prefs?.fiscalYearStartMonth ?? fallback.fiscalYearStartMonth,
      incomeCategories: prefs?.incomeCategories ?? fallback.incomeCategories,
      expenseCategories: prefs?.expenseCategories ?? fallback.expenseCategories,
      highExpenseReviewUgx: (prefs?.highExpenseReviewUgx ?? fallback.highExpenseReviewUgx * scale) / scale,
      weakDaySalesUgx: (prefs?.weakDaySalesUgx ?? fallback.weakDaySalesUgx * scale) / scale,
      monthlySalesTargetUgx: (prefs?.monthlySalesTargetUgx ?? fallback.monthlySalesTargetUgx * scale) / scale,
      monthlyExpenseWarningUgx: (prefs?.monthlyExpenseWarningUgx ?? fallback.monthlyExpenseWarningUgx * scale) / scale,
      lowCashAlertUgx: (prefs?.lowCashAlertUgx ?? fallback.lowCashAlertUgx * scale) / scale,
      duplicateWindowDays: prefs?.duplicateWindowDays ?? fallback.duplicateWindowDays,
      requireEntryNote: prefs?.requireEntryNote ?? fallback.requireEntryNote,
      negativeBalanceWarning: prefs?.negativeBalanceWarning ?? fallback.negativeBalanceWarning,
    };
  },
});

// Operational display context used by active finance screens. It deliberately
// excludes balances, targets, review rules, and administrative preferences.
export const runtimeContext = query({
  args: {},
  returns: v.union(
    v.object({ access: v.literal("pending") }),
    v.object({
    access: v.literal("ready"), businessName: v.string(), countryCode: v.string(), currency: v.string(),
    currencyMinorDigits: v.number(), timezone: v.string(), weekStartsOn: v.union(v.literal("monday"), v.literal("sunday")),
      locale: v.string(), dateFormat: v.union(v.literal("DD/MM/YYYY"), v.literal("MM/DD/YYYY"), v.literal("YYYY-MM-DD")),
      fiscalYearStartMonth: v.number(), incomeCategories: v.array(v.string()), expenseCategories: v.array(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const current = await activeWorkspace(ctx);
    if (!current) return { access: "pending" as const };
    const prefs = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    return {
      access: "ready" as const, businessName: current.business.name, countryCode: current.business.countryCode ?? "UG",
      currency: current.business.currency, currencyMinorDigits: currencyMinorDigits(current.business.currency),
      timezone: current.business.timezone, weekStartsOn: current.business.weekStartsOn ?? "monday",
      locale: prefs?.locale ?? "en-UG", dateFormat: prefs?.dateFormat ?? "DD/MM/YYYY",
      fiscalYearStartMonth: prefs?.fiscalYearStartMonth ?? 1,
      incomeCategories: prefs?.incomeCategories ?? defaults().incomeCategories,
      expenseCategories: prefs?.expenseCategories ?? defaults().expenseCategories,
    };
  },
});

export const update = mutation({
  args: {
    expectedSettingsUpdatedAt: v.number(),
    businessName: v.string(), countryCode: v.string(), currency: v.string(), timezone: v.string(),
    weekStartsOn: v.union(v.literal("monday"), v.literal("sunday")), locale: v.string(),
    dateFormat: v.union(v.literal("DD/MM/YYYY"), v.literal("MM/DD/YYYY"), v.literal("YYYY-MM-DD")),
    fiscalYearStartMonth: v.number(), incomeCategories: v.array(v.string()), expenseCategories: v.array(v.string()),
    highExpenseReviewUgx: v.number(), weakDaySalesUgx: v.number(), monthlySalesTargetUgx: v.number(),
    monthlyExpenseWarningUgx: v.number(), lowCashAlertUgx: v.number(), duplicateWindowDays: v.number(), requireEntryNote: v.boolean(),
    negativeBalanceWarning: v.boolean(), cashOpeningBalance: v.number(), mobileOpeningBalance: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "settings.update"))) throw new Error("You do not have permission to change workspace settings.");
    const existing = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    const balances = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id)).take(2);
    if (args.expectedSettingsUpdatedAt !== (existing?.updatedAt ?? current.business.createdAt)) {
      throw new Error("These settings changed in another session. Refresh this page before saving again.");
    }
    const businessName = args.businessName.trim();
    if (businessName.length < 2 || businessName.length > 100) throw new Error("Workspace name must be 2 to 100 characters.");
    if (!/^[A-Z]{2}$/.test(args.countryCode) || !countries[args.countryCode as keyof typeof countries]) throw new Error("Choose a valid country.");
    if (!/^[A-Z]{3}$/.test(args.currency) || !currencies[args.currency as keyof typeof currencies] || currencies[args.currency as keyof typeof currencies].withdrawn) throw new Error("Choose an active ISO currency.");
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(args.locale)) throw new Error("Choose a valid locale, such as en-UG.");
    let scale: number;
    try { new Intl.DateTimeFormat(args.locale); new Intl.DateTimeFormat("en", { timeZone: args.timezone }); scale = 10 ** (currencyMinorDigits(args.currency) ?? 0); new Intl.NumberFormat("en", { style: "currency", currency: args.currency }); }
    catch { throw new Error("Choose a valid locale and IANA timezone."); }
    if (!Number.isInteger(args.fiscalYearStartMonth) || args.fiscalYearStartMonth < 1 || args.fiscalYearStartMonth > 12) throw new Error("Fiscal year start must be a month from 1 to 12.");
    for (const [label, amount] of [["High expense review", args.highExpenseReviewUgx], ["Weak day sales", args.weakDaySalesUgx], ["Monthly sales target", args.monthlySalesTargetUgx], ["Monthly expense warning", args.monthlyExpenseWarningUgx], ["Low cash alert", args.lowCashAlertUgx]] as const) {
      if (amount < 0 || !isValidCurrencyAmount(amount, scale)) throw new Error(`${label} must be a non-negative amount using the selected currency's decimal places.`);
    }
    if (!Number.isInteger(args.duplicateWindowDays) || args.duplicateWindowDays < 0 || args.duplicateWindowDays > 30) throw new Error("Duplicate review window must be between 0 and 30 days.");
    const incomeCategories = args.incomeCategories.map(c => c.trim());
    const expenseCategories = args.expenseCategories.map(c => c.trim());
    const categories = [...incomeCategories, ...expenseCategories];
    if (args.incomeCategories.length < 1 || args.incomeCategories.length > 40 || args.expenseCategories.length < 1 || args.expenseCategories.length > 40 || categories.length > 80 || categories.some(c => !c.trim() || c.trim().length > 60) || new Set(categories.map(c => c.trim().toLowerCase())).size !== categories.length) {
      throw new Error("Use 1–40 unique income and expense categories, each up to 60 characters.");
    }
    for (const [label, amount] of [["Cash opening balance", args.cashOpeningBalance], ["Mobile money opening balance", args.mobileOpeningBalance]] as const) {
      if (!isValidCurrencyAmount(amount, scale)) throw new Error(`${label} must use the selected currency's supported decimal places.`);
    }
    const cashOpeningMinor = toMinorUnits(args.cashOpeningBalance, scale);
    const mobileOpeningMinor = toMinorUnits(args.mobileOpeningBalance, scale);
    if ((cashOpeningMinor !== (balances.find(b => b.account === "cash")?.openingBalanceUgx ?? 0) || mobileOpeningMinor !== (balances.find(b => b.account === "mobile_money")?.openingBalanceUgx ?? 0)) && !(await hasPermission(ctx, current.membership, "balanceAdjustments.manage"))) {
      throw new Error("Your role cannot change opening balances.");
    }
    const highExpenseReviewMinor = toMinorUnits(args.highExpenseReviewUgx, scale);
    const weakDaySalesMinor = toMinorUnits(args.weakDaySalesUgx, scale);
    const monthlySalesTargetMinor = toMinorUnits(args.monthlySalesTargetUgx, scale);
    const monthlyExpenseWarningMinor = toMinorUnits(args.monthlyExpenseWarningUgx, scale);
    const firstEntry = await ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", current.business._id)).first();
    const currencySensitiveDataExists = await hasCurrencySensitiveData(ctx, current.business._id);
    const ledgerActivityExists = await hasPostedLedgerActivity(ctx, current.business._id);
    if (args.currency !== current.business.currency && currencySensitiveDataExists) throw new Error("Currency is locked after financial activity so existing amounts are never relabelled. Contact support for a reviewed currency migration.");
    const businessPatch = {
      name: businessName, countryCode: args.countryCode, currency: args.currency,
      timezone: args.timezone, weekStartsOn: args.weekStartsOn,
    };
    await ctx.db.patch("businesses", current.business._id, businessPatch);
    const currentBalances = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id)).take(2);
    const cashDoc = currentBalances.find(b => b.account === "cash");
    const mobileDoc = currentBalances.find(b => b.account === "mobile_money");
    if ((ledgerActivityExists || firstEntry) && (cashOpeningMinor !== (cashDoc?.openingBalanceUgx ?? 0) || mobileOpeningMinor !== (mobileDoc?.openingBalanceUgx ?? 0))) {
      throw new Error("Opening balances are locked after the first transaction. Use an auditable adjustment entry instead.");
    }
    if (!ledgerActivityExists && !firstEntry) {
      const now = Date.now();
      if (cashDoc) await ctx.db.patch("accountBalances", cashDoc._id, { balanceUgx: cashOpeningMinor, openingBalanceUgx: cashOpeningMinor, updatedAt: now });
      else if (cashOpeningMinor !== 0) await ctx.db.insert("accountBalances", { businessId: current.business._id, account: "cash", balanceUgx: cashOpeningMinor, openingBalanceUgx: cashOpeningMinor, updatedAt: now });
      if (mobileDoc) await ctx.db.patch("accountBalances", mobileDoc._id, { balanceUgx: mobileOpeningMinor, openingBalanceUgx: mobileOpeningMinor, updatedAt: now });
      else if (mobileOpeningMinor !== 0) await ctx.db.insert("accountBalances", { businessId: current.business._id, account: "mobile_money", balanceUgx: mobileOpeningMinor, openingBalanceUgx: mobileOpeningMinor, updatedAt: now });
    }
    const prefValues = {
      locale: args.locale,
      dateFormat: args.dateFormat,
      fiscalYearStartMonth: args.fiscalYearStartMonth,
      incomeCategories,
      expenseCategories,
      highExpenseReviewUgx: highExpenseReviewMinor,
      weakDaySalesUgx: weakDaySalesMinor,
      monthlySalesTargetUgx: monthlySalesTargetMinor,
      monthlyExpenseWarningUgx: monthlyExpenseWarningMinor,
      lowCashAlertUgx: toMinorUnits(args.lowCashAlertUgx, scale),
      duplicateWindowDays: args.duplicateWindowDays,
      requireEntryNote: args.requireEntryNote,
      negativeBalanceWarning: args.negativeBalanceWarning,
    };
    const now = Date.now();
    if (existing) await ctx.db.patch("workspacePreferences", existing._id, { ...prefValues, updatedAt: now, updatedBy: current.userId });
    else await ctx.db.insert("workspacePreferences", { businessId: current.business._id, ...prefValues, updatedAt: now, updatedBy: current.userId });
    await ctx.db.insert("auditEvents", {
      businessId: current.business._id, actorId: current.userId, action: "workspace.settings.updated",
      entityType: "business", entityId: current.business._id, occurredAt: now,
      summary: "Updated workspace profile and operating settings.",
      details: JSON.stringify({
        before: {
          businessName: current.business.name, countryCode: current.business.countryCode ?? "UG",
          currency: current.business.currency, timezone: current.business.timezone,
          weekStartsOn: current.business.weekStartsOn ?? "monday", locale: existing?.locale ?? "en-UG",
          dateFormat: existing?.dateFormat ?? "DD/MM/YYYY", fiscalYearStartMonth: existing?.fiscalYearStartMonth ?? 1,
          incomeCategories: existing?.incomeCategories ?? ["Product sales", "Service income", "Other income"],
          expenseCategories: existing?.expenseCategories ?? ["Transport", "Supplies", "Utilities", "Rent", "Equipment", "Other expense"],
          highExpenseReview: existing?.highExpenseReviewUgx ?? 500000, weakDaySales: existing?.weakDaySalesUgx ?? 50000,
          monthlySalesTarget: existing?.monthlySalesTargetUgx ?? 0, monthlyExpenseWarning: existing?.monthlyExpenseWarningUgx ?? 0,
          lowCashAlert: existing?.lowCashAlertUgx ?? 100000,
          duplicateWindowDays: existing?.duplicateWindowDays ?? 1, requireEntryNote: existing?.requireEntryNote ?? false,
          negativeBalanceWarning: existing?.negativeBalanceWarning ?? true,
          cashOpeningBalanceMinor: cashDoc?.openingBalanceUgx ?? 0,
          mobileOpeningBalanceMinor: mobileDoc?.openingBalanceUgx ?? 0,
        },
        after: { ...args, incomeCategories, expenseCategories, cashOpeningBalanceMinor: cashOpeningMinor, mobileOpeningBalanceMinor: mobileOpeningMinor },
      }),
    });
    return now;
  },
});

export const exportEntries = query({
  args: {},
  handler: async (ctx) => {
    const current = await activeWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "data.export"))) return { access: "restricted" as const, rows: [] };
    const rows = await ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", current.business._id)).order("asc").take(5000);
    const scale = 10 ** (currencyMinorDigits(current.business.currency) ?? 0);
    return { access: "ready" as const, workspace: current.business.name, currency: current.business.currency, currencyMinorDigits: currencyMinorDigits(current.business.currency), rows: rows.map(({ occurredOn, kind, category, account, amountUgx, note, source, state, createdAt }) => ({ occurredOn, kind, category, account, amount: amountUgx / scale, currency: current.business.currency, note, source, state, createdAt })) };
  },
});

export const ruleReview = query({
  args: {},
  handler: async (ctx) => {
    const current = await activeWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "reports.view"))) return { access: "restricted" as const, currency: "UGX", highExpenses: [], weakDays: [] };
    const prefs = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    const scale = 10 ** (currencyMinorDigits(current.business.currency) ?? 0);
    const threshold = prefs?.highExpenseReviewUgx ?? 500000 * scale;
    const weakThreshold = prefs?.weakDaySalesUgx ?? 50000 * scale;
    const [entries, days] = await Promise.all([
      ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", current.business._id)).order("desc").take(100),
      ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id)).order("desc").take(30),
    ]);
    return {
      access: "ready" as const,
      currency: current.business.currency,
      highExpenses: entries.filter(e => e.state === "posted" && e.kind === "expense" && e.amountUgx >= threshold).slice(0, 20).map(e => ({ id: e._id, date: e.occurredOn, amount: e.amountUgx / scale, category: e.category, note: e.note })),
      weakDays: days.filter(d => d.salesUgx > 0 && d.salesUgx < weakThreshold).slice(0, 14).map(d => ({ day: d.day, sales: d.salesUgx / scale })),
    };
  },
});

export const monthlyTargets = query({
  args: { from: v.string(), toExclusive: v.string() },
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "reports.view"))) return { access: "restricted" as const };
    const prefs = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    const days = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).gte("day", args.from).lt("day", args.toExclusive)).take(40);
    return {
      access: "ready" as const,
      currency: current.business.currency,
      sales: days.reduce((total, day) => total + day.salesUgx, 0),
      expenses: days.reduce((total, day) => total + day.expensesUgx, 0),
      salesTarget: prefs?.monthlySalesTargetUgx ?? 0,
      expenseWarning: prefs?.monthlyExpenseWarningUgx ?? 0,
    };
  },
});

export const accessOverview = query({
  args: { pendingUsersPagination: paginationOptsValidator },
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    if (!current) return { access: "restricted" as const, canViewMembers: false, members: [], invitations: [], audit: [], roles: [], pendingUsers: [], partners: [] };
    const canManageAccess = await hasPermission(ctx, current.membership, "access.manage");
    const canManageRoles = await hasPermission(ctx, current.membership, "roles.manage");
    const canViewMembers = await hasPermission(ctx, current.membership, "access.view") || canManageAccess;
    if (!canViewMembers && !canManageRoles) return { access: "restricted" as const, canViewMembers: false, members: [], invitations: [], audit: [], roles: [], pendingUsers: [], partners: [] };
    const [memberships, invitations, audit, roles, partners] = await Promise.all([
      ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", current.business._id)).take(100),
      ctx.db.query("invitations").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(100),
      ctx.db.query("auditEvents").withIndex("by_business_and_time", q => q.eq("businessId", current.business._id)).order("desc").take(20),
      ctx.db.query("workspaceRoles").withIndex("by_business", q => q.eq("businessId", current.business._id)).take(100),
      ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id)).take(100),
    ]);
    const requestsPage = await ctx.db.query("workspaceAccessRequests")
      .withIndex("by_business_and_status_and_createdAt", q => q.eq("businessId", current.business._id).eq("status", "pending"))
      .order("desc")
      .paginate(args.pendingUsersPagination);
    const partnerNames = new Map(partners.map(partner => [partner._id, partner.name]));
    const members = await Promise.all(memberships.map(async m => {
      const user = await ctx.db.get("users", m.userId);
      const assigned = m.roleId ? roles.find(r => r._id === m.roleId) : undefined;
      const legacyTemplate = roles.find(r => r.builtIn === m.role);
      return { id: m._id, role: assigned?.name ?? m.role, roleId: m.roleId ?? legacyTemplate?._id ?? null, partnerId: m.partnerId ?? null, partnerName: m.partnerId ? partnerNames.get(m.partnerId) : undefined, active: m.active, email: user?.email ?? "Signed-in user", createdAt: m.createdAt };
    }));
    const pendingUsers = await Promise.all(requestsPage.page.map(async request => {
      const user = await ctx.db.get("users", request.userId);
      if (!user) return null;
      const membership = await ctx.db.query("memberships")
        .withIndex("by_business_and_user", q => q.eq("businessId", current.business._id).eq("userId", request.userId))
        .unique();
      if (membership?.active) return null;
      return user ? { id: user._id, email: user.email ?? "Signed-in account", createdAt: request.createdAt } : null;
    }));
    const canViewAudit = await hasPermission(ctx, current.membership, "audit.view");
    return { access: "ready" as const, canViewMembers, canManage: canManageAccess, canManageRoles, canInitializeRoleTemplates: isOwnerMembership(current.membership), canViewAudit, members: canViewMembers ? members : [], pendingUsers: canManageAccess ? pendingUsers.filter((user): user is NonNullable<typeof user> => user !== null) : [], pendingUsersContinueCursor: requestsPage.continueCursor, pendingUsersIsDone: requestsPage.isDone, roles: canManageRoles || canManageAccess || canViewMembers ? roles.map(r => ({ id: r._id, name: r.name, description: r.description, permissions: r.builtIn === "member" ? ["dashboard.view", "analytics.view"] : r.permissions, builtIn: r.builtIn ?? null, active: r.active, memberCount: memberships.filter(m => m.active && (m.roleId === r._id || !m.roleId && (m.role === r.builtIn || m.role.toLowerCase() === r.name.toLowerCase()))).length })) : [], partners: canManageAccess || canViewMembers ? partners.map(partner => ({ id: partner._id, name: partner.name })) : [], invitations: canManageAccess ? invitations.map(i => ({ id: i._id, email: i.email, role: i.role, roleId: i.roleId ?? null, partnerId: i.partnerId ?? null, partnerName: i.partnerId ? partnerNames.get(i.partnerId) : undefined, expiresAt: i.expiresAt })) : [], audit: canViewAudit ? audit.map(a => ({ id: a._id, action: a.action, summary: a.summary, occurredAt: a.occurredAt })) : [] };
  },
});

// Called after sign-in by accounts that do not have active workspace access.
// A single-workspace account is joined as a read-only Member. Existing inactive
// memberships are never reactivated here; only a workspace owner can restore them.
export const requestWorkspaceAccess = mutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in before requesting workspace access.");
    const authUser = await ctx.db.get("users", userId);
    const businesses = await ctx.db.query("businesses").take(2);
    if (businesses.length !== 1) return null;
    const business = businesses[0];
    const membership = await ctx.db.query("memberships")
      .withIndex("by_business_and_user", q => q.eq("businessId", business._id).eq("userId", userId))
      .unique();
    if (membership) return null;
    const now = Date.now();
    const roles = await ctx.db.query("workspaceRoles").withIndex("by_business", q => q.eq("businessId", business._id)).take(100);
    let memberRole = roles.find(role => role.builtIn === "member" && role.active);
    if (!memberRole) {
      const roleId = await ctx.db.insert("workspaceRoles", {
        businessId: business._id,
        name: "Member",
        builtIn: "member",
        permissions: ["dashboard.view", "analytics.view"],
        description: "Read-only access to dashboard and analytics summaries; no access to individual records or workspace settings.",
        active: true,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      memberRole = await ctx.db.get("workspaceRoles", roleId) ?? undefined;
    }
    if (!memberRole) throw new Error("The default Member role could not be created.");
    await ctx.db.insert("memberships", { businessId: business._id, userId, role: memberRole.name, roleId: memberRole._id, active: true, createdAt: now });
    const existing = await ctx.db.query("workspaceAccessRequests")
      .withIndex("by_business_and_user", q => q.eq("businessId", business._id).eq("userId", userId))
      .unique();
    if (existing && existing.status !== "granted") await ctx.db.patch("workspaceAccessRequests", existing._id, { status: "granted", updatedAt: now });
    else if (!existing) await ctx.db.insert("workspaceAccessRequests", { businessId: business._id, userId, status: "granted", createdAt: now, updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "member.auto_joined", entityType: "membership", entityId: userId, occurredAt: now, summary: `Granted limited Member access to ${authUser?.email ?? "a signed-in account"}.` });
    return null;
  },
});

export const createRole = mutation({
  args: { name: v.string(), description: v.string(), permissions: v.array(v.string()) }, returns: v.id("workspaceRoles"),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "roles.manage"))) throw new Error("You do not have permission to manage roles.");
    const name = args.name.trim();
    const permissions = [...new Set(args.permissions)];
    if (name.length < 2 || name.length > 50) throw new Error("Role names must be 2 to 50 characters.");
    if (permissions.some(p => !(PERMISSIONS as readonly string[]).includes(p))) throw new Error("Choose permissions from the supported list.");
    if (!isOwnerMembership(current.membership) && permissions.some(p => p === "access.manage" || p === "roles.manage" || p === "data.export" || p === "imports.manage" || p === "integrations.manage" || p === "balanceAdjustments.manage" || p === "partners.distributions.manage" || p === "partners.distributions.approve")) throw new Error("Only the workspace owner can grant privileged role permissions.");
    const existing = await ctx.db.query("workspaceRoles").withIndex("by_business", q => q.eq("businessId", current.business._id)).take(100);
    if (existing.some(r => r.name.toLowerCase() === name.toLowerCase())) throw new Error("A role with that name already exists.");
    const now = Date.now();
    const role = await ctx.db.insert("workspaceRoles", { businessId: current.business._id, name, description: args.description.trim().slice(0, 240), permissions, active: true, createdBy: current.userId, createdAt: now, updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "role.created", entityType: "workspaceRole", entityId: role, occurredAt: now, summary: `Created the ${name} role with ${permissions.length} permissions.` });
    return role;
  },
});

export const initializeRoleTemplates = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const current = await activeWorkspace(ctx);
    if (!current || !isOwnerMembership(current.membership)) throw new Error("Only the workspace owner can initialize role templates.");
    const roles = await ctx.db.query("workspaceRoles").withIndex("by_business", q => q.eq("businessId", current.business._id)).take(100);
    const now = Date.now();
    const templates = [
      { name: "Owner", builtIn: "owner" as const, permissions: [...PERMISSIONS], description: "Full workspace control." },
      { name: "Member", builtIn: "member" as const, permissions: ["dashboard.view", "analytics.view"], description: "Read-only access to dashboard and analytics summaries; no access to individual records or workspace settings." },
      { name: "Cashier", builtIn: "cashier" as const, permissions: ["dashboard.view", "sales.view", "sales.create", "expenses.view", "expenses.create", "reports.view"], description: "Record sales and expenses and view standard reports." },
      { name: "Partner", builtIn: "partner" as const, permissions: ["dashboard.view", "partners.view"], description: "View partner area only; financial totals are not exposed." },
      { name: "Finance Approver", builtIn: "finance_approver" as const, permissions: ["partners.view", "partners.distributions.approve"], description: "Review partner distributions without workspace-wide finance access." },
    ];
    for (const template of templates) if (!roles.some(r => r.builtIn === template.builtIn)) await ctx.db.insert("workspaceRoles", { businessId: current.business._id, ...template, active: true, createdBy: current.userId, createdAt: now, updatedAt: now });
    const seeded = await ctx.db.query("workspaceRoles").withIndex("by_business", q => q.eq("businessId", current.business._id)).take(100);
    const members = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", current.business._id)).take(500);
    let migrated = 0;
    for (const member of members) {
      if (member.roleId || member.role === "owner") continue;
      const template = seeded.find(r => r.builtIn === member.role);
      if (!template) continue;
      await ctx.db.patch("memberships", member._id, { role: template.name, roleId: template._id });
      migrated += 1;
    }
    if (migrated) await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "access.roles.migrated", entityType: "membership", entityId: current.business._id, occurredAt: now, summary: `Linked ${migrated} existing membership${migrated === 1 ? "" : "s"} to role templates.` });
    return null;
  },
});

export const updateRole = mutation({
  args: { roleId: roleIdValidator, name: v.string(), description: v.string(), permissions: v.array(v.string()), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx); const role = await ctx.db.get("workspaceRoles", args.roleId);
    if (!current || !(await hasPermission(ctx, current.membership, "roles.manage")) || !role || role.businessId !== current.business._id) throw new Error("Role not found or access denied.");
    if (role.builtIn === "owner") throw new Error("The protected Owner role cannot be changed.");
    const name = args.name.trim(); const permissions = [...new Set(args.permissions)];
    if (name.length < 2 || name.length > 50 || permissions.some(p => !(PERMISSIONS as readonly string[]).includes(p))) throw new Error("Enter a valid role name and permission set.");
    if (role.builtIn === "member" && (permissions.length !== 2 || !permissions.includes("dashboard.view") || !permissions.includes("analytics.view"))) throw new Error("The protected Member role is read-only and limited to dashboard and analytics summaries. Create a separate custom role to grant more access.");
    if (!isOwnerMembership(current.membership) && permissions.some(p => p === "access.manage" || p === "roles.manage" || p === "data.export" || p === "imports.manage" || p === "integrations.manage" || p === "balanceAdjustments.manage" || p === "partners.distributions.manage" || p === "partners.distributions.approve")) throw new Error("Only the workspace owner can grant privileged role permissions.");
    const duplicate = await ctx.db.query("workspaceRoles").withIndex("by_business", q => q.eq("businessId", current.business._id)).take(100);
    if (duplicate.some(r => r._id !== role._id && r.name.toLowerCase() === name.toLowerCase())) throw new Error("A role with that name already exists.");
    if (!args.active && role.builtIn) throw new Error("Built-in role templates cannot be deactivated.");
    if (!args.active) {
      const assigned = await ctx.db.query("memberships").withIndex("by_business_and_role_id", q => q.eq("businessId", current.business._id).eq("roleId", role._id)).filter(q => q.eq(q.field("active"), true)).first();
      if (assigned) throw new Error("Reassign active members before deactivating this role.");
    }
    const now = Date.now();
    await ctx.db.patch("workspaceRoles", role._id, { name, description: args.description.trim().slice(0, 240), permissions, active: args.active, updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "role.updated", entityType: "workspaceRole", entityId: role._id, occurredAt: now, summary: `Updated the ${name} role.`, details: JSON.stringify({ before: { name: role.name, description: role.description, permissions: role.permissions, active: role.active }, after: { name, description: args.description.trim().slice(0, 240), permissions, active: args.active } }) });
    return null;
  },
});

export const grantPendingUser = mutation({
  args: { userId: v.id("users"), roleId: roleIdValidator, partnerId: v.optional(v.id("partners")) }, returns: v.null(),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx); const role = await ctx.db.get("workspaceRoles", args.roleId); const user = await ctx.db.get("users", args.userId);
    if (!current || !(await hasPermission(ctx, current.membership, "access.manage")) || !role || role.businessId !== current.business._id || !role.active || !user) throw new Error("User, role, or access permission is unavailable.");
    if (role.builtIn === "owner") throw new Error("Owner access can only be granted through the verified ownership process.");
    if (role.builtIn === "partner" && !args.partnerId) throw new Error("Partner access must be linked to an active partner record.");
    if (args.partnerId) { const partner = await ctx.db.get("partners", args.partnerId); if (!partner || partner.businessId !== current.business._id || !partner.active || !role.permissions.includes("partners.view")) throw new Error("Choose an active partner for a role that can view partners."); }
    if (!isOwnerMembership(current.membership) && role.permissions.some(p => p === "access.manage" || p === "roles.manage" || p === "data.export" || p === "imports.manage" || p === "integrations.manage" || p === "balanceAdjustments.manage" || p === "partners.distributions.manage" || p === "partners.distributions.approve")) throw new Error("Only the workspace owner can assign a privileged role.");
    const existing = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", current.business._id).eq("userId", user._id)).unique();
    if (existing?.active) throw new Error("This user already has active workspace access.");
    if (existing && existing.role === "owner" && !existing.roleId) throw new Error("Owner access cannot be reassigned here.");
    const now = Date.now();
    if (existing) await ctx.db.patch("memberships", existing._id, { active: true, role: role.name, roleId: role._id, partnerId: args.partnerId });
    else await ctx.db.insert("memberships", { businessId: current.business._id, userId: user._id, active: true, role: role.name, roleId: role._id, partnerId: args.partnerId, createdAt: now });
    const accessRequest = await ctx.db.query("workspaceAccessRequests")
      .withIndex("by_business_and_user", q => q.eq("businessId", current.business._id).eq("userId", user._id))
      .unique();
    if (accessRequest?.status === "pending") await ctx.db.patch("workspaceAccessRequests", accessRequest._id, { status: "granted", updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "member.access.granted", entityType: "membership", entityId: existing?._id ?? user._id, occurredAt: now, summary: `Granted ${user.email ?? "a user"} access as ${role.name}.` });
    return null;
  },
});

export const invite = mutation({
  args: { email: v.string(), roleId: roleIdValidator, partnerId: v.optional(v.id("partners")) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    if (!current || !(await hasPermission(ctx, current.membership, "access.manage"))) throw new Error("You do not have permission to invite people.");
    const assignedRole = await ctx.db.get("workspaceRoles", args.roleId);
    if (!assignedRole || assignedRole.businessId !== current.business._id || !assignedRole.active) throw new Error("Choose an active workspace role.");
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (assignedRole.builtIn === "owner") throw new Error("Owner access can only be granted through the verified ownership process.");
    if (assignedRole.builtIn === "partner" && !args.partnerId) throw new Error("Partner invitations must be linked to exactly one active partner record.");
    if (args.partnerId && !assignedRole.permissions.includes("partners.view")) throw new Error("Only roles with partner access can be linked to a partner record.");
    if (args.partnerId) {
      const partner = await ctx.db.get("partners", args.partnerId);
      if (!partner || partner.businessId !== current.business._id || !partner.active) throw new Error("Choose an active partner in this workspace.");
    }
    if (!isOwnerMembership(current.membership) && assignedRole.permissions.some(p => p === "access.manage" || p === "roles.manage" || p === "data.export" || p === "imports.manage" || p === "integrations.manage" || p === "balanceAdjustments.manage" || p === "partners.distributions.manage" || p === "partners.distributions.approve")) throw new Error("Only the workspace owner can invite a privileged role.");
    const pending = await ctx.db.query("invitations").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(100);
    if (pending.some(i => i.email.toLowerCase() === email)) throw new Error("An active invitation already exists for this email.");
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    const token = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
    const now = Date.now();
    await ctx.db.insert("invitations", { email, role: assignedRole.name, roleId: assignedRole._id, partnerId: args.partnerId, businessId: current.business._id, invitedBy: current.userId, expiresAt: now + 7 * 24 * 60 * 60 * 1000, active: true, tokenHash });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "member.invited", entityType: "invitation", entityId: email, occurredAt: now, summary: `Invited ${email} as ${assignedRole.name}.` });
    return token;
  },
});

export const revokeInvite = mutation({
  args: { invitationId: v.id("invitations") }, returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const current = await activeWorkspace(ctx);
    const invite = await ctx.db.get("invitations", invitationId);
    if (!current || !(await hasPermission(ctx, current.membership, "access.manage")) || !invite || invite.businessId !== current.business._id) throw new Error("Invitation not found or access denied.");
    await ctx.db.patch("invitations", invitationId, { active: false });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "invitation.revoked", entityType: "invitation", entityId: invitationId, occurredAt: Date.now(), summary: `Revoked invitation for ${invite.email}.` });
    return null;
  },
});

export const updateMember = mutation({
  args: { membershipId: v.id("memberships"), roleId: roleIdValidator, partnerId: v.optional(v.id("partners")), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    const member = await ctx.db.get("memberships", args.membershipId);
    const assignedRole = await ctx.db.get("workspaceRoles", args.roleId);
    if (!current || !(await hasPermission(ctx, current.membership, "access.manage")) || !member || member.businessId !== current.business._id || !assignedRole || assignedRole.businessId !== current.business._id || !assignedRole.active) throw new Error("Member, role, or access permission is unavailable.");
    if (isOwnerMembership(member) || member.role === "owner" && !member.roleId) throw new Error("Owner access cannot be changed here. Use the verified ownership transfer process.");
    if (assignedRole.builtIn === "owner") throw new Error("Owner access can only be granted through the verified ownership process.");
    if (assignedRole.builtIn === "partner" && !args.partnerId) throw new Error("Partner access must be linked to an active partner record.");
    if (args.partnerId && !assignedRole.permissions.includes("partners.view")) throw new Error("Only roles with partner access can be linked to a partner record.");
    if (args.partnerId) {
      const partner = await ctx.db.get("partners", args.partnerId);
      if (!partner || partner.businessId !== current.business._id || !partner.active) throw new Error("Choose an active partner in this workspace.");
    }
    if (!isOwnerMembership(current.membership) && assignedRole.permissions.some(p => p === "access.manage" || p === "roles.manage" || p === "data.export" || p === "imports.manage" || p === "integrations.manage" || p === "balanceAdjustments.manage" || p === "partners.distributions.manage" || p === "partners.distributions.approve")) throw new Error("Only the workspace owner can assign a privileged role.");
    if (member.userId === current.userId && !args.active) throw new Error("You cannot deactivate your own account.");
    await ctx.db.patch("memberships", args.membershipId, { role: assignedRole.name, roleId: assignedRole._id, partnerId: args.partnerId, active: args.active });
    if (args.active) {
      const accessRequest = await ctx.db.query("workspaceAccessRequests")
        .withIndex("by_business_and_user", q => q.eq("businessId", current.business._id).eq("userId", member.userId))
        .unique();
      if (accessRequest?.status === "pending") await ctx.db.patch("workspaceAccessRequests", accessRequest._id, { status: "granted", updatedAt: Date.now() });
    }
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "member.access.updated", entityType: "membership", entityId: args.membershipId, occurredAt: Date.now(), summary: `Changed a member to ${assignedRole.name} (${args.active ? "active" : "inactive"}).` });
    return null;
  },
});

export const acceptInvite = mutation({
  args: { token: v.string() }, returns: v.null(),
  handler: async (ctx, { token }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in with the email address that received this invitation.");
    const user = await ctx.db.get("users", userId);
    if (!user?.email) throw new Error("Your account does not have a verified email address.");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
    const invite = await ctx.db.query("invitations").withIndex("by_token_hash", q => q.eq("tokenHash", tokenHash)).unique();
    if (!invite || !invite.active || invite.expiresAt < Date.now()) throw new Error("This invitation has expired or was already used.");
    if (invite.email.toLowerCase() !== user.email.toLowerCase()) throw new Error("Sign in using the invited email address.");
    const templates = invite.roleId ? [] : await ctx.db.query("workspaceRoles").withIndex("by_business", q => q.eq("businessId", invite.businessId)).take(100);
    const legacyRole = invite.role.toLowerCase();
    let role = invite.roleId ? await ctx.db.get("workspaceRoles", invite.roleId) : templates.find(r => r.builtIn === legacyRole || r.name.toLowerCase() === legacyRole) ?? null;
    if (!invite.roleId && !role) {
      const legacyTemplate = legacyRole === "member" ? {
        name: "Member", builtIn: "member" as const,
        permissions: ["dashboard.view", "analytics.view"],
        description: "Read-only access to dashboard and analytics summaries; no access to individual records or workspace settings.",
      } : legacyRole === "cashier" ? {
        name: "Cashier", builtIn: "cashier" as const,
        permissions: ["dashboard.view", "sales.view", "sales.create", "expenses.view", "expenses.create", "reports.view"],
        description: "Record sales and expenses and view standard reports.",
      } : legacyRole === "partner" ? {
        name: "Partner", builtIn: "partner" as const, permissions: ["dashboard.view", "partners.view"],
        description: "View partner area only; financial totals are not exposed.",
      } : legacyRole === "finance_approver" || legacyRole === "finance approver" ? {
        name: "Finance Approver", builtIn: "finance_approver" as const, permissions: ["partners.view", "partners.distributions.approve"],
        description: "Review partner distributions without workspace-wide finance access.",
      } : null;
      if (legacyTemplate) {
        const now = Date.now();
        const roleId = await ctx.db.insert("workspaceRoles", { businessId: invite.businessId, ...legacyTemplate, active: true, createdBy: userId, createdAt: now, updatedAt: now });
        role = await ctx.db.get("workspaceRoles", roleId);
      }
    }
    if (invite.roleId && (!role || !role.active || role.businessId !== invite.businessId)) throw new Error("This invitation role is no longer available. Ask the workspace owner for a new invitation.");
    if (invite.partnerId) {
      const partner = await ctx.db.get("partners", invite.partnerId);
      if (!partner || partner.businessId !== invite.businessId || !partner.active) throw new Error("This partner account is no longer active. Ask the workspace owner for a new invitation.");
    }
    const existing = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", invite.businessId).eq("userId", userId)).unique();
    const existingRole = existing?.roleId ? await ctx.db.get("workspaceRoles", existing.roleId) : null;
    const isAutoMember = Boolean(existing?.active && !existing.partnerId && (existingRole?.builtIn === "member" || (!existing.roleId && existing.role.toLowerCase() === "member")));
    if (existing?.active && !isAutoMember) throw new Error("You already have access to this workspace.");
    const currentMemberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(1001);
    if (currentMemberships.length > 1000) throw new Error("This account has reached the workspace membership limit. Contact support for help.");
    if (invite.partnerId) {
      const linkedMember = await ctx.db.query("memberships").withIndex("by_business_and_partner_and_active", q => q.eq("businessId", invite.businessId).eq("partnerId", invite.partnerId).eq("active", true)).first();
      if (linkedMember && linkedMember.userId !== userId) throw new Error("This partner account is already linked. Ask the workspace owner to review access.");
    }
    if (!role || !role.active || role.businessId !== invite.businessId) throw new Error("This invitation role is no longer available. Ask the workspace owner for a new invitation.");
    if ((role.builtIn === "partner" && !invite.partnerId) || (invite.partnerId && !role.permissions.includes("partners.view"))) throw new Error("This partner invitation needs to be reviewed by the workspace owner before it can be accepted.");
    const now = Date.now();
    if (existing) await ctx.db.patch("memberships", existing._id, { active: true, role: role.name, roleId: role._id, partnerId: invite.partnerId });
    else await ctx.db.insert("memberships", { businessId: invite.businessId, userId, role: role.name, roleId: role._id, partnerId: invite.partnerId, active: true, createdAt: now });
    const accessRequest = await ctx.db.query("workspaceAccessRequests")
      .withIndex("by_business_and_user", q => q.eq("businessId", invite.businessId).eq("userId", userId))
      .unique();
    if (accessRequest?.status === "pending") await ctx.db.patch("workspaceAccessRequests", accessRequest._id, { status: "granted", updatedAt: now });
    await ctx.db.patch("invitations", invite._id, { active: false, acceptedAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: invite.businessId, actorId: userId, action: "invitation.accepted", entityType: "invitation", entityId: invite._id, occurredAt: Date.now(), summary: `${user.email} accepted a workspace invitation.` });
    return null;
  },
});
