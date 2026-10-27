import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = MutationCtx | QueryCtx;
type Kind = "sale" | "expense" | "movement" | "savings" | "loan" | "unknown";

async function owner(ctx: Ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in before managing the Google Forms connection.");
  const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", userId)).take(20);
  const active = memberships.filter(item => item.active);
  if (memberships.length >= 20 || active.length !== 1 || active[0].role !== "owner") throw new ConvexError("Only the owner of one active workspace can manage Google Forms.");
  const business = await ctx.db.get("businesses", active[0].businessId);
  if (!business) throw new ConvexError("Workspace not found.");
  return { userId, business };
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export const createToken = mutation({
  args: {}, returns: v.string(),
  handler: async ctx => {
    const { userId, business } = await owner(ctx);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const tokenHash = await sha256(token);
    const integrations = await ctx.db.query("googleFormIntegrations").withIndex("by_business", q => q.eq("businessId", business._id)).take(20);
    for (const integration of integrations) if (integration.active) await ctx.db.patch("googleFormIntegrations", integration._id, { active: false, revokedAt: Date.now() });
    await ctx.db.insert("googleFormIntegrations", { businessId: business._id, tokenHash, active: true, createdBy: userId, createdAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "integration.google_form.rotated", entityType: "integration", entityId: tokenHash.slice(0, 16), occurredAt: Date.now(), summary: "Google Form ingress token created or rotated." });
    return token;
  },
});

export const revokeToken = mutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    const { userId, business } = await owner(ctx);
    const rows = await ctx.db.query("googleFormIntegrations").withIndex("by_business", q => q.eq("businessId", business._id)).take(20);
    for (const integration of rows) if (integration.active) await ctx.db.patch("googleFormIntegrations", integration._id, { active: false, revokedAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "integration.google_form.revoked", entityType: "integration", entityId: business._id, occurredAt: Date.now(), summary: "Google Form ingress access revoked." });
    return null;
  },
});

export const status = query({
  args: {}, returns: v.object({ enabled: v.boolean() }),
  handler: async ctx => {
    const { business } = await owner(ctx);
    const rows = await ctx.db.query("googleFormIntegrations").withIndex("by_business", q => q.eq("businessId", business._id)).take(20);
    return { enabled: rows.some(row => row.active) };
  },
});

export const history = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("googleFormReceipts"), submissionKind: v.union(v.literal("sale"), v.literal("expense"), v.literal("movement"), v.literal("savings"), v.literal("loan"), v.literal("unknown")), status: v.union(v.literal("posted"), v.literal("needs_review")), occurredOn: v.optional(v.string()), amountUgx: v.optional(v.number()), summary: v.string(), createdAt: v.number() })),
  handler: async ctx => {
    const { business } = await owner(ctx);
    return (await ctx.db.query("googleFormReceipts").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").take(30)).map(({ _id, submissionKind, status, occurredOn, amountUgx, summary, createdAt }) => ({ _id, submissionKind, status, occurredOn, amountUgx, summary, createdAt }));
  },
});

type FormInput = { sourceKey: string; kind: Kind; occurredOn?: string; submittedByEmail?: string; fields: Record<string, string> };

function parseInput(payload: string): FormInput | null {
  try {
    const value: unknown = JSON.parse(payload);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const kinds: Kind[] = ["sale", "expense", "movement", "savings", "loan", "unknown"];
    if (typeof record.sourceKey !== "string" || !/^[A-Za-z0-9:_-]{8,160}$/.test(record.sourceKey) || typeof record.kind !== "string" || !kinds.includes(record.kind as Kind)) return null;
    const fields: Record<string, string> = {};
    if (!record.fields || typeof record.fields !== "object" || Array.isArray(record.fields)) return null;
    for (const [key, field] of Object.entries(record.fields)) {
      if (key.length > 120 || (typeof field !== "string" && typeof field !== "number")) return null;
      fields[key] = String(field).trim().slice(0, 1000);
    }
    const occurredOn = typeof record.occurredOn === "string" ? record.occurredOn : undefined;
    const submittedByEmail = typeof record.submittedByEmail === "string" && record.submittedByEmail.length <= 254 ? record.submittedByEmail.trim().toLowerCase() : undefined;
    return { sourceKey: record.sourceKey, kind: record.kind as Kind, occurredOn, submittedByEmail, fields };
  } catch { return null; }
}

function validDay(day?: string) {
  return !!day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`)) && new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day;
}

function amountMinor(value: string | undefined, digits: number) {
  const parsed = Number(String(value ?? "").replace(/[,\s]/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const scaled = parsed * 10 ** digits;
  const rounded = Math.round(scaled);
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) < 1e-7 ? rounded : null;
}

function fieldValue(fields: Record<string, string>, name: string) { return fields[name] ?? ""; }

function entryCategoryFallback(label: string, category: string) {
  const name = category.toLowerCase();
  if (/installation|connection/i.test(label)) return /service|income|revenue/.test(name);
  return /sales|product|goods|revenue/.test(name);
}

export const receive = internalMutation({
  args: { tokenHash: v.string(), payload: v.string() },
  returns: v.object({ status: v.union(v.literal("posted"), v.literal("needs_review"), v.literal("duplicate"), v.literal("unauthorized")), message: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const integration = await ctx.db.query("googleFormIntegrations").withIndex("by_token_hash", q => q.eq("tokenHash", args.tokenHash)).unique();
    if (!integration?.active) return { status: "unauthorized" as const };
    const business = await ctx.db.get("businesses", integration.businessId);
    if (!business || args.payload.length > 16_000) return { status: "needs_review" as const, message: "Workspace or payload is invalid." };
    const input = parseInput(args.payload);
    if (!input) return { status: "needs_review" as const, message: "Submission format is invalid." };
    const existing = await ctx.db.query("googleFormReceipts").withIndex("by_business_and_source", q => q.eq("businessId", business._id).eq("sourceKey", input.sourceKey)).unique();
    if (existing) return { status: "duplicate" as const };
    const submitter = input.submittedByEmail ? await ctx.db.query("users").withIndex("email", q => q.eq("email", input.submittedByEmail)).first() : null;
    const member = submitter ? await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", business._id).eq("userId", submitter._id)).first() : null;
    const authorizedSubmitter = submitter && member?.active && (member.role === "owner" || member.role === "cashier") ? submitter : null;
    const prefs = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", business._id)).unique();
    const digits = (() => { try { return new Intl.NumberFormat("en", { style: "currency", currency: business.currency }).resolvedOptions().maximumFractionDigits ?? 0; } catch { return 0; } })();
    const now = Date.now();
    const date = input.occurredOn;
    const fields = input.fields;
    let status: "posted" | "needs_review" = "needs_review";
    let totalUgx = 0;
    let summary = authorizedSubmitter
      ? "Submission received and held for review; this form does not provide enough detail to post it safely."
      : "Submission needs review because the respondent email is not linked to an active owner or cashier account.";
    const changes: { kind: "sale" | "expense"; amountUgx: number; category: string; account: "cash" | "mobile_money"; note: string }[] = [];
    if (authorizedSubmitter && input.kind === "sale" && validDay(date)) {
      const sales = [
        ["Centipid hotspot sales", "Centipid hotspot sales", "mobile_money", /centipid|hotspot/i],
        ["Sales: Direct cash / voucher sales", "Direct cash / voucher sales", "cash", /voucher|cash|direct/i],
        ["Sales: Installation & connection fees", "Installation & connection fees", "cash", /install|connection/i],
        ["Sales: Equipment sales", "Equipment sales", "cash", /equipment/i],
      ] as const;
      let reviewReason = "";
      for (const [field, label, account, pattern] of sales) {
        if (!fieldValue(fields, field)) continue;
        const amount = amountMinor(fieldValue(fields, field), digits);
        if (amount === null) { reviewReason = `Invalid amount for ${label}.`; break; }
        const categories = prefs?.incomeCategories ?? [];
        const category = categories.find(value => pattern.test(value))
          ?? categories.find(value => entryCategoryFallback(label, value));
        if (!category) { reviewReason = `No configured income category matches ${label}.`; break; }
        changes.push({ kind: "sale", amountUgx: amount, category, account, note: fieldValue(fields, "Sales note (optional)").slice(0, 300) });
      }
      if (!reviewReason && changes.length > 0) {
        status = "posted"; totalUgx = changes.reduce((sum, row) => sum + row.amountUgx, 0);
        summary = `${changes.length} sales line${changes.length === 1 ? "" : "s"} posted from Google Form.`;
      } else if (reviewReason) summary = reviewReason;
    } else if (authorizedSubmitter && input.kind === "expense" && validDay(date)) {
      const amount = amountMinor(fieldValue(fields, "Expense amount (UGX)"), digits);
      const requestedCategory = fieldValue(fields, "Category").toLowerCase();
      const category = (prefs?.expenseCategories ?? []).find(value => value.toLowerCase() === requestedCategory);
      const accountLabel = fieldValue(fields, "Paid from").toLowerCase();
      const account = /cash/.test(accountLabel) ? "cash" : /centipid|mobile|momo/.test(accountLabel) ? "mobile_money" : null;
      if (amount !== null && category && account) {
        status = "posted"; totalUgx = amount;
        changes.push({ kind: "expense", amountUgx: amount, category, account, note: [fieldValue(fields, "Paid to / description"), fieldValue(fields, "Expense note (optional)")].filter(Boolean).join(" · ").slice(0, 300) });
        summary = "Expense posted from Google Form.";
      } else summary = "Expense needs review: check the date, amount, configured category, and payment account.";
    }
    if (status === "posted") {
      for (const [index, entry] of changes.entries()) {
        const idempotencyKey = `google-form:${input.sourceKey}:${index}`;
        const old = await ctx.db.query("entries").withIndex("by_business_and_idempotency", q => q.eq("businessId", business._id).eq("idempotencyKey", idempotencyKey)).unique();
        if (old) continue;
        const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", business._id).eq("account", entry.account)).unique();
        const delta = entry.kind === "sale" ? entry.amountUgx : -entry.amountUgx;
        const nextBalance = (balance?.balanceUgx ?? 0) + delta;
        if (!Number.isSafeInteger(nextBalance)) throw new ConvexError("Account balance exceeds the safe amount range.");
        if (balance) await ctx.db.patch("accountBalances", balance._id, { balanceUgx: nextBalance, updatedAt: now });
        else await ctx.db.insert("accountBalances", { businessId: business._id, account: entry.account, balanceUgx: delta, updatedAt: now });
        const entryId = await ctx.db.insert("entries", { businessId: business._id, kind: entry.kind, amountUgx: entry.amountUgx, occurredOn: date!, account: entry.account, category: entry.category, note: entry.note, source: "google_form", idempotencyKey, state: "posted", createdBy: authorizedSubmitter!._id, createdAt: now });
        const daily = await ctx.db.query("dailyTotals").withIndex("by_business_and_day", q => q.eq("businessId", business._id).eq("day", date!)).unique();
        const sales = entry.kind === "sale" ? entry.amountUgx : 0;
        const expenses = entry.kind === "expense" ? entry.amountUgx : 0;
        if (daily) {
          const salesUgx = daily.salesUgx + sales;
          const expensesUgx = daily.expensesUgx + expenses;
          if (!Number.isSafeInteger(salesUgx) || !Number.isSafeInteger(expensesUgx)) throw new ConvexError("Daily total exceeds the safe amount range.");
          await ctx.db.patch("dailyTotals", daily._id, { salesUgx, expensesUgx, saleCount: daily.saleCount + (entry.kind === "sale" ? 1 : 0), expenseCount: daily.expenseCount + (entry.kind === "expense" ? 1 : 0) });
        }
        else await ctx.db.insert("dailyTotals", { businessId: business._id, day: date!, salesUgx: sales, expensesUgx: expenses, saleCount: entry.kind === "sale" ? 1 : 0, expenseCount: entry.kind === "expense" ? 1 : 0 });
        await ctx.db.insert("auditEvents", { businessId: business._id, actorId: authorizedSubmitter!._id, action: "entry.google_form_posted", entityType: "entry", entityId: entryId, occurredAt: now, summary: `${entry.kind} received from Google Form · ${date} · ${entry.category}.` });
      }
    }
    await ctx.db.insert("googleFormReceipts", { businessId: business._id, sourceKey: input.sourceKey, submissionKind: input.kind, status, occurredOn: validDay(date) ? date : undefined, amountUgx: totalUgx || undefined, summary, detailsJson: JSON.stringify(fields).slice(0, 16_000), createdAt: now });
    return { status, message: summary };
  },
});
