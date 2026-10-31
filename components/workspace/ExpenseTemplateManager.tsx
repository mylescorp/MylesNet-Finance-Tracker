"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Action = "create" | "pause" | "resume" | "archive" | "complete";
const recurrenceLabel = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

export function ExpenseTemplateManager({ currency, scale, locale }: { currency: string; scale: number; locale: string }) {
  const data = useQuery(api.expenseTemplates.list, {});
  const save = useMutation(api.expenseTemplates.save);
  const suppliers = useQuery(api.suppliers.activeOptions, {});
  const context = useQuery(api.settings.runtimeContext, {});
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Math.round(Math.log10(scale)) });
  const today = context?.access === "ready" ? new Intl.DateTimeFormat("en-CA", { timeZone: context.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) : new Date().toISOString().slice(0, 10);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    setBusy(true); setFeedback("");
    try {
      await save({ action: "create", name: String(form.get("name")), category: String(form.get("category")), amountUgx: form.get("amount") ? Math.round(Number(form.get("amount")) * scale) : null, account: String(form.get("account")) as "cash" | "mobile_money", recurrence: String(form.get("recurrence")) as "weekly" | "monthly" | "quarterly" | "yearly", nextDueOn: String(form.get("nextDueOn")), ...(form.get("supplierId") ? { supplierId: String(form.get("supplierId")) as Id<"suppliers"> } : {}), idempotencyKey: crypto.randomUUID() });
      element.reset();
      setFeedback("Recurring expense reminder saved. It will not post an expense automatically.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not save recurring expense reminder."); }
    finally { setBusy(false); }
  }

  async function change(templateId: Id<"expenseTemplates">, action: Action, name: string, expectedNextDueOn?: string) {
    setBusy(true); setFeedback("");
    try { await save({ action, templateId, name, category: "", amountUgx: null, account: "cash", recurrence: "monthly", nextDueOn: "2000-01-01", ...(expectedNextDueOn ? { expectedNextDueOn } : {}) }); setFeedback(action === "complete" ? `${name} occurrence marked complete. Its next due date advanced; no expense was posted.` : `${name} ${action === "archive" ? "archived" : action === "pause" ? "paused" : "resumed"}.`); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Could not update reminder."); }
    finally { setBusy(false); }
  }

  if (data === undefined) return <p className="muted-note" role="status">Loading recurring expense reminders…</p>;
  if (data.access !== "ready") return <p className="muted-note">Your role needs Expenses view access to review recurring expense reminders.</p>;
  return <div className="form-layout">
    <p className="muted-note">These reminders provide suggested defaults and a due date. Record the expense separately in the cashbook, then mark its occurrence complete to advance the date. Completing a reminder never posts an entry or changes an account balance.</p>
    {data.templates.length > 0 && <div className="entry-list">{data.templates.map(row => { const days = Math.round((Date.parse(`${row.nextDueOn}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000); const due = row.paused ? "Paused" : days < 0 ? `Overdue by ${Math.abs(days)} days` : days === 0 ? "Due today" : days <= 30 ? `Due in ${days} days` : `Due ${row.nextDueOn}`; return <div className="entry-row" key={row._id}><span><strong>{row.name}</strong><small>{row.category} · {recurrenceLabel[row.recurrence]} · next {row.nextDueOn}{row.supplierName ? ` · ${row.supplierName}` : ""}</small></span><span>{row.amountUgx === null ? "Variable amount" : money.format(row.amountUgx / scale)}<small className={days <= 30 ? "status-warning" : ""}>{due}</small></span>{data.canManage && <div className="form-actions">{!row.paused && <button className="button" type="button" disabled={busy || days > 0} onClick={() => void change(row._id, "complete", row.name, row.nextDueOn)}>Mark occurrence complete</button>}<button className="button" type="button" disabled={busy} onClick={() => void change(row._id, row.paused ? "resume" : "pause", row.name)}>{row.paused ? "Resume" : "Pause"}</button><button className="button" type="button" disabled={busy} onClick={() => void change(row._id, "archive", row.name)}>Archive</button></div>}</div>; })}</div>}
    {data.canManage && <form className="form-layout" onSubmit={submit}><h3 className="card-title">Add recurring expense reminder</h3><div className="field"><label htmlFor="template-name">Name</label><input id="template-name" name="name" minLength={2} maxLength={100} required /></div><div className="field"><label htmlFor="template-category">Category</label><select id="template-category" name="category">{context?.access === "ready" && context.expenseCategories.map(category => <option key={category}>{category}</option>)}</select></div><div className="field"><label htmlFor="template-amount">Expected amount ({currency}; optional if variable)</label><input id="template-amount" name="amount" type="number" min={1 / scale} step={1 / scale} /></div><div className="field"><label htmlFor="template-account">Usual account</label><select id="template-account" name="account"><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></div><div className="field"><label htmlFor="template-recurrence">Cadence</label><select id="template-recurrence" name="recurrence"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div><div className="field"><label htmlFor="template-due">Next due date</label><input id="template-due" name="nextDueOn" type="date" required /></div><div className="field"><label htmlFor="template-supplier">Supplier default</label><select id="template-supplier" name="supplierId"><option value="">No supplier</option>{suppliers?.access === "ready" && suppliers.suppliers.map(row => <option value={row._id} key={row._id}>{row.name}</option>)}</select></div><div className="form-actions"><button className="button button-accent" disabled={busy}>Save reminder</button></div></form>}
    {!data.complete && <p className="notice-banner notice-warning">Showing the first 100 recurring expense reminders.</p>}{feedback && <p className="muted-note" role="status">{feedback}</p>}
  </div>;
}
