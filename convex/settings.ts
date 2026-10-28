import { getAuthUserId } from "@convex-dev/auth/server";
import { countries } from "countries-list";
import { currencies } from "countries-list/currencies";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const role = v.union(v.literal("owner"), v.literal("partner"), v.literal("cashier"), v.literal("finance_approver"));
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
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(20);
  const active = memberships.filter(m => m.active);
  if (memberships.length === 20 || active.length !== 1) return null;
  const membership = active[0];
  const business = await ctx.db.get("businesses", membership.businessId);
  return business ? { userId, membership, business } : null;
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
    ctx.db.query("billPayments").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("reconciliations").withIndex("by_business_and_date", q => q.eq("businessId", businessId)).first(),
    ctx.db.query("balanceAdjustments").withIndex("by_business_and_created_at", q => q.eq("businessId", businessId)).first(),
  ]);
  return checks.some(Boolean);
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
    if (current.membership.role === "partner") return { access: "restricted" as const, role: "partner" as const };
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
      businessName: current.business.name,
      countryCode: current.business.countryCode ?? "UG",
      currency: current.business.currency,
      currencyMinorDigits: digits,
      settingsUpdatedAt: prefs?.updatedAt ?? current.business.createdAt,
      currencyLocked: Boolean(firstEntry || firstOperationalRecord || firstBalanceAdjustment || balances.some(b => (b.openingBalanceUgx ?? 0) !== 0)),
      openingBalancesLocked,
      cashOpeningBalance: current.membership.role === "finance_approver" ? 0 : (balances.find(b => b.account === "cash")?.openingBalanceUgx ?? 0) / scale,
      mobileOpeningBalance: current.membership.role === "finance_approver" ? 0 : (balances.find(b => b.account === "mobile_money")?.openingBalanceUgx ?? 0) / scale,
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
    if (!current || current.membership.role !== "owner") throw new Error("Only the workspace owner can change settings.");
    const existing = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
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
    const highExpenseReviewMinor = toMinorUnits(args.highExpenseReviewUgx, scale);
    const weakDaySalesMinor = toMinorUnits(args.weakDaySalesUgx, scale);
    const monthlySalesTargetMinor = toMinorUnits(args.monthlySalesTargetUgx, scale);
    const monthlyExpenseWarningMinor = toMinorUnits(args.monthlyExpenseWarningUgx, scale);
    const currencySensitiveDataExists = await hasCurrencySensitiveData(ctx, current.business._id);
    const ledgerActivityExists = await hasPostedLedgerActivity(ctx, current.business._id);
    const balances = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id)).take(2);
    const hasNonOpeningBalance = balances.some(b => b.balanceUgx !== (b.openingBalanceUgx ?? 0));
    if (args.currency !== current.business.currency && (currencySensitiveDataExists || hasNonOpeningBalance || balances.some(b => (b.openingBalanceUgx ?? 0) !== 0))) {
      throw new Error("Currency is locked after any financial record or opening balance so existing amounts are never relabelled. Contact support for a reviewed currency migration.");
    }
    const businessPatch = {
      name: businessName, countryCode: args.countryCode, currency: args.currency,
      timezone: args.timezone, weekStartsOn: args.weekStartsOn,
    };
    await ctx.db.patch("businesses", current.business._id, businessPatch);
    const currentBalances = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id)).take(2);
    const cashDoc = currentBalances.find(b => b.account === "cash");
    const mobileDoc = currentBalances.find(b => b.account === "mobile_money");
    if ((ledgerActivityExists || hasNonOpeningBalance) && (cashOpeningMinor !== (cashDoc?.openingBalanceUgx ?? 0) || mobileOpeningMinor !== (mobileDoc?.openingBalanceUgx ?? 0))) {
      throw new Error("Opening balances are locked after the first transaction. Use an auditable adjustment entry instead.");
    }
    if (!ledgerActivityExists && !hasNonOpeningBalance) {
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
    if (!current || current.membership.role !== "owner") return { access: "restricted" as const, rows: [] };
    const rows = await ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", current.business._id)).order("asc").take(5000);
    const scale = 10 ** (currencyMinorDigits(current.business.currency) ?? 0);
    return { access: "ready" as const, workspace: current.business.name, currency: current.business.currency, currencyMinorDigits: currencyMinorDigits(current.business.currency), rows: rows.map(({ occurredOn, kind, category, account, amountUgx, note, source, state, createdAt }) => ({ occurredOn, kind, category, account, amount: amountUgx / scale, currency: current.business.currency, note, source, state, createdAt })) };
  },
});

export const ruleReview = query({
  args: {},
  handler: async (ctx) => {
    const current = await activeWorkspace(ctx);
    if (!current || current.membership.role === "partner" || current.membership.role === "finance_approver") return { access: "restricted" as const, currency: "UGX", highExpenses: [], weakDays: [] };
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
    if (!current || current.membership.role === "partner" || current.membership.role === "finance_approver") return { access: "restricted" as const };
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
  args: {},
  handler: async (ctx) => {
    const current = await activeWorkspace(ctx);
    if (!current || current.membership.role !== "owner") return { access: "restricted" as const, members: [], invitations: [], audit: [] };
    const [memberships, invitations, audit, partners] = await Promise.all([
      ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", current.business._id)).take(100),
      ctx.db.query("invitations").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(100),
      ctx.db.query("auditEvents").withIndex("by_business_and_time", q => q.eq("businessId", current.business._id)).order("desc").take(20),
      ctx.db.query("partners").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(100),
    ]);
    const partnerNames = new Map(partners.map(partner => [partner._id, partner.name]));
    const members = await Promise.all(memberships.map(async m => {
      const user = await ctx.db.get("users", m.userId);
      return { id: m._id, role: m.role, partnerId: m.partnerId, partnerName: m.partnerId ? partnerNames.get(m.partnerId) : undefined, active: m.active, email: user?.email ?? "Signed-in user", emailVerified: typeof user?.emailVerificationTime === "number", createdAt: m.createdAt };
    }));
    return { access: "ready" as const, members, partners: partners.map(({ _id, name }) => ({ id: _id, name })), invitations: invitations.map(i => ({ id: i._id, email: i.email, role: i.role, partnerName: i.partnerId ? partnerNames.get(i.partnerId) : undefined, expiresAt: i.expiresAt })), audit: audit.map(a => ({ id: a._id, action: a.action, summary: a.summary, occurredAt: a.occurredAt })) };
  },
});

export const invite = mutation({
  args: { email: v.string(), role, partnerId: v.optional(v.id("partners")) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only the workspace owner can invite people.");
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
    if (args.role === "owner") throw new Error("Invite a partner, cashier, or finance approver. The owner role is assigned during workspace setup.");
    if (args.role === "partner") {
      if (!args.partnerId) throw new Error("Choose the partner account this Google sign-in will represent.");
      const partner = await ctx.db.get("partners", args.partnerId);
      if (!partner || partner.businessId !== current.business._id || !partner.active) throw new Error("Choose an active partner from this workspace.");
      const linkedMember = await ctx.db.query("memberships").withIndex("by_business_and_partner_and_active", q => q.eq("businessId", current.business._id).eq("partnerId", args.partnerId).eq("active", true)).first();
      if (linkedMember) throw new Error("This partner already has an active login.");
      const existingInvite = await ctx.db.query("invitations").withIndex("by_business_and_partner_and_active", q => q.eq("businessId", current.business._id).eq("partnerId", args.partnerId).eq("active", true)).first();
      if (existingInvite) throw new Error("This partner already has a pending invitation.");
    } else if (args.partnerId) throw new Error("Only partner invitations can be linked to a partner record.");
    const pending = await ctx.db.query("invitations").withIndex("by_business_and_active", q => q.eq("businessId", current.business._id).eq("active", true)).take(100);
    if (pending.some(i => i.email.toLowerCase() === email)) throw new Error("An active invitation already exists for this email.");
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    const token = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
    const now = Date.now();
    await ctx.db.insert("invitations", { email, role: args.role, partnerId: args.partnerId, businessId: current.business._id, invitedBy: current.userId, expiresAt: now + 7 * 24 * 60 * 60 * 1000, active: true, tokenHash });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "member.invited", entityType: "invitation", entityId: email, occurredAt: now, summary: `Invited ${email} as ${args.role}.` });
    return token;
  },
});

export const revokeInvite = mutation({
  args: { invitationId: v.id("invitations") }, returns: v.null(),
  handler: async (ctx, { invitationId }) => {
    const current = await activeWorkspace(ctx);
    const invite = await ctx.db.get("invitations", invitationId);
    if (!current || current.membership.role !== "owner" || !invite || invite.businessId !== current.business._id) throw new Error("Invitation not found or access denied.");
    await ctx.db.patch("invitations", invitationId, { active: false });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "invitation.revoked", entityType: "invitation", entityId: invitationId, occurredAt: Date.now(), summary: `Revoked invitation for ${invite.email}.` });
    return null;
  },
});

export const updateMember = mutation({
  args: { membershipId: v.id("memberships"), role, partnerId: v.optional(v.id("partners")), active: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    const member = await ctx.db.get("memberships", args.membershipId);
    if (!current || current.membership.role !== "owner" || !member || member.businessId !== current.business._id) throw new Error("Member not found or access denied.");
    if (member.role === "owner" || args.role === "owner") throw new Error("Owner access cannot be changed here. Use the verified ownership transfer process.");
    if (member.userId === current.userId && !args.active) throw new Error("You cannot deactivate your own account.");
    let partnerId: Id<"partners"> | undefined;
    if (args.role === "partner" && args.active) {
      if (!args.partnerId) throw new Error("Choose the partner account this member will represent.");
      const partner = await ctx.db.get("partners", args.partnerId);
      if (!partner || partner.businessId !== current.business._id || !partner.active) throw new Error("Choose an active partner from this workspace.");
      const linkedMembers = await ctx.db.query("memberships").withIndex("by_business_and_partner_and_active", q => q.eq("businessId", current.business._id).eq("partnerId", args.partnerId).eq("active", true)).take(2);
      if (linkedMembers.some(other => other._id !== member._id)) throw new Error("This partner already has an active login.");
      partnerId = args.partnerId;
    } else if (args.role === "partner") {
      partnerId = args.partnerId ?? member.partnerId;
    } else if (args.partnerId) throw new Error("Only partner accounts can be linked to a partner record.");
    await ctx.db.patch("memberships", args.membershipId, { role: args.role, partnerId, active: args.active });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "member.access.updated", entityType: "membership", entityId: args.membershipId, occurredAt: Date.now(), summary: `Changed a member to ${args.role}${partnerId ? ` linked to ${partnerId}` : ""} (${args.active ? "active" : "inactive"}).` });
    return null;
  },
});

export const transferOwnership = mutation({
  args: { membershipId: v.id("memberships"), expectedEmail: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await activeWorkspace(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only the current workspace owner can transfer ownership.");
    const target = await ctx.db.get("memberships", args.membershipId);
    if (!target || target.businessId !== current.business._id || !target.active || target.role === "owner" || target.role === "partner" || target.userId === current.userId) throw new Error("Choose another active cashier or finance approver.");
    const targetUser = await ctx.db.get("users", target.userId);
    const actualEmail = targetUser?.email?.trim().toLowerCase();
    if (!actualEmail || typeof targetUser?.emailVerificationTime !== "number") throw new Error("Ownership can only be transferred to an account with a verified email address.");
    if (args.expectedEmail.trim().toLowerCase() !== actualEmail) throw new Error("The confirmed email does not match this member's verified account.");
    const reason = args.reason.trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Enter a transfer reason between 5 and 300 characters.");
    const now = Date.now();
    await ctx.db.patch("memberships", target._id, { role: "owner", partnerId: undefined });
    await ctx.db.patch("memberships", current.membership._id, { role: "cashier", partnerId: undefined });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "workspace.owner_transferred", entityType: "membership", entityId: target._id, occurredAt: now, summary: `Workspace ownership transferred to ${actualEmail}; prior owner retained cashier access.`, details: JSON.stringify({ previousOwnerMembershipId: current.membership._id, newOwnerMembershipId: target._id, targetEmail: actualEmail, reason }) });
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
    if ((invite.role === "partner") !== Boolean(invite.partnerId)) throw new Error("This partner invitation needs to be reviewed by the workspace owner before it can be accepted.");
    if (invite.partnerId) {
      const partner = await ctx.db.get("partners", invite.partnerId);
      if (!partner || partner.businessId !== invite.businessId || !partner.active) throw new Error("This partner account is no longer active. Ask the workspace owner for a new invitation.");
    }
    const existing = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", invite.businessId).eq("userId", userId)).unique();
    if (existing?.active) throw new Error("You already have access to this workspace.");
    const currentMemberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(20);
    if (currentMemberships.length === 20) throw new Error("This account has too many workspace memberships to activate another. Contact an owner for help.");
    if (currentMemberships.some(membership => membership.active && membership.businessId !== invite.businessId)) {
      throw new Error("This account already has an active workspace. Sign in with another account or ask the current workspace owner to deactivate your access first.");
    }
    if (invite.partnerId) {
      const linkedMember = await ctx.db.query("memberships").withIndex("by_business_and_partner_and_active", q => q.eq("businessId", invite.businessId).eq("partnerId", invite.partnerId).eq("active", true)).first();
      if (linkedMember && linkedMember.userId !== userId) throw new Error("This partner account is already linked. Ask the workspace owner to review access.");
    }
    if (existing) await ctx.db.patch("memberships", existing._id, { active: true, role: invite.role, partnerId: invite.partnerId });
    else await ctx.db.insert("memberships", { businessId: invite.businessId, userId, role: invite.role, partnerId: invite.partnerId, active: true, createdAt: Date.now() });
    await ctx.db.patch("invitations", invite._id, { active: false, acceptedAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: invite.businessId, actorId: userId, action: "invitation.accepted", entityType: "invitation", entityId: invite._id, occurredAt: Date.now(), summary: `${user.email} accepted a workspace invitation.` });
    return null;
  },
});
