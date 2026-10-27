"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";

type EntryKind = "sale" | "expense";
export function EntryForm({ kind }: { kind: EntryKind }) {
  const createEntry = useMutation(api.workspace.createEntry);
  const access = useQuery(api.workspace.currentAccess, {});
  const settings = useQuery(api.workspace.businessSettings, {});
  const [account, setAccount] = useState<"cash" | "mobile_money">("cash");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const title = kind === "sale" ? "Record a sale" : "Record an expense";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const amount = Number(values.get("amount"));
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setFeedback({ message: "Enter a positive whole amount in UGX.", error: true });
      return;
    }
    setBusy(true); setFeedback(null);
    try {
      const requestKey = idempotencyKey.current ?? crypto.randomUUID();
      idempotencyKey.current = requestKey;
      await createEntry({
        kind,
        amountUgx: amount,
        occurredOn: String(values.get("occurredOn")),
        account,
        category: String(values.get("category")).trim(),
        note: String(values.get("note") ?? "").trim(),
        idempotencyKey: requestKey,
      });
      idempotencyKey.current = null;
      form.reset();
      setFeedback({ message: `${title.replace("Record a ", "")} saved to the cashbook.`, error: false });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Could not save this entry. Try again.", error: true });
    } finally { setBusy(false); }
  }
  const timezone = settings?.access === "ready" ? settings.timezone : "Africa/Kampala";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (access?.access === "ready" && access.role === "partner") {
    return <div className="empty-state" role="status"><strong>Partner accounts can’t add ledger entries.</strong><span>Your scoped partner statement will be available here after partner reporting is connected.</span></div>;
  }
  return <form className="form-layout" onSubmit={submit}>
    <div className="field"><label htmlFor="entry-amount">Amount (UGX)</label><input id="entry-amount" name="amount" inputMode="numeric" type="number" min="1" step="1" placeholder="e.g. 25,000" required /></div>
    <div className="field"><label htmlFor="entry-date">Date</label><input key={timezone} id="entry-date" name="occurredOn" type="date" defaultValue={today} required /></div>
    <div className="field"><label htmlFor="entry-category">Category</label><input id="entry-category" name="category" maxLength={80} placeholder={kind === "sale" ? "e.g. Product sales" : "e.g. Transport"} required /></div>
    <div className="field"><label>Account</label><div className="segment-control" role="group" aria-label="Account"><button type="button" aria-pressed={account === "cash"} onClick={() => setAccount("cash")}>Cash</button><button type="button" aria-pressed={account === "mobile_money"} onClick={() => setAccount("mobile_money")}>Mobile money</button></div></div>
    <div className="field field-full"><label htmlFor="entry-note">Description <span className="muted-note">(optional)</span></label><textarea id="entry-note" name="note" rows={3} maxLength={300} placeholder="Add context for this transaction" /></div>
    <div className="form-actions"><button className="button button-accent" type="submit" disabled={busy}>{busy ? "Saving…" : title}</button>{feedback && <span className={`form-feedback ${feedback.error ? "form-error" : "form-success"}`} role="status">{feedback.message}</span>}</div>
  </form>;
}
