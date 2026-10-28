import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isIgnoredCentipidEvent } from "./centipidUtils";
import { hasPermission } from "./accessControl";

function addSafeInteger(left: number, right: number, label: string) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new ConvexError(`${label} exceeds the safe amount range.`);
  return result;
}

async function owner(ctx: MutationCtx | QueryCtx, businessId: Id<"businesses">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in to manage the integration.");
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  const business = membership?.active ? await ctx.db.get("businesses", businessId) : null;
  const current = business && membership ? { userId, membership, business } : null;
  if (!current || !(await hasPermission(ctx, current.membership, "integrations.manage"))) throw new ConvexError("Your role cannot manage this integration.");
  return { userId: current.userId, business: current.business };
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export const createToken = mutation({
  args: { businessId: v.id("businesses") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { business, userId } = await owner(ctx, args.businessId);
    const random = crypto.getRandomValues(new Uint8Array(32));
    const token = [...random].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const tokenHash = await sha256(token);
    const current = await ctx.db.query("centipidIntegrations").withIndex("by_business", q => q.eq("businessId", business._id)).order("desc").take(10);
    for (const integration of current) if (integration.active) await ctx.db.patch("centipidIntegrations", integration._id, { active: false, revokedAt: Date.now() });
    await ctx.db.insert("centipidIntegrations", { businessId: business._id, tokenHash, active: true, createdBy: userId, createdAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "integration.centipid.rotated", entityType: "integration", entityId: tokenHash.slice(0, 16), occurredAt: Date.now(), summary: "Centipid webhook token created or rotated." });
    return token;
  },
});

export const revokeToken = mutation({
  args: { businessId: v.id("businesses") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { business, userId } = await owner(ctx, args.businessId);
    const rows = await ctx.db.query("centipidIntegrations").withIndex("by_business", q => q.eq("businessId", business._id)).order("desc").take(10);
    for (const integration of rows) if (integration.active) await ctx.db.patch("centipidIntegrations", integration._id, { active: false, revokedAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "integration.centipid.revoked", entityType: "integration", entityId: business._id, occurredAt: Date.now(), summary: "Centipid webhook access revoked." });
    return null;
  },
});

export const status = query({
  args: { businessId: v.id("businesses") }, returns: v.object({ enabled: v.boolean() }),
  handler: async (ctx, args) => {
    const { business } = await owner(ctx, args.businessId);
    const rows = await ctx.db.query("centipidIntegrations").withIndex("by_business", q => q.eq("businessId", business._id)).order("desc").take(10);
    return { enabled: rows.some(item => item.active) };
  },
});

export const history = query({
  args: { businessId: v.id("businesses"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { business } = await owner(ctx, args.businessId);
    return await ctx.db.query("webhookReceipts")
      .withIndex("by_business_and_created", q => q.eq("businessId", business._id))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const recordFailure = internalMutation({
  args: { tokenHash: v.string(), eventKey: v.string(), rawHash: v.string(), event: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const integration = await ctx.db.query("centipidIntegrations").withIndex("by_token_hash", q => q.eq("tokenHash", args.tokenHash)).unique();
    if (!integration?.active) return null;
    const prior = await ctx.db.query("webhookReceipts").withIndex("by_business_and_event", q => q.eq("businessId", integration.businessId).eq("eventKey", args.eventKey)).unique();
    if (prior && prior.status !== "failed") return null;
    const now = Date.now();
    const errorMessage = "Processing failed. Check the mapped event data, then retry with the same transaction reference.";
    if (prior) await ctx.db.patch("webhookReceipts", prior._id, { status: "failed", rawHash: args.rawHash, errorMessage, attemptCount: (prior.attemptCount ?? 1) + 1, lastAttemptAt: now });
    else await ctx.db.insert("webhookReceipts", { businessId: integration.businessId, eventKey: args.eventKey, event: args.event, status: "failed", rawHash: args.rawHash, errorMessage, attemptCount: 1, lastAttemptAt: now, createdAt: now });
    return null;
  },
});

async function saveReceipt(ctx: MutationCtx, businessId: Id<"businesses">, prior: Doc<"webhookReceipts"> | null, receipt: { eventKey: string; event: string; status: "success" | "ignored"; routed?: string; entryId?: Id<"entries">; rawHash: string }) {
  const now = Date.now();
  const values = { ...receipt, businessId, errorMessage: undefined, attemptCount: (prior?.attemptCount ?? 0) + 1, lastAttemptAt: now };
  if (prior) await ctx.db.patch("webhookReceipts", prior._id, values);
  else await ctx.db.insert("webhookReceipts", { ...values, createdAt: now });
}

export const processWebhook = internalMutation({
  args: {
    tokenHash: v.string(), eventKey: v.string(), legacyEventKey: v.optional(v.string()), rawHash: v.string(), event: v.string(), kind: v.union(v.literal("payment"), v.literal("voucher"), v.literal("expense"), v.literal("ignored")),
    amount: v.number(), transactionId: v.string(), paymentMethod: v.string(), description: v.string(), customer: v.string(), category: v.string(), account: v.string(), paidTo: v.string(),
  },
  returns: v.object({ status: v.union(v.literal("success"), v.literal("duplicate"), v.literal("ignored"), v.literal("unauthorized")), routed: v.optional(v.string()), event: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const integration = await ctx.db.query("centipidIntegrations").withIndex("by_token_hash", q => q.eq("tokenHash", args.tokenHash)).unique();
    if (!integration?.active) return { status: "unauthorized" as const };
    const business = await ctx.db.get("businesses", integration.businessId);
    if (!business) return { status: "unauthorized" as const };
    const prior = await ctx.db.query("webhookReceipts").withIndex("by_business_and_event", q => q.eq("businessId", business._id).eq("eventKey", args.eventKey)).unique();
    if (prior && prior.status !== "failed") return prior.status === "ignored" ? { status: "ignored" as const, event: prior.event } : { status: "duplicate" as const };
    if (args.legacyEventKey && args.legacyEventKey !== args.eventKey) {
      const legacyPrior = await ctx.db.query("webhookReceipts").withIndex("by_business_and_event", q => q.eq("businessId", business._id).eq("eventKey", args.legacyEventKey!)).unique();
      if (legacyPrior?.event === args.event) return legacyPrior.status === "ignored" ? { status: "ignored" as const, event: legacyPrior.event } : { status: "duplicate" as const };
    }

    const prefs = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", business._id)).unique();
    const ignoredEvent = isIgnoredCentipidEvent(args.event);
    const kind = ignoredEvent ? "ignored" : args.kind;
    const amount = Math.abs(args.amount);
    if (kind === "ignored" || !Number.isFinite(amount) || amount <= 0) {
      await saveReceipt(ctx, business._id, prior, { eventKey: args.eventKey, event: args.event, status: "ignored", rawHash: args.rawHash });
      await ctx.db.insert("auditEvents", { businessId: business._id, actorId: business.createdBy, action: "webhook.ignored", entityType: "integration", entityId: args.eventKey, occurredAt: Date.now(), summary: `Centipid event ignored: ${args.event || "unknown"}.` });
      return { status: "ignored" as const, event: args.event };
    }
    const entryKind: "sale" | "expense" = kind === "expense" ? "expense" : "sale";
    let account: "cash" | "mobile_money";
    let category: string;
    let note: string;
    if (kind === "expense") {
      const categories = prefs?.expenseCategories ?? [];
      category = findCategory(categories, args.category) ?? categories.find(value => /other|misc/i.test(value)) ?? categories.at(-1) ?? "Other";
      const explicitAccount = args.account.toLowerCase();
      const accountHint = /cash/.test(explicitAccount) ? "cash" : /mobile|momo|centipid|mpesa|airtel/.test(explicitAccount) ? "mobile_money" : "";
      const methodHint = /cash|voucher/.test(args.paymentMethod.toLowerCase()) ? "cash" : /mobile|momo|mpesa|airtel/.test(args.paymentMethod.toLowerCase()) ? "mobile_money" : "cash";
      account = accountHint || methodHint;
      note = `${args.paidTo || args.description || "Centipid expense"}${args.transactionId ? ` · ref ${args.transactionId}` : ""}`.slice(0, 300);
    } else {
      const categories = prefs?.incomeCategories ?? [];
      const voucher = kind === "voucher";
      category = findCategory(categories, voucher ? "voucher" : "centipid") ?? categories.find(value => voucher ? /voucher|cash/i.test(value) : /centipid|hotspot/i.test(value)) ?? (voucher ? "Direct cash / voucher sales" : "Centipid hotspot sales");
      account = voucher ? "cash" : "mobile_money";
      note = `${args.paymentMethod || (voucher ? "Voucher Redemption" : "Centipid System")} | ${args.description || (voucher ? "Voucher redeemed" : "Automated billing sync via Centipid Webhook")} | ${args.customer || ""}${args.transactionId ? ` | ref [${args.event}:${args.transactionId}]` : ""}`.slice(0, 300);
    }
    const digits = (() => { try { return new Intl.NumberFormat("en", { style: "currency", currency: business.currency }).resolvedOptions().maximumFractionDigits ?? 0; } catch { return 0; } })();
    const amountUgx = Math.round(amount * 10 ** digits);
    if (!Number.isSafeInteger(amountUgx) || amountUgx <= 0) throw new ConvexError("Webhook amount is out of range.");
    const now = Date.now();
    const occurredOn = new Intl.DateTimeFormat("en-CA", { timeZone: business.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
    const idempotencyKey = `centipid:${args.eventKey}`;
    const existing = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", business._id).eq("idempotencyKey", idempotencyKey)).unique();
    if (existing) {
      await saveReceipt(ctx, business._id, prior, { eventKey: args.eventKey, event: args.event, status: "success", routed: kind, entryId: existing._id, rawHash: args.rawHash });
      return { status: "duplicate" as const };
    }
    const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", business._id).eq("account", account)).unique();
    const delta = entryKind === "sale" ? amountUgx : -amountUgx;
    if (balance) {
      const next = addSafeInteger(balance.balanceUgx, delta, "Webhook account balance");
      await ctx.db.patch("accountBalances", balance._id, { balanceUgx: next, updatedAt: now });
    } else await ctx.db.insert("accountBalances", { businessId: business._id, account, balanceUgx: delta, updatedAt: now });
    const entryId = await ctx.db.insert("entries", { businessId: business._id, kind: entryKind, amountUgx, occurredOn, account, category, note, source: "webhook", idempotencyKey, state: "posted", createdBy: business.createdBy, createdAt: now });
    const day = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", business._id).eq("day", occurredOn)).unique();
    if (day) await ctx.db.patch("dailyTotals", day._id, {
      salesUgx: addSafeInteger(day.salesUgx, entryKind === "sale" ? amountUgx : 0, "Daily sales total"),
      expensesUgx: addSafeInteger(day.expensesUgx, entryKind === "expense" ? amountUgx : 0, "Daily expenses total"),
      saleCount: addSafeInteger(day.saleCount, entryKind === "sale" ? 1 : 0, "Daily sale count"),
      expenseCount: addSafeInteger(day.expenseCount, entryKind === "expense" ? 1 : 0, "Daily expense count"),
    });
    else await ctx.db.insert("dailyTotals", {
      businessId: business._id, day: occurredOn,
      salesUgx: entryKind === "sale" ? amountUgx : 0,
      expensesUgx: entryKind === "expense" ? amountUgx : 0,
      saleCount: entryKind === "sale" ? 1 : 0,
      expenseCount: entryKind === "expense" ? 1 : 0,
    });
    await saveReceipt(ctx, business._id, prior, { eventKey: args.eventKey, event: args.event, status: "success", routed: kind, entryId, rawHash: args.rawHash });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: business.createdBy, action: "webhook.entry_created", entityType: "entry", entityId: entryId, occurredAt: now, summary: `Centipid ${kind} recorded · ${occurredOn} · ${category}.` });
    return { status: "success" as const, routed: kind };
  },
});

function findCategory(categories: string[], keyword: string) { return categories.find(value => value.toLowerCase().includes(keyword)); }
