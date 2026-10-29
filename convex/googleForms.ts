import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasPermission } from "./accessControl";

type Ctx = MutationCtx | QueryCtx;
type Kind = "sale" | "expense" | "movement" | "savings" | "loan" | "unknown";

async function owner(ctx: Ctx, businessId: Id<"businesses">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError("Sign in to manage Google Forms.");
  const membership = await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", businessId).eq("userId", userId)).unique();
  const business = membership?.active ? await ctx.db.get("businesses", businessId) : null;
  const current = business && membership ? { userId, membership, business } : null;
  if (!current || current.business.dataResetting || !(await hasPermission(ctx, current.membership, "integrations.manage"))) throw new ConvexError("Your role cannot manage Google Forms while the workspace is resetting.");
  return { userId: current.userId, business: current.business };
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export const createToken = mutation({
  args: { businessId: v.id("businesses") }, returns: v.string(),
  handler: async (ctx, args) => {
    const { userId, business } = await owner(ctx, args.businessId);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const tokenHash = await sha256(token);
    const integrations = await ctx.db.query("googleFormIntegrations").withIndex("by_business_and_active", q => q.eq("businessId", business._id).eq("active", true)).collect();
    for (const integration of integrations) await ctx.db.patch("googleFormIntegrations", integration._id, { active: false, revokedAt: Date.now() });
    await ctx.db.insert("googleFormIntegrations", { businessId: business._id, tokenHash, active: true, createdBy: userId, createdAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "integration.google_form.rotated", entityType: "integration", entityId: tokenHash.slice(0, 16), occurredAt: Date.now(), summary: "Google Form ingress token created or rotated." });
    return token;
  },
});

export const revokeToken = mutation({
  args: { businessId: v.id("businesses") }, returns: v.null(),
  handler: async (ctx, args) => {
    const { userId, business } = await owner(ctx, args.businessId);
    const rows = await ctx.db.query("googleFormIntegrations").withIndex("by_business_and_active", q => q.eq("businessId", business._id).eq("active", true)).collect();
    for (const integration of rows) await ctx.db.patch("googleFormIntegrations", integration._id, { active: false, revokedAt: Date.now() });
    await ctx.db.insert("auditEvents", { businessId: business._id, actorId: userId, action: "integration.google_form.revoked", entityType: "integration", entityId: business._id, occurredAt: Date.now(), summary: "Google Form ingress access revoked." });
    return null;
  },
});

export const status = query({
  args: { businessId: v.id("businesses") }, returns: v.object({ enabled: v.boolean() }),
  handler: async (ctx, args) => {
    const { business } = await owner(ctx, args.businessId);
    const active = await ctx.db.query("googleFormIntegrations").withIndex("by_business_and_active", q => q.eq("businessId", business._id).eq("active", true)).first();
    return { enabled: !!active };
  },
});

export const history = query({
  args: { businessId: v.id("businesses"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const { business } = await owner(ctx, args.businessId);
    const result = await ctx.db.query("googleFormReceipts").withIndex("by_business_and_created", q => q.eq("businessId", business._id)).order("desc").paginate(args.paginationOpts);
    return { ...result, page: result.page.map(({ _id, submissionKind, status, occurredOn, amountUgx, summary, createdAt, attemptCount, lastAttemptAt }) => ({ _id, submissionKind, status, occurredOn, amountUgx, summary, createdAt, attemptCount: attemptCount ?? 1, lastAttemptAt: lastAttemptAt ?? createdAt })) };
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
    if (!business || business.dataResetting || args.payload.length > 16_000) return { status: "needs_review" as const, message: "Workspace is resetting or payload is invalid." };
    const input = parseInput(args.payload);
    if (!input) return { status: "needs_review" as const, message: "Submission format is invalid." };
    const existing = await ctx.db.query("googleFormReceipts").withIndex("by_business_and_source", q => q.eq("businessId", business._id).eq("sourceKey", input.sourceKey)).unique();
    if (existing?.status === "posted") return { status: "duplicate" as const };
    const submitter = input.submittedByEmail ? await ctx.db.query("users").withIndex("email", q => q.eq("email", input.submittedByEmail)).first() : null;
    const member = submitter ? await ctx.db.query("memberships").withIndex("by_business_and_user", q => q.eq("businessId", business._id).eq("userId", submitter._id)).first() : null;
    const submissionPermission = input.kind === "sale" ? "sales.create" : input.kind === "expense" ? "expenses.create" : null;
    const authorizedSubmitter = submitter && member?.active && submissionPermission && await hasPermission(ctx, member, submissionPermission) ? submitter : null;
    const prefs = await ctx.db.query("workspacePreferences").withIndex("by_business", q => q.eq("businessId", business._id)).unique();
    const digits = 0; // The legacy Google Form labels its finance amounts in UGX.
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
    if (status === "posted" && business.currency !== "UGX") {
      status = "needs_review";
      summary = `Form amounts are in UGX, but this workspace uses ${business.currency}. Confirm the currency before posting.`;
    }
    if (status === "posted" && prefs?.requireEntryNote && changes.some(entry => !entry.note.trim())) {
      status = "needs_review";
      summary = "Workspace rules require a note for each entry; add a note before posting this Form submission.";
    }
    if (status === "posted" && prefs?.negativeBalanceWarning !== false) {
      const outflows = new Map<string, number>();
      for (const entry of changes) if (entry.kind === "expense") outflows.set(entry.account, (outflows.get(entry.account) ?? 0) + entry.amountUgx);
      for (const [account, amount] of outflows) {
        const balance = await ctx.db.query("accountBalances").withIndex("by_business_and_account", q => q.eq("businessId", business._id).eq("account", account as "cash" | "mobile_money")).unique();
        if ((balance?.balanceUgx ?? 0) - amount < 0) {
          status = "needs_review";
          summary = `This expense would put ${account === "cash" ? "cash" : "mobile money"} below zero. Review the balance before posting.`;
          break;
        }
      }
    }
    if (status === "posted" && (prefs?.duplicateWindowDays ?? 1) > 0) {
      const days = prefs?.duplicateWindowDays ?? 1;
      const from = new Date(`${date}T00:00:00.000Z`); from.setUTCDate(from.getUTCDate() - days);
      const to = new Date(`${date}T00:00:00.000Z`); to.setUTCDate(to.getUTCDate() + days);
      for (const entry of changes) {
        const possible = await ctx.db.query("entries").withIndex("by_business_and_kind_and_date", q => q.eq("businessId", business._id).eq("kind", entry.kind).gte("occurredOn", from.toISOString().slice(0, 10)).lte("occurredOn", to.toISOString().slice(0, 10))).take(100);
        const duplicate = possible.find(row => row.state === "posted" && row.account === entry.account && row.amountUgx === entry.amountUgx && row.category === entry.category);
        if (duplicate) {
          status = "needs_review";
          summary = `A similar ${entry.kind} already exists near ${duplicate.occurredOn}. Review it before posting.`;
          break;
        }
      }
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
    const attemptCount = existing ? (existing.attemptCount ?? 1) + 1 : 1;
    const receiptValues = { businessId: business._id, sourceKey: input.sourceKey, submissionKind: input.kind, status, occurredOn: validDay(date) ? date : undefined, amountUgx: totalUgx || undefined, summary, detailsJson: JSON.stringify(fields).slice(0, 16_000), attemptCount, lastAttemptAt: now };
    if (existing) await ctx.db.patch("googleFormReceipts", existing._id, receiptValues);
    else await ctx.db.insert("googleFormReceipts", { ...receiptValues, createdAt: now });
    return { status, message: summary };
  },
});
