import { getAuthUserId } from "@convex-dev/auth/server";
import { env } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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

export const businessSettings = query({
  args: {},
  returns: v.union(
    v.object({ access: v.literal("setup") }),
    v.object({ access: v.literal("pending") }),
    v.object({
      access: v.literal("ready"),
      businessName: v.string(),
      countryCode: v.string(),
      currency: v.string(),
      timezone: v.string(),
      weekStartsOn: v.union(v.literal("monday"), v.literal("sunday")),
      role: v.union(v.literal("owner"), v.literal("partner"), v.literal("cashier")),
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
    businessName: v.string(),
    timezone: v.string(),
    weekStartsOn: v.union(v.literal("monday"), v.literal("sunday")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const current = await getMembership(ctx);
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
    if (!current || current.membership.role === "partner" || term.length < 2 || term.length > 80) return [];
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

export const createEntry = mutation({
  args: {
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
    const current = await getMembership(ctx);
    if (!current) throw new Error("Access is pending. Ask an owner for an invitation.");
    if (current.membership.role === "partner") {
      throw new Error("Partner accounts cannot add ledger entries.");
    }
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
