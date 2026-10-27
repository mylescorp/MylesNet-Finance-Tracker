import { getAuthUserId } from "@convex-dev/auth/server";
import { env } from "./_generated/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const accessResult = v.union(
  v.object({ access: v.literal("setup") }),
  v.object({ access: v.literal("pending") }),
  v.object({
    access: v.literal("ready"),
    businessName: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("partner"),
      v.literal("cashier"),
    ),
  }),
);

async function getMembership(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const memberships = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(20);
  // This first release has one active business workspace per signed-in user.
  // Fail closed instead of choosing a tenant if more than one membership exists.
  if (memberships.length === 20) return null;
  const activeMemberships = memberships.filter((membership) => membership.active);
  if (activeMemberships.length !== 1) return null;
  const membership = activeMemberships[0];
  const business = await ctx.db.get("businesses", membership.businessId);
  if (!business) return null;
  return { userId, membership, business };
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
      balanceUgx: current.balanceUgx + deltaUgx,
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
    const setupCode = (env as typeof env & { OWNER_SETUP_CODE?: string }).OWNER_SETUP_CODE;
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
      timezone: "Africa/Kampala",
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
      const businesses = await ctx.db.query("businesses").take(1);
      return { access: businesses.length === 0 ? "setup" as const : "pending" as const };
    }
    return {
      access: "ready" as const,
      businessName: current.business.name,
      role: current.membership.role,
    };
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
    if (current.membership.role === "partner") return { access: "restricted" as const };
    const days = await ctx.db
      .query("dailyTotals")
      .withIndex("by_business_and_day", (q) =>
        q
          .eq("businessId", current.business._id)
          .gte("day", args.from)
          .lt("day", args.toExclusive),
      )
      .take(370);
    const salesUgx = days.reduce((sum, day) => sum + day.salesUgx, 0);
    const expensesUgx = days.reduce((sum, day) => sum + day.expensesUgx, 0);
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

export const recentEntries = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("entries"),
      kind: v.union(v.literal("sale"), v.literal("expense")),
      amountUgx: v.number(),
      occurredOn: v.string(),
      account: v.union(v.literal("cash"), v.literal("mobile_money")),
      category: v.string(),
      note: v.string(),
      state: v.union(v.literal("posted"), v.literal("void")),
    }),
  ),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx);
    if (!current) return [];
    if (current.membership.role === "partner") return [];
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 10), 50));
    const rows = await ctx.db
      .query("entries")
      .withIndex("by_business_and_date", (q) =>
        q.eq("businessId", current.business._id),
      )
      .order("desc")
      .take(limit);
    return rows.map(({ _id, kind, amountUgx, occurredOn, account, category, note, state }) => ({
      _id,
      kind,
      amountUgx,
      occurredOn,
      account,
      category,
      note,
      state,
    }));
  },
});

export const createEntry = mutation({
  args: {
    kind: v.union(v.literal("sale"), v.literal("expense")),
    amountUgx: v.number(),
    occurredOn: v.string(),
    account: v.union(v.literal("cash"), v.literal("mobile_money")),
    category: v.string(),
    note: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.id("entries"),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx);
    if (!current) throw new Error("Access is pending. Ask an owner for an invitation.");
    if (current.membership.role === "partner") {
      throw new Error("Partner accounts cannot add ledger entries.");
    }
    if (!Number.isSafeInteger(args.amountUgx) || args.amountUgx <= 0) {
      throw new Error("Amount must be a positive whole number of UGX.");
    }
    if (!isIsoDay(args.occurredOn)) throw new Error("Choose a valid date.");
    if (args.category.trim().length < 1 || args.category.length > 80) {
      throw new Error("Enter a category using 1 to 80 characters.");
    }
    if (args.note.length > 300) throw new Error("Notes can be up to 300 characters.");
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

    const now = Date.now();
    const accountDelta =
      (args.kind === "sale" ? args.amountUgx : -args.amountUgx);
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
        salesUgx: day.salesUgx + (args.kind === "sale" ? args.amountUgx : 0),
        expensesUgx: day.expensesUgx + (args.kind === "expense" ? args.amountUgx : 0),
        saleCount: day.saleCount + (args.kind === "sale" ? 1 : 0),
        expenseCount: day.expenseCount + (args.kind === "expense" ? 1 : 0),
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
      summary: `${args.kind} · ${args.amountUgx} UGX · ${args.occurredOn}`,
    });
    return entryId;
  },
});

export const voidEntry = mutation({
  args: { entryId: v.id("entries"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx);
    if (!current || current.membership.role !== "owner") {
      throw new Error("Only an owner can void an entry.");
    }
    const entry = await ctx.db.get("entries", args.entryId);
    if (!entry || entry.businessId !== current.business._id) {
      throw new Error("Entry not found.");
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
      salesUgx: day.salesUgx - (entry.kind === "sale" ? entry.amountUgx : 0),
      expensesUgx: day.expensesUgx - (entry.kind === "expense" ? entry.amountUgx : 0),
      saleCount: day.saleCount - (entry.kind === "sale" ? 1 : 0),
      expenseCount: day.expenseCount - (entry.kind === "expense" ? 1 : 0),
    });
    await applyAccountEffect(
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
