"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { useRecordEntryBusy, useRecordEntrySaved } from "@/components/workspace/RecordEntryDrawer";

type EntryKind = "sale" | "expense";
function businessDate(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function EntryForm({ kind }: { kind: EntryKind }) {
  const recordSaved = useRecordEntrySaved();
  const setDrawerBusy = useRecordEntryBusy();
  const createEntry = useMutation(api.workspace.createEntry);
  const access = useQuery(api.workspace.currentAccess, {});
  const context = useQuery(api.settings.runtimeContext, {});
  const timezone = context?.access === "ready" ? context.timezone : "Africa/Kampala";
  const currency = context?.access === "ready" ? context.currency : "UGX";
  const currencyScale = 10 ** (context?.access === "ready" ? context.currencyMinorDigits : 0);
  const categories = context?.access === "ready" ? (kind === "sale" ? context.incomeCategories : context.expenseCategories) : [kind === "sale" ? "Product sales" : "Other expense"];
  const [account, setAccount] = useState<"cash" | "mobile_money">("cash");
  const [occurredOn, setOccurredOn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const [ruleConfirmation, setRuleConfirmation] = useState<{ kind: "duplicate" | "negative"; message: string } | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmDuplicate = useRef(false);
  const confirmNegative = useRef(false);
  const title = kind === "sale" ? "Record a sale" : "Record an expense";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const amount = Number(values.get("amount"));
    const amountMinor = Math.round(amount * currencyScale);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(amountMinor) || Math.abs(amount * currencyScale - amountMinor) > 1e-7) {
      setFeedback({ message: `Enter a positive amount using the supported decimal places for ${currency}.`, error: true });
      return;
    }
    setBusy(true); setFeedback(null);
    setDrawerBusy(true);
    try {
      const requestKey = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = requestKey;
      await createEntry({
        businessId: access?.access === "ready" ? access.businessId : (() => { throw new Error("Workspace is still loading."); })(),
        kind,
        amountUgx: amountMinor,
        occurredOn: String(values.get("occurredOn")),
        account,
        category: String(values.get("category")).trim(),
        note: String(values.get("note") ?? "").trim(),
        idempotencyKey: requestKey,
        confirmPossibleDuplicate: confirmDuplicate.current,
        confirmNegativeBalance: confirmNegative.current,
      });
      idempotencyKey.current = null;
      confirmDuplicate.current = false;
      confirmNegative.current = false;
      setRuleConfirmation(null);
      form.reset();
      setOccurredOn(null);
      setFeedback({ message: `${title.replace("Record a ", "")} saved to the cashbook.`, error: false });
      recordSaved(`${kind === "sale" ? "Sale" : "Expense"} saved to the cashbook.`);
    } catch (error) {
      if (error instanceof ConvexError) {
        const warning = error.data as { code?: string; message?: string };
        if (warning.code === "CONFIRM_DUPLICATE" || warning.code === "CONFIRM_NEGATIVE") {
          setRuleConfirmation({ kind: warning.code === "CONFIRM_DUPLICATE" ? "duplicate" : "negative", message: warning.message ?? "Review this cashbook warning before continuing." });
          return;
        }
      }
      setFeedback({ message: error instanceof Error ? error.message : "Could not save this entry. Try again.", error: true });
    } finally { setBusy(false); setDrawerBusy(false); }
  }
  const createPermission = kind === "sale" ? "sales.create" : "expenses.create";
  if (access?.access === "ready" && !access.permissions.includes(createPermission)) {
    return <div className="empty-state" role="status"><strong>Your role cannot create {kind === "sale" ? "sales" : "expenses"}.</strong><span>Ask a workspace administrator to update your role permissions.</span></div>;
  }
  return <form ref={formRef} className="form-layout" onSubmit={submit}>
    <div className="field"><label htmlFor="entry-amount">Amount ({currency})</label><input id="entry-amount" name="amount" inputMode="decimal" type="number" min={1 / currencyScale} step={1 / currencyScale} placeholder={currencyScale === 1 ? "e.g. 25,000" : "e.g. 25.00"} required /></div>
    <div className="field"><label htmlFor="entry-date">Date</label><input id="entry-date" name="occurredOn" type="date" value={occurredOn ?? businessDate(timezone)} onChange={(event) => setOccurredOn(event.target.value)} required /></div>
    <div className="field"><label htmlFor="entry-category">Category</label><select id="entry-category" name="category" required>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></div>
    <div className="field"><label>Account</label><div className="segment-control" role="group" aria-label="Account"><button type="button" aria-pressed={account === "cash"} onClick={() => setAccount("cash")}>Cash</button><button type="button" aria-pressed={account === "mobile_money"} onClick={() => setAccount("mobile_money")}>Mobile money</button></div></div>
    <div className="field field-full"><label htmlFor="entry-note">Description <span className="muted-note">(optional)</span></label><textarea id="entry-note" name="note" rows={3} maxLength={300} placeholder="Add context for this transaction" /></div>
    {ruleConfirmation && <div className="field field-full"><div className="notice-banner notice-warning" role="alert"><strong>Review this cashbook warning</strong><p>{ruleConfirmation.message}</p><div className="form-actions"><button className="button button-accent" type="button" disabled={busy} onClick={() => { if (ruleConfirmation.kind === "duplicate") confirmDuplicate.current = true; else confirmNegative.current = true; setRuleConfirmation(null); formRef.current?.requestSubmit(); }}>Review and continue</button><button className="button" type="button" disabled={busy} onClick={() => { setRuleConfirmation(null); idempotencyKey.current = null; confirmDuplicate.current = false; confirmNegative.current = false; }}>Cancel</button></div></div></div>}
    <div className="form-actions"><button className="button button-accent" type="submit" disabled={busy}>{busy ? "Saving…" : title}</button>{feedback && <span className={`form-feedback ${feedback.error ? "form-error" : "form-success"}`} role="status">{feedback.message}</span>}</div>
  </form>;
}
