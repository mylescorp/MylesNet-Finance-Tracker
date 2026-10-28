import { getAuthUserId } from "@convex-dev/auth/server";
import { env } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getSelectedWorkspace, listUserWorkspaces } from "./workspaceContext";

function addSafeInteger(left: number, right: number, label: string) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} cannot be represented safely.`);
  }
  return result;
}

function formatAmount(amountMinor: number, currency: string) {
  let digits = 0;
  try { digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 0; } catch { /* unsupported currency is rejected before it is stored */ }
  return `${new Intl.NumberFormat("en", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amountMinor / 10 ** digits)} ${currency}`;
}

const accessResult = v.union(
  v.object({ access: v.literal("setup") }),
  v.object({ access: v.literal("pending") }),
  v.object({ access: v.literal("choose_workspace"), workspaces: v.array(v.object({ businessId: v.id("businesses"), businessName: v.string(), role: v.union(v.literal("owner"), v.literal("partner"), v.literal("cashier"), v.literal("finance_approver")) })) }),
  v.object({
    access: v.literal("ready"),
    businessId: v.id("businesses"),
    businessName: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("partner"),
      v.literal("cashier"),
      v.literal("finance_approver"),
    ),
    workspaces: v.array(v.object({ businessId: v.id("businesses"), businessName: v.string(), role: v.union(v.literal("owner"), v.literal("partner"), v.literal("cashier"), v.literal("finance_approver")) })),
  }),
);

async function getMembership(ctx: QueryCtx | MutationCtx, businessId?: Id<"businesses">) {
  if (!businessId) return await getSelectedWorkspace(ctx);
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  if (!membership?.active) return null;
  const business = await ctx.db.get("businesses", businessId);
  return business ? { userId, membership, business } : null;
}

async function applyAccountEffect(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  account: "cash" | "mobile_money",
  deltaUgx: number,
) {
  const current = await ctx.db
    .query("accountBalances")
    .withIndex("by_business_and_account", (q) =>
      q.eq("businessId", businessId).eq("account", account),
    )
    .unique();
  const updatedAt = Date.now();
  if (current) {
    await ctx.db.patch("accountBalances", current._id, {
      balanceUgx: addSafeInteger(
        current.balanceUgx,
        deltaUgx,
        "Account balance",
      ),
      updatedAt,
    });
  } else {
    await ctx.db.insert("accountBalances", {
      businessId,
      account,
      balanceUgx: deltaUgx,
      updatedAt,
    });
  }
}

export const claimFirstOwner = mutation({
  args: { businessName: v.string(), setupCode: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in before setting up the workspace.");
    const setupCode = env.OWNER_SETUP_CODE;
    if (!setupCode || args.setupCode.length < 32 || args.setupCode !== setupCode) {
      throw new Error("Workspace setup is not available. Ask the administrator to configure the one-time owner setup code.");
    }
    const businesses = await ctx.db.query("businesses").take(1);
    if (businesses.length > 0) throw new Error("An owner has already set up this workspace.");
    const name = args.businessName.trim();
    if (name.length < 2 || name.length > 100) throw new Error("Enter a workspace name using 2 to 100 characters.");
    const now = Date.now();
    const businessId = await ctx.db.insert("businesses", {
      name,
      currency: "UGX",
      countryCode: "UG",
      timezone: "Africa/Kampala",
      weekStartsOn: "monday",
      createdBy: userId,
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      businessId,
      userId,
      role: "owner",
      active: true,
      createdAt: now,
    });
    await ctx.db.insert("auditEvents", {
      businessId,
      actorId: userId,
      action: "workspace.created",
      entityType: "business",
      entityId: businessId,
      occurredAt: now,
      summary: `Initial workspace created: ${name}`,
    });
    return null;
  },
});

function isIsoDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export const currentAccess = query({
  args: {},
  returns: accessResult,
  handler: async (ctx) => {
    const current = await getMembership(ctx);
    if (!current) {
      const userId = await getAuthUserId(ctx);
      if (userId) {
        const workspaces = await listUserWorkspaces(ctx, userId);
        if (workspaces.length > 1) return { access: "choose_workspace" as const, workspaces };
      }
      const businesses = await ctx.db.query("businesses").take(1);
      return { access: businesses.length === 0 ? "setup" as const : "pending" as const };
    }
    const workspaces = await listUserWorkspaces(ctx, current.userId);
    return {
      access: "ready" as const,
      businessId: current.business._id,
      businessName: current.business.name,
      role: current.membership.role,
      workspaces,
    };
  },
});

export const selectWorkspace = mutation({
  args: { businessId: v.id("businesses") },
  returns: v.null(),
  handler: async (ctx, { businessId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in before switching workspaces.");
    const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
    if (!membership?.active) throw new Error("This account does not have active access to that workspace.");
    const business = await ctx.db.get("businesses", businessId);
    if (!business) throw new Error("Workspace not found.");
    const prior = await ctx.db.query("workspaceSelections").withIndex("by_user", q => q.eq("userId", userId)).unique();
    const now = Date.now();
    if (prior) await ctx.db.patch("workspaceSelections", prior._id, { businessId, selectedAt: now });
    else await ctx.db.insert("workspaceSelections", { userId, businessId, selectedAt: now });
    await ctx.db.insert("auditEvents", { businessId, actorId: userId, action: "workspace.selected", entityType: "business", entityId: businessId, occurredAt: now, summary: `Switched active workspace to ${business.name}.` });
    return null;
  },
});

export const businessSettings = query({
  args: {},
  returns: v.union(
    v.object({ access: v.literal("setup") }),
    v.object({ access: v.literal("pending") }),
    v.object({
      access: v.literal("ready"),
      businessId: v.id("businesses"),
      businessName: v.string(),
      countryCode: v.string(),
      currency: v.string(),
      timezone: v.string(),
      weekStartsOn: v.union(v.literal("monday"), v.literal("sunday")),
      role: v.union(v.literal("owner"), v.literal("partner"), v.literal("cashier"), v.literal("finance_approver")),
    }),
  ),
  handler: async (ctx) => {
    const current = await getMembership(ctx);
    if (!current) {
      const businesses = await ctx.db.query("businesses").take(1);
      return { access: businesses.length === 0 ? "setup" as const : "pending" as const };
    }
    return {
      access: "ready" as const,
      businessId: current.business._id,
      businessName: current.business.name,
      countryCode: current.business.countryCode ?? "UG",
      currency: current.business.currency,
      timezone: current.business.timezone,
      weekStartsOn: current.business.weekStartsOn ?? "monday",
      role: current.membership.role,
    };
  },
});

export const updateBusinessSettings = mutation({
  args: {
    businessId: v.id("businesses"),
    businessName: v.string(),
    timezone: v.string(),
    weekStartsOn: v.union(v.literal("monday"), v.literal("sunday")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx, args.businessId);
    if (!current || current.membership.role !== "owner") {
      throw new Error("Only a workspace owner can change general settings.");
    }
    const businessName = args.businessName.trim();
    const timezone = args.timezone.trim();
    if (businessName.length < 2 || businessName.length > 100) {
      throw new Error("Workspace name must be between 2 and 100 characters.");
    }
    if (timezone.length < 3 || timezone.length > 100) {
      throw new Error("Enter a valid IANA timezone, such as Africa/Kampala.");
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    } catch {
      throw new Error("Enter a valid IANA timezone, such as Africa/Kampala.");
    }

    const changed: string[] = [];
    const details: Record<string, { before: string; after: string }> = {};
    if (businessName !== current.business.name) {
      changed.push("workspace name");
      details.businessName = { before: current.business.name, after: businessName };
    }
    if (timezone !== current.business.timezone) {
      changed.push("reporting timezone");
      details.timezone = { before: current.business.timezone, after: timezone };
    }
    const weekStartsOn = current.business.weekStartsOn ?? "monday";
    if (args.weekStartsOn !== weekStartsOn) {
      changed.push("week start");
      details.weekStartsOn = { before: weekStartsOn, after: args.weekStartsOn };
    }
    if (changed.length === 0) return null;

    await ctx.db.patch("businesses", current.business._id, {
      name: businessName,
      timezone,
      weekStartsOn: args.weekStartsOn,
    });
    await ctx.db.insert("auditEvents", {
      businessId: current.business._id,
      actorId: current.userId,
      action: "business.settings.updated",
      entityType: "business",
      entityId: current.business._id,
      occurredAt: Date.now(),
      summary: `Updated ${changed.join(", ")}.`,
      details: JSON.stringify(details),
    });
    return null;
  },
});

export const balanceAdjustments = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({
    _id: v.id("balanceAdjustments"), account: v.union(v.literal("cash"), v.literal("mobile_money")), countedBalanceUgx: v.number(), deltaUgx: v.number(), occurredOn: v.string(), note: v.string(), state: v.union(v.literal("posted"), v.literal("void")), voidReason: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx);
    if (!current || current.membership.role !== "owner") throw new Error("Only workspace owners can view balance adjustment history.");
    const result = await ctx.db.query("balanceAdjustments").withIndex("by_business_and_created_at", q => q.eq("businessId", current.business._id)).order("desc").paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(({ _id, account, countedBalanceUgx, deltaUgx, occurredOn, note, state, voidReason }) => ({ _id, account, countedBalanceUgx, deltaUgx, occurredOn, note, state, voidReason })),
    };
  },
});

export const createBalanceAdjustment = mutation({
  args: { businessId: v.id("businesses"), account: v.union(v.literal("cash"), v.literal("mobile_money")), countedBalanceUgx: v.number(), occurredOn: v.string(), note: v.string() },
  returns: v.id("balanceAdjustments"),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx, args.businessId);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can adjust account balances.");
    if (!Number.isSafeInteger(args.countedBalanceUgx) || args.countedBalanceUgx < 0) throw new Error("Enter a valid non-negative counted balance.");
    if (!isIsoDay(args.occurredOn)) throw new Error("Choose a valid adjustment date.");
    const note = args.note.trim();
    if (note.length < 3 || note.length > 300) throw new Error("Explain the balance adjustment in 3 to 300 characters.");
    const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", args.account)).unique();
    const before = balance?.balanceUgx ?? 0;
    const deltaUgx = addSafeInteger(args.countedBalanceUgx, -before, "Balance adjustment");
    await applyAccountEffect(ctx, current.business._id, args.account, deltaUgx);
    const now = Date.now();
    const id = await ctx.db.insert("balanceAdjustments", { businessId: current.business._id, account: args.account, countedBalanceUgx: args.countedBalanceUgx, deltaUgx, occurredOn: args.occurredOn, note, state: "posted", createdBy: current.userId, createdAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "balance.adjustment_created", entityType: "balanceAdjustment", entityId: id, occurredAt: now, summary: `${args.account} balance counted as ${formatAmount(args.countedBalanceUgx, current.business.currency)} · adjustment ${formatAmount(Math.abs(deltaUgx), current.business.currency)}${deltaUgx < 0 ? " decrease" : " increase"}.`, details: JSON.stringify({ previousBalanceUgx: before, countedBalanceUgx: args.countedBalanceUgx, deltaUgx, occurredOn: args.occurredOn, note }) });
    return id;
  },
});

export const updateBalanceAdjustment = mutation({
  args: { businessId: v.id("businesses"), adjustmentId: v.id("balanceAdjustments"), account: v.union(v.literal("cash"), v.literal("mobile_money")), countedBalanceUgx: v.number(), occurredOn: v.string(), note: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx, args.businessId);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can edit balance adjustments.");
    const adjustment = await ctx.db.get("balanceAdjustments", args.adjustmentId);
    if (!adjustment || adjustment.businessId !== current.business._id) throw new Error("Balance adjustment not found.");
    if (adjustment.state !== "posted") throw new Error("Voided adjustments cannot be edited.");
    if (adjustment.account !== args.account) throw new Error("The account for a saved count cannot be changed. Record a new count for another account, then remove this one with a reason.");
    if (!Number.isSafeInteger(args.countedBalanceUgx) || args.countedBalanceUgx < 0) throw new Error("Enter a valid non-negative counted balance.");
    if (!isIsoDay(args.occurredOn)) throw new Error("Choose a valid adjustment date.");
    const note = args.note.trim();
    if (note.length < 3 || note.length > 300) throw new Error("Explain the balance adjustment in 3 to 300 characters.");
    const nextDelta = addSafeInteger(adjustment.deltaUgx, args.countedBalanceUgx - adjustment.countedBalanceUgx, "Balance adjustment");
    await applyAccountEffect(ctx, current.business._id, args.account, addSafeInteger(nextDelta, -adjustment.deltaUgx, "Balance adjustment"));
    const now = Date.now();
    await ctx.db.patch("balanceAdjustments", adjustment._id, { account: args.account, countedBalanceUgx: args.countedBalanceUgx, deltaUgx: nextDelta, occurredOn: args.occurredOn, note, updatedAt: now });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "balance.adjustment_updated", entityType: "balanceAdjustment", entityId: adjustment._id, occurredAt: now, summary: `Updated ${adjustment.account} balance adjustment to ${args.account} · counted ${formatAmount(args.countedBalanceUgx, current.business.currency)}.`, details: JSON.stringify({ before: { account: adjustment.account, countedBalanceUgx: adjustment.countedBalanceUgx, deltaUgx: adjustment.deltaUgx, occurredOn: adjustment.occurredOn, note: adjustment.note }, after: { account: args.account, countedBalanceUgx: args.countedBalanceUgx, deltaUgx: nextDelta, occurredOn: args.occurredOn, note } }) });
    return null;
  },
});

export const voidBalanceAdjustment = mutation({
  args: { businessId: v.id("businesses"), adjustmentId: v.id("balanceAdjustments"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx, args.businessId);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can remove balance adjustments.");
    const adjustment = await ctx.db.get("balanceAdjustments", args.adjustmentId);
    if (!adjustment || adjustment.businessId !== current.business._id) throw new Error("Balance adjustment not found.");
    if (adjustment.state === "void") return null;
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 300) throw new Error("Explain why this adjustment is being removed.");
    await applyAccountEffect(ctx, current.business._id, adjustment.account, -adjustment.deltaUgx);
    const now = Date.now();
    await ctx.db.patch("balanceAdjustments", adjustment._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: reason });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "balance.adjustment_voided", entityType: "balanceAdjustment", entityId: adjustment._id, occurredAt: now, summary: reason, details: JSON.stringify({ reversedDeltaUgx: -adjustment.deltaUgx }) });
    return null;
  },
});

export const dashboardSummary = query({
  args: {
    from: v.string(),
    toExclusive: v.string(),
  },
  returns: v.union(
    v.object({ access: v.literal("setup") }),
    v.object({ access: v.literal("pending") }),
    v.object({ access: v.literal("restricted") }),
    v.object({
      access: v.literal("ready"),
      salesUgx: v.number(),
      expensesUgx: v.number(),
      netUgx: v.number(),
      cashBalanceUgx: v.number(),
      mobileMoneyBalanceUgx: v.number(),
      days: v.array(
        v.object({
          day: v.string(),
          salesUgx: v.number(),
          expensesUgx: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    if (
      !isIsoDay(args.from) ||
      !isIsoDay(args.toExclusive) ||
      args.from >= args.toExclusive
    ) {
      throw new Error("Choose a valid date range.");
    }
    const rangeDays =
      (Date.parse(`${args.toExclusive}T00:00:00.000Z`) -
        Date.parse(`${args.from}T00:00:00.000Z`)) /
      86_400_000;
    if (rangeDays > 370) throw new Error("Choose a reporting period of 370 days or less.");
    const current = await getMembership(ctx);
    if (!current) {
      const businesses = await ctx.db.query("businesses").take(1);
      return { access: businesses.length === 0 ? "setup" as const : "pending" as const };
    }
    // Partner statement data is not yet linked to partner-specific ledger rows.
    // Hide business-wide finance totals until that scope is implemented.
    if (current.membership.role === "partner" || current.membership.role === "finance_approver") return { access: "restricted" as const };
    const days = await ctx.db
      .query("dailyTotals")
      .withIndex("by_business_and_day", (q) =>
        q
          .eq("businessId", current.business._id)
          .gte("day", args.from)
          .lt("day", args.toExclusive),
      )
      .take(370);
    const salesUgx = days.reduce(
      (sum, day) => addSafeInteger(sum, day.salesUgx, "Sales total"),
      0,
    );
    const expensesUgx = days.reduce(
      (sum, day) => addSafeInteger(sum, day.expensesUgx, "Expenses total"),
      0,
    );
    const balances = await ctx.db
      .query("accountBalances")
      .withIndex("by_business_and_account", (q) =>
        q.eq("businessId", current.business._id),
      )
      .take(2);
    const cashBalanceUgx =
      balances.find((balance) => balance.account === "cash")?.balanceUgx ?? 0;
    const mobileMoneyBalanceUgx =
      balances.find((balance) => balance.account === "mobile_money")?.balanceUgx ?? 0;
    return {
      access: "ready" as const,
      salesUgx,
      expensesUgx,
      netUgx: salesUgx - expensesUgx,
      cashBalanceUgx,
      mobileMoneyBalanceUgx,
      days: days.map(({ day, salesUgx, expensesUgx }) => ({
        day,
        salesUgx,
        expensesUgx,
      })),
    };
  },
});

export const balanceOverview = query({
  args: { day: v.string() },
  returns: v.union(
    v.object({ access: v.literal("setup") }),
    v.object({ access: v.literal("pending") }),
    v.object({ access: v.literal("restricted") }),
    v.object({
      access: v.literal("ready"),
      currency: v.string(),
      day: v.string(),
      cashBalanceUgx: v.number(),
      mobileMoneyBalanceUgx: v.number(),
      salesUgx: v.number(),
      centipidMobileUgx: v.number(),
      centipidVoucherUgx: v.number(),
      mobileSalesUgx: v.number(),
      cashEstimateComplete: v.boolean(),
      estimatedCashSalesUgx: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    if (!isIsoDay(args.day)) throw new Error("Choose a valid business date.");
    const current = await getMembership(ctx);
    if (!current) {
      const businesses = await ctx.db.query("businesses").take(1);
      return { access: businesses.length === 0 ? "setup" as const : "pending" as const };
    }
    if (current.membership.role === "partner") return { access: "restricted" as const };
    const [day, balances, dailyEntries] = await Promise.all([
      ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", args.day)).unique(),
      ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id)).take(2),
      ctx.db.query("entries").withIndex("by_business_and_date", q => q.eq("businessId", current.business._id).eq("occurredOn", args.day)).take(1001),
    ]);
    const salesUgx = day?.salesUgx ?? 0;
    const postedSales = dailyEntries.filter(entry => entry.state === "posted" && entry.kind === "sale");
    const mobileSalesUgx = postedSales.filter(entry => entry.account === "mobile_money").reduce((total, entry) => addSafeInteger(total, entry.amountUgx, "Daily mobile sales"), 0);
    const centipidMobileUgx = postedSales.filter(entry => entry.source === "webhook" && entry.account === "mobile_money").reduce((total, entry) => addSafeInteger(total, entry.amountUgx, "Centipid mobile total"), 0);
    const centipidVoucherUgx = postedSales.filter(entry => entry.source === "webhook" && entry.account === "cash").reduce((total, entry) => addSafeInteger(total, entry.amountUgx, "Centipid voucher total"), 0);
    return {
      access: "ready" as const,
      currency: current.business.currency,
      day: args.day,
      cashBalanceUgx: balances.find(balance => balance.account === "cash")?.balanceUgx ?? 0,
      mobileMoneyBalanceUgx: balances.find(balance => balance.account === "mobile_money")?.balanceUgx ?? 0,
      salesUgx,
      centipidMobileUgx,
      centipidVoucherUgx,
      mobileSalesUgx,
      cashEstimateComplete: dailyEntries.length <= 1000,
      estimatedCashSalesUgx: salesUgx - mobileSalesUgx,
    };
  },
});

export const recentEntries = query({
  args: { limit: v.optional(v.number()), kind: v.optional(v.union(v.literal("sale"), v.literal("expense"))), from: v.optional(v.string()), toExclusive: v.optional(v.string()) },
  returns: v.array(
    v.object({
      _id: v.id("entries"),
      kind: v.union(v.literal("sale"), v.literal("expense")),
      amountUgx: v.number(),
      occurredOn: v.string(),
      account: v.union(v.literal("cash"), v.literal("mobile_money"), v.literal("unallocated")),
      category: v.string(),
      note: v.string(),
      state: v.union(v.literal("posted"), v.literal("void")),
      canVoid: v.boolean(),
      canCorrect: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx);
    if (!current) return [];
    if (current.membership.role === "partner" || current.membership.role === "finance_approver") return [];
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 10), 500));
    if ((args.from && !isIsoDay(args.from)) || (args.toExclusive && !isIsoDay(args.toExclusive)) || (args.from && args.toExclusive && args.from >= args.toExclusive)) throw new Error("Choose a valid entry date range.");
    const rows = args.kind
      ? await ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q =>
        args.from && args.toExclusive ? q.eq("businessId", current.business._id).eq("kind", args.kind!).gte("occurredOn", args.from).lt("occurredOn", args.toExclusive)
          : args.from ? q.eq("businessId", current.business._id).eq("kind", args.kind!).gte("occurredOn", args.from)
          : args.toExclusive ? q.eq("businessId", current.business._id).eq("kind", args.kind!).lt("occurredOn", args.toExclusive)
          : q.eq("businessId", current.business._id).eq("kind", args.kind!)).order("desc").take(limit)
      : await ctx.db.query("entries").withIndex("by_business_and_date", q =>
        args.from && args.toExclusive ? q.eq("businessId", current.business._id).gte("occurredOn", args.from).lt("occurredOn", args.toExclusive)
          : args.from ? q.eq("businessId", current.business._id).gte("occurredOn", args.from)
          : args.toExclusive ? q.eq("businessId", current.business._id).lt("occurredOn", args.toExclusive)
          : q.eq("businessId", current.business._id)).order("desc").take(limit);
    return rows.map(({ _id, kind, amountUgx, occurredOn, account, category, note, state, operationSource, source, correctedBy }) => ({
      _id,
      kind,
      amountUgx,
      occurredOn,
      account,
      category,
      note,
      state,
      canVoid: !operationSource,
      canCorrect: source === "manual" && !operationSource && !correctedBy,
    }));
  },
});

export const searchEntries = query({
  args: { term: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.object({
    _id: v.id("entries"),
    kind: v.union(v.literal("sale"), v.literal("expense")),
    amountUgx: v.number(),
    occurredOn: v.string(),
    category: v.string(),
    note: v.string(),
  })),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx);
    const term = args.term.trim();
    if (!current || current.membership.role === "partner" || current.membership.role === "finance_approver" || term.length < 2 || term.length > 80) return [];
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 8), 12));
    const [notes, categories] = await Promise.all([
      ctx.db.query("entries").withSearchIndex("search_note", (q) => q.search("note", term).eq("businessId", current.business._id)).take(limit),
      ctx.db.query("entries").withSearchIndex("search_category", (q) => q.search("category", term).eq("businessId", current.business._id)).take(limit),
    ]);
    const unique = new Map([...notes, ...categories].map((entry) => [entry._id, entry]));
    return [...unique.values()]
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(({ _id, kind, amountUgx, occurredOn, category, note }) => ({ _id, kind, amountUgx, occurredOn, category, note }));
  },
});

const operationalKind = v.union(v.literal("movement"), v.literal("holding"), v.literal("loan"), v.literal("bill"));

export const operationalRecords = query({
  args: { kind: operationalKind },
  returns: v.array(v.object({
    _id: v.id("operationalRecords"), kind: operationalKind, title: v.string(), amountUgx: v.number(),
    occurredOn: v.string(), account: v.optional(v.union(v.literal("cash"), v.literal("mobile_money"))),
    destinationAccount: v.optional(v.union(v.literal("cash"), v.literal("mobile_money"))),
    movementType: v.optional(v.union(v.literal("transfer"), v.literal("withdrawal"))),
    cadence: v.optional(v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("annually"))),
    note: v.string(),
  })),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx);
    if (!current || current.membership.role === "partner" || current.membership.role === "finance_approver") return [];
    return (await ctx.db.query("operationalRecords").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", current.business._id).eq("kind", args.kind)).order("desc").take(200))
      .map(({ _id, kind, title, amountUgx, occurredOn, account, destinationAccount, movementType, cadence, note }) => ({ _id, kind, title, amountUgx, occurredOn, account, destinationAccount, movementType, cadence, note }));
  },
});

export const createOperationalRecord = mutation({
  args: {
    businessId: v.id("businesses"),
    kind: operationalKind, title: v.string(), amountUgx: v.number(), occurredOn: v.string(),
    account: v.optional(v.union(v.literal("cash"), v.literal("mobile_money"))),
    destinationAccount: v.optional(v.union(v.literal("cash"), v.literal("mobile_money"))),
    movementType: v.optional(v.union(v.literal("transfer"), v.literal("withdrawal"))),
    cadence: v.optional(v.union(v.literal("weekly"), v.literal("monthly"), v.literal("quarterly"), v.literal("annually"))),
    note: v.string(), idempotencyKey: v.string(),
  },
  returns: v.id("operationalRecords"),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx, args.businessId);
    if (!current || (current.membership.role !== "owner" && current.membership.role !== "cashier")) throw new Error("Only an owner or cashier can save this record.");
    if (!isIsoDay(args.occurredOn)) throw new Error("Choose a valid business date.");
    if (!Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0) throw new Error(`Amount must be a positive whole minor-unit amount in ${current.business.currency}.`);
    const title = args.title.trim();
    const note = args.note.trim();
    if (title.length < 2 || title.length > 100 || note.length > 300) throw new Error("Enter a title of 2–100 characters and a note of at most 300 characters.");
    if (args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("This request could not be verified. Try again.");
    const existing = await ctx.db.query("operationalRecords").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existing) {
      const isSameRequest = existing.kind === args.kind && existing.title === title && existing.amountUgx === args.amountUgx && existing.occurredOn === args.occurredOn && existing.account === args.account && existing.destinationAccount === args.destinationAccount && existing.movementType === args.movementType && existing.cadence === args.cadence && existing.note === note;
      if (!isSameRequest) throw new Error("This request key was already used for another record.");
      return existing._id;
    }
    if (args.kind === "movement") {
      if (!args.account || !args.movementType || (args.movementType === "transfer" && (!args.destinationAccount || args.destinationAccount === args.account))) throw new Error("Choose a source account and a different destination for transfers.");
      const source = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", args.account!)).unique();
      if (args.movementType === "withdrawal" && (source?.balanceUgx ?? 0) < args.amountUgx) throw new Error("The withdrawal is larger than the available account balance.");
      if (args.movementType === "withdrawal") {
        if (source) await ctx.db.patch("accountBalances", source._id, { balanceUgx: addSafeInteger(source.balanceUgx, -args.amountUgx, "Account balance"), updatedAt: Date.now() });
      } else {
        const destination = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", args.destinationAccount!)).unique();
        if ((source?.balanceUgx ?? 0) < args.amountUgx) throw new Error("The transfer is larger than the available source balance.");
        if (source) await ctx.db.patch("accountBalances", source._id, { balanceUgx: addSafeInteger(source.balanceUgx, -args.amountUgx, "Account balance"), updatedAt: Date.now() });
        if (destination) await ctx.db.patch("accountBalances", destination._id, { balanceUgx: addSafeInteger(destination.balanceUgx, args.amountUgx, "Account balance"), updatedAt: Date.now() });
        else await ctx.db.insert("accountBalances", { businessId: current.business._id, account: args.destinationAccount!, balanceUgx: args.amountUgx, updatedAt: Date.now() });
      }
    }
    if (args.kind === "bill" && !args.cadence) throw new Error("Choose how often this bill recurs.");
    const id = await ctx.db.insert("operationalRecords", { ...args, title, note, businessId: current.business._id, createdBy: current.userId, createdAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: `record.${args.kind}.created`, entityType: args.kind, entityId: id, occurredAt: Date.now(), summary: `Created ${args.kind} record: ${title}.` });
    return id;
  },
});

export const createEntry = mutation({
  args: {
    businessId: v.id("businesses"),
    kind: v.union(v.literal("sale"), v.literal("expense")),
    amountUgx: v.number(),
    occurredOn: v.string(),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    category: v.string(),
    note: v.string(),
    idempotencyKey: v.string(),
    confirmPossibleDuplicate: v.optional(v.boolean()),
    confirmNegativeBalance: v.optional(v.boolean()),
  },
  returns: v.id("entries"),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx, args.businessId);
    if (!current) throw new Error("Access is pending. Ask an owner for an invitation.");
    if (current.membership.role !== "owner" && current.membership.role !== "cashier") throw new Error("This account cannot add ledger entries.");
    if (!Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0) {
      throw new Error(`Amount must be a positive valid amount in ${current.business.currency}.`);
    }
    if (!isIsoDay(args.occurredOn)) throw new Error("Choose a valid date.");
    if (args.category.trim().length < 1 || args.category.length > 80) {
      throw new Error("Enter a category using 1 to 80 characters.");
    }
    if (args.note.length > 300) throw new Error("Notes can be up to 300 characters.");
    const preferences = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    if (preferences?.requireEntryNote && !args.note.trim()) throw new Error("Add a note before saving. This workspace requires a note on each entry.");
    if (args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) {
      throw new Error("Entry request is invalid. Please try again.");
    }

    const duplicate = await ctx.db
      .query("entries")
      .withIndex("by_business_and_idempotency", (q) =>
        q
          .eq("businessId", current.business._id)
          .eq("idempotencyKey", args.idempotencyKey),
      )
      .unique();
    if (duplicate) {
      const sameRequest =
        duplicate.kind === args.kind &&
        duplicate.amountUgx === args.amountUgx &&
        duplicate.occurredOn === args.occurredOn &&
        duplicate.account === args.account &&
        duplicate.category === args.category.trim() &&
        duplicate.note === args.note.trim();
      if (!sameRequest) throw new Error("This request key was already used for another entry.");
      return duplicate._id;
    }

    const duplicateWindowDays = preferences?.duplicateWindowDays ?? 1;
    if (duplicateWindowDays > 0 && !args.confirmPossibleDuplicate) {
      const date = new Date(`${args.occurredOn}T00:00:00.000Z`);
      const from = new Date(date); from.setUTCDate(from.getUTCDate() - duplicateWindowDays);
      const to = new Date(date); to.setUTCDate(to.getUTCDate() + duplicateWindowDays);
      const possibleDuplicates = await ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q =>
        q.eq("businessId", current.business._id).eq("kind", args.kind)
          .gte("occurredOn", from.toISOString().slice(0, 10)).lte("occurredOn", to.toISOString().slice(0, 10)),
      ).take(100);
      const match = possibleDuplicates.find(entry => entry.state === "posted" && entry.account === args.account && entry.amountUgx === args.amountUgx && entry.category === args.category.trim());
      if (match) throw new ConvexError({ code: "CONFIRM_DUPLICATE", message: `Similar ${args.kind} from ${match.occurredOn} was recorded for ${args.category.trim()}. Review it before continuing.` });
    }

    const currentAccount = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", args.account)).unique();
    const accountDelta = args.kind === "sale" ? args.amountUgx : -args.amountUgx;
    if (preferences?.negativeBalanceWarning !== false && !args.confirmNegativeBalance && (currentAccount?.balanceUgx ?? 0) + accountDelta < 0) {
      throw new ConvexError({ code: "CONFIRM_NEGATIVE", message: `This entry will put ${args.account === "cash" ? "cash" : "mobile money"} below zero. Review the balance before continuing.` });
    }

    const now = Date.now();
    await applyAccountEffect(ctx, current.business._id, args.account, accountDelta);
    const entryId = await ctx.db.insert("entries", {
      businessId: current.business._id,
      kind: args.kind,
      amountUgx: args.amountUgx,
      occurredOn: args.occurredOn,
      account: args.account,
      category: args.category.trim(),
      note: args.note.trim(),
      source: "manual",
      idempotencyKey: args.idempotencyKey,
      state: "posted",
      createdBy: current.userId,
      createdAt: now,
    });
    const day = await ctx.db
      .query("dailyTotals")
      .withIndex("by_business_and_day", (q) =>
        q.eq("businessId", current.business._id).eq("day", args.occurredOn),
      )
      .unique();
    if (day) {
      await ctx.db.patch("dailyTotals", day._id, {
        salesUgx: addSafeInteger(
          day.salesUgx,
          args.kind === "sale" ? args.amountUgx : 0,
          "Daily sales total",
        ),
        expensesUgx: addSafeInteger(
          day.expensesUgx,
          args.kind === "expense" ? args.amountUgx : 0,
          "Daily expenses total",
        ),
        saleCount: addSafeInteger(
          day.saleCount,
          args.kind === "sale" ? 1 : 0,
          "Daily sale count",
        ),
        expenseCount: addSafeInteger(
          day.expenseCount,
          args.kind === "expense" ? 1 : 0,
          "Daily expense count",
        ),
      });
    } else {
      await ctx.db.insert("dailyTotals", {
        businessId: current.business._id,
        day: args.occurredOn,
        salesUgx: args.kind === "sale" ? args.amountUgx : 0,
        expensesUgx: args.kind === "expense" ? args.amountUgx : 0,
        saleCount: args.kind === "sale" ? 1 : 0,
        expenseCount: args.kind === "expense" ? 1 : 0,
      });
    }
    await ctx.db.insert("auditEvents", {
      businessId: current.business._id,
      actorId: current.userId,
      action: "entry.created",
      entityType: "entry",
      entityId: entryId,
      occurredAt: now,
      summary: `${args.kind} · ${formatAmount(args.amountUgx, current.business.currency)} · ${args.occurredOn}`,
    });
    if (args.confirmPossibleDuplicate || args.confirmNegativeBalance) {
      const confirmed = [args.confirmPossibleDuplicate && "possible duplicate", args.confirmNegativeBalance && "negative balance"].filter(Boolean).join(" and ");
      await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "entry.rule_override", entityType: "entry", entityId: entryId, occurredAt: now, summary: `Confirmed ${confirmed} warning before posting.` });
    }
    return entryId;
  },
});

export const voidEntry = mutation({
  args: { businessId: v.id("businesses"), entryId: v.id("entries"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx, args.businessId);
    if (!current || current.membership.role !== "owner") {
      throw new Error("Only an owner can void an entry.");
    }
    const entry = await ctx.db.get("entries", args.entryId);
    if (!entry || entry.businessId !== current.business._id) {
      throw new Error("Entry not found.");
    }
    if (entry.operationSource) {
      throw new Error("This expense was posted by a bill payment, loan repayment, or movement fee. It cannot be voided alone because its related account and schedule history would become inconsistent. A linked operational reversal workflow is required.");
    }
    if (entry.state === "void") return null;
    const reason = args.reason.trim();
    if (reason.length < 3 || reason.length > 300) {
      throw new Error("Give a reason between 3 and 300 characters.");
    }
    const day = await ctx.db
      .query("dailyTotals")
      .withIndex("by_business_and_day", (q) =>
        q.eq("businessId", current.business._id).eq("day", entry.occurredOn),
      )
      .unique();
    if (!day) throw new Error("Daily totals are missing; reconcile before voiding this entry.");
    await ctx.db.patch("dailyTotals", day._id, {
      salesUgx: addSafeInteger(
        day.salesUgx,
        entry.kind === "sale" ? -entry.amountUgx : 0,
        "Daily sales total",
      ),
      expensesUgx: addSafeInteger(
        day.expensesUgx,
        entry.kind === "expense" ? -entry.amountUgx : 0,
        "Daily expenses total",
      ),
      saleCount: addSafeInteger(
        day.saleCount,
        entry.kind === "sale" ? -1 : 0,
        "Daily sale count",
      ),
      expenseCount: addSafeInteger(
        day.expenseCount,
        entry.kind === "expense" ? -1 : 0,
        "Daily expense count",
      ),
    });
    if (entry.account !== "unallocated") await applyAccountEffect(
      ctx,
      current.business._id,
      entry.account,
      entry.kind === "sale" ? -entry.amountUgx : entry.amountUgx,
    );
    const now = Date.now();
    await ctx.db.patch("entries", entry._id, {
      state: "void",
      voidedAt: now,
      voidedBy: current.userId,
      voidReason: reason,
    });
    await ctx.db.insert("auditEvents", {
      businessId: current.business._id,
      actorId: current.userId,
      action: "entry.voided",
      entityType: "entry",
      entityId: entry._id,
      occurredAt: now,
      summary: reason,
    });
    return null;
  },
});

export const correctEntry = mutation({
  args: {
    businessId: v.id("businesses"), entryId: v.id("entries"), amountUgx: v.number(), occurredOn: v.string(),
    account: v.union(v.literal("cash"), v.literal("mobile_money")), category: v.string(), note: v.string(),
    reason: v.string(), idempotencyKey: v.string(), confirmNegativeBalance: v.optional(v.boolean()), confirmPossibleDuplicate: v.optional(v.boolean()),
  },
  returns: v.id("entries"),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx, args.businessId);
    if (!current || current.membership.role !== "owner") throw new Error("Only a workspace owner can correct a posted entry.");
    const reason = args.reason.trim();
    const category = args.category.trim();
    const note = args.note.trim();
    if (!Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0 || !isIsoDay(args.occurredOn) || category.length < 1 || category.length > 80 || note.length > 300 || reason.length < 5 || reason.length > 300 || args.idempotencyKey.length < 16 || args.idempotencyKey.length > 120) throw new Error("Enter valid replacement details and a correction reason of 5 to 300 characters.");
    const preferences = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", current.business._id)).unique();
    if (preferences?.requireEntryNote && !note) throw new Error("Add a description before saving. This workspace requires a note on each entry.");
    const existing = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", current.business._id).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existing) {
      const same = existing.correctionOf === args.entryId && existing.kind === (await ctx.db.get("entries", args.entryId))?.kind && existing.amountUgx === args.amountUgx && existing.occurredOn === args.occurredOn && existing.account === args.account && existing.category === category && existing.note === note;
      if (!same) throw new Error("This request key was already used for another correction.");
      return existing._id;
    }
    const original = await ctx.db.get("entries", args.entryId);
    if (!original || original.businessId !== current.business._id || original.state !== "posted" || original.source !== "manual" || original.operationSource || original.correctedBy) throw new Error("Choose an uncorrected, manually posted entry in this workspace.");
    const duplicateWindowDays = preferences?.duplicateWindowDays ?? 1;
    if (duplicateWindowDays > 0 && !args.confirmPossibleDuplicate) {
      const date = new Date(`${args.occurredOn}T00:00:00.000Z`);
      const from = new Date(date); from.setUTCDate(from.getUTCDate() - duplicateWindowDays);
      const to = new Date(date); to.setUTCDate(to.getUTCDate() + duplicateWindowDays);
      const candidates = await ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", current.business._id).eq("kind", original.kind).gte("occurredOn", from.toISOString().slice(0, 10)).lte("occurredOn", to.toISOString().slice(0, 10))).take(100);
      const match = candidates.find(entry => entry._id !== original._id && entry.state === "posted" && entry.account === args.account && entry.amountUgx === args.amountUgx && entry.category === category);
      if (match) throw new ConvexError({ code: "CONFIRM_DUPLICATE", message: `Similar ${original.kind} from ${match.occurredOn} was recorded for ${category}. Review it before continuing.` });
    }
    const oldDay = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", original.occurredOn)).unique();
    if (!oldDay) throw new Error("Daily totals are missing; reconcile before correcting this entry.");
    const oldIsSale = original.kind === "sale";
    if (oldIsSale ? oldDay.salesUgx < original.amountUgx || oldDay.saleCount < 1 : oldDay.expensesUgx < original.amountUgx || oldDay.expenseCount < 1) throw new Error("Daily totals need reconciliation before correcting this entry.");
    const dailyDeltas = new Map<string, { sales: number; expenses: number; saleCount: number; expenseCount: number }>();
    const addDayDelta = (day: string, kind: "sale" | "expense", amount: number, direction: 1 | -1) => {
      const delta = dailyDeltas.get(day) ?? { sales: 0, expenses: 0, saleCount: 0, expenseCount: 0 };
      if (kind === "sale") { delta.sales = addSafeInteger(delta.sales, amount * direction, "Correction sales"); delta.saleCount = addSafeInteger(delta.saleCount, direction, "Correction sale count"); }
      else { delta.expenses = addSafeInteger(delta.expenses, amount * direction, "Correction expenses"); delta.expenseCount = addSafeInteger(delta.expenseCount, direction, "Correction expense count"); }
      dailyDeltas.set(day, delta);
    };
    addDayDelta(original.occurredOn, original.kind, original.amountUgx, -1);
    addDayDelta(args.occurredOn, original.kind, args.amountUgx, 1);
    for (const [day, delta] of dailyDeltas) {
      const totals = day === original.occurredOn ? oldDay : await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", current.business._id).eq("day", day)).unique();
      const salesUgx = addSafeInteger(totals?.salesUgx ?? 0, delta.sales, "Daily sales total");
      const expensesUgx = addSafeInteger(totals?.expensesUgx ?? 0, delta.expenses, "Daily expenses total");
      const saleCount = addSafeInteger(totals?.saleCount ?? 0, delta.saleCount, "Daily sale count");
      const expenseCount = addSafeInteger(totals?.expenseCount ?? 0, delta.expenseCount, "Daily expense count");
      if (salesUgx < 0 || expensesUgx < 0 || saleCount < 0 || expenseCount < 0) throw new Error(`Daily totals for ${day} need reconciliation before correcting this entry.`);
      if (totals) await ctx.db.patch("dailyTotals", totals._id, { salesUgx, expensesUgx, saleCount, expenseCount });
      else await ctx.db.insert("dailyTotals", { businessId: current.business._id, day, salesUgx, expensesUgx, saleCount, expenseCount });
    }
    const accountDeltas = new Map<"cash" | "mobile_money", number>();
    const accountEffect = (kind: "sale" | "expense", amount: number) => kind === "sale" ? amount : -amount;
    if (original.account !== "unallocated") accountDeltas.set(original.account, addSafeInteger(accountDeltas.get(original.account) ?? 0, -accountEffect(original.kind, original.amountUgx), "Account correction"));
    accountDeltas.set(args.account, addSafeInteger(accountDeltas.get(args.account) ?? 0, accountEffect(original.kind, args.amountUgx), "Account correction"));
    for (const [account, delta] of accountDeltas) {
      const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", current.business._id).eq("account", account)).unique();
      const next = addSafeInteger(balance?.balanceUgx ?? 0, delta, "Account balance");
      if (next < 0 && preferences?.negativeBalanceWarning !== false && !args.confirmNegativeBalance) throw new ConvexError({ code: "CONFIRM_NEGATIVE", message: `This correction will put ${account === "cash" ? "cash" : "mobile money"} below zero. Review the balance before continuing.` });
      if (balance) await ctx.db.patch("accountBalances", balance._id, { balanceUgx: next, updatedAt: Date.now() });
      else await ctx.db.insert("accountBalances", { businessId: current.business._id, account, balanceUgx: next, updatedAt: Date.now() });
    }
    const now = Date.now();
    const replacementId = await ctx.db.insert("entries", { businessId: current.business._id, kind: original.kind, amountUgx: args.amountUgx, occurredOn: args.occurredOn, account: args.account, category, note, source: "manual", idempotencyKey: args.idempotencyKey, state: "posted", correctionOf: original._id, createdBy: current.userId, createdAt: now });
    await ctx.db.patch("entries", original._id, { state: "void", voidedAt: now, voidedBy: current.userId, voidReason: reason, correctedBy: replacementId });
    await ctx.db.insert("auditEvents", { businessId: current.business._id, actorId: current.userId, action: "entry.corrected", entityType: "entry", entityId: original._id, occurredAt: now, summary: `Corrected entry: ${reason}`, details: JSON.stringify({ replacementId, negativeBalanceOverride: args.confirmNegativeBalance ?? false, possibleDuplicateOverride: args.confirmPossibleDuplicate ?? false, previous: { amountUgx: original.amountUgx, occurredOn: original.occurredOn, account: original.account, category: original.category, note: original.note }, replacement: { amountUgx: args.amountUgx, occurredOn: args.occurredOn, account: args.account, category, note } }) });
    return replacementId;
  },
});
