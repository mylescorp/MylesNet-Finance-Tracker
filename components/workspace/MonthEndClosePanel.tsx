"use client";

import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function monthFor(daysAgo: number, today: string) {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - daysAgo);
  return date.toISOString().slice(0, 7);
}

function monthRange(month: string) {
  const from = `${month}-01`;
  const next = new Date(`${from}T00:00:00.000Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { periodFrom: from, periodToExclusive: next.toISOString().slice(0, 10) };
}

type Snapshot = {
  complete: boolean;
  totals: { salesUgx: number; expensesUgx: number; cashbookNetUgx: number };
  salesByCategory: Array<{ category: string; amountUgx: number }>;
  expensesByCategory: Array<{ category: string; amountUgx: number }>;
  postedEntryCount: number;
  activityDays: Array<{ day: string; status: "confirmed_no_activity" | "source_reviewed"; note: string }>;
  unreviewedSourceDays: Array<{ day: string; activityExists: boolean; priorStatus: "confirmed_no_activity" | "source_reviewed" | null; note: string | null; updatedAt: number | null }>;
  categoryBudgets: Array<{ category: string; limitUgx: number; warningAtPercent: number; actualUgx: number }>;
};

export function MonthEndClosePanel({ businessId, today, currency, scale, locale }: { businessId: Id<"businesses">; today: string; currency: string; scale: number; locale: string }) {
  const [month, setMonth] = useState(() => monthFor(1, today));
  const [feedback, setFeedback] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const period = useMemo(() => validMonth ? monthRange(month) : { periodFrom: "", periodToExclusive: "" }, [month, validMonth]);
  const data = useQuery(api.monthEndClose.overview, validMonth ? { businessId, ...period } : "skip");
  const prepare = useMutation(api.monthEndClose.prepare);
  const approve = useMutation(api.monthEndClose.approve);
  const reopen = useMutation(api.monthEndClose.reopen);
  const reviewSourceDay = useMutation(api.monthEndClose.reviewSourceDay);
  const money = (value: number) => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Math.round(Math.log10(scale)) }).format(value / scale);

  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setFeedback("");
    try { await action(); setFeedback(success); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Could not update this month-end close."); }
    finally { setBusy(false); }
  }

  const savedSnapshot = useMemo<Snapshot | null>(() => {
    if (!data || data.access !== "ready" || !data.closure) return null;
    try { return JSON.parse(data.closure.snapshotJson) as Snapshot; }
    catch { return null; }
  }, [data]);
  const displaySnapshot = data?.access === "ready" && data.closure && data.closure.status !== "reopened" ? savedSnapshot : data?.access === "ready" ? data.snapshot : null;
  const maxMonth = monthFor(1, today);
  const canPrepare = data?.access === "ready" && data.canClose && data.snapshot.ready && data.closure?.status !== "closed";

  return <div className="month-end-close-panel">
    <div className="card-heading"><div><h2 className="card-title">Month-end close</h2><p className="card-subtitle">A reviewer-approved snapshot of posted cashbook totals and the matching category-budget actuals. This closes the report period; it does not lock new ledger entries.</p></div></div>
    <div className="form-actions"><label className="field"><span>Calendar month</span><input type="month" value={month} max={maxMonth} onChange={event => setMonth(event.target.value)} /></label><span className="muted-note">{period.periodFrom} to {period.periodToExclusive} (exclusive)</span></div>
    {!validMonth ? <p className="muted-note">Choose a calendar month to review its close checklist.</p>
      : data === undefined ? <p className="muted-note">Loading close checklist…</p>
      : data.access === "restricted" ? <p className="muted-note">Monthly P&amp;L access is required to view the close checklist.</p>
        : <>
          {displaySnapshot?.complete && <div className="settings-facts"><div><span>Recorded sales</span><strong>{money(displaySnapshot.totals.salesUgx)}</strong></div><div><span>Posted expenses</span><strong>{money(displaySnapshot.totals.expensesUgx)}</strong></div><div><span>Cashbook net</span><strong>{money(displaySnapshot.totals.cashbookNetUgx)}</strong></div></div>}
          {displaySnapshot?.complete && <p className="muted-note">Statement snapshot uses {displaySnapshot.postedEntryCount.toLocaleString(locale)} posted entries; figures are recorded cashbook activity, not accrual or tax accounts.</p>}
          {displaySnapshot?.complete && <div className="table-scroll"><table className="data-table"><thead><tr><th>Income category</th><th>Recorded sales</th></tr></thead><tbody>{displaySnapshot.salesByCategory.length ? displaySnapshot.salesByCategory.map(row => <tr key={row.category}><td>{row.category}</td><td>{money(row.amountUgx)}</td></tr>) : <tr><td>No posted sales</td><td>{money(0)}</td></tr>}</tbody></table></div>}
          {displaySnapshot?.complete && <div className="table-scroll"><table className="data-table"><thead><tr><th>Expense category</th><th>Posted actual</th></tr></thead><tbody>{displaySnapshot.expensesByCategory.length ? displaySnapshot.expensesByCategory.map(row => <tr key={row.category}><td>{row.category}</td><td>{money(row.amountUgx)}</td></tr>) : <tr><td>No posted expenses</td><td>{money(0)}</td></tr>}</tbody></table></div>}
          {data.snapshot.unreviewedSourceDays.length > 0 && <div className="form-layout"><h3 className="card-title">Daily source coverage</h3><p className="muted-note">Review each day before closing. Days with posted entries need confirmation that the source is complete; days without entries need confirmation that the business was closed or had no activity.</p>{data.snapshot.unreviewedSourceDays.map(row => <form className="form-layout" key={`${row.day}-${row.priorStatus ?? "missing"}-${row.updatedAt ?? "new"}`} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void perform(() => reviewSourceDay({ businessId, day: row.day, status: row.activityExists ? "source_reviewed" : "confirmed_no_activity", note: String(form.get("note") ?? ""), expectedUpdatedAt: row.updatedAt }), `Source coverage saved for ${row.day}.`); }}><label className="field"><span>{row.day} · {row.activityExists ? "Posted activity recorded" : "No posted activity"}</span><input name="note" defaultValue={row.note ?? ""} minLength={5} maxLength={300} required placeholder={row.activityExists ? "What source records were checked?" : "Why was there no business activity?"} /></label><button className="button" disabled={busy}>{row.activityExists ? "Confirm source reviewed" : "Confirm no activity"}</button></form>)}</div>}
          {displaySnapshot?.complete && displaySnapshot.activityDays.length > 0 && <details><summary>Daily source review notes</summary><div className="entry-list">{displaySnapshot.activityDays.map(row => <div className="entry-row" key={row.day}><span className="status-chip">{row.day} · {row.status === "source_reviewed" ? "Activity reviewed" : "No activity"}</span><span>{row.note}</span></div>)}</div></details>}
          {displaySnapshot?.categoryBudgets.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Budget category</th><th>Monthly limit</th><th>Posted actual</th><th>Remaining</th></tr></thead><tbody>{displaySnapshot.categoryBudgets.map(row => <tr key={row.category}><td>{row.category}</td><td>{money(row.limitUgx)}</td><td>{money(row.actualUgx)}</td><td>{money(row.limitUgx - row.actualUgx)}</td></tr>)}</tbody></table></div> : <p className="muted-note">No active category budgets are configured for this workspace.</p>}
          <div className="settings-facts">{data.snapshot.checklist.map(item => <div key={item.key}><span><span className={`status-chip ${item.ready ? "status-ok" : "status-warning"}`}>{item.ready ? "Ready" : "Action needed"}</span> {item.label}</span><small>{item.detail}</small></div>)}</div>
          {data.closure && <div className="notice-banner notice-info">{data.closure.status === "closed" ? `Closed by ${data.closure.reviewedByName ?? "reviewer"} on ${new Date(data.closure.reviewedAt ?? 0).toLocaleString(locale)}.` : data.closure.status === "awaiting_review" ? `Prepared by ${data.closure.preparedByName}; waiting for a different authorized reviewer.` : `Reopened. Reason: ${data.closure.reopenReason ?? "Not recorded"}`}</div>}
          {data.closure?.status === "closed" && <div className="form-layout"><label className="field field-full"><span>Reason to reopen this closed period</span><textarea rows={2} minLength={5} maxLength={300} value={reopenReason} onChange={event => setReopenReason(event.target.value)} placeholder="Explain what must be corrected before another close review." /></label><div className="form-actions"><button className="button" type="button" disabled={busy || !data.canClose || reopenReason.trim().length < 5} onClick={() => void perform(() => reopen({ businessId, closureId: data.closure!._id, reason: reopenReason }), "Month reopened with an audit reason.")}>Reopen period</button></div></div>}
          {data.closure?.status === "awaiting_review" && <div className="form-actions"><button className="button button-accent" type="button" disabled={busy || !data.canApprove} onClick={() => void perform(() => approve({ businessId, closureId: data.closure!._id, expectedSnapshotJson: data.closure!.snapshotJson }), "Month-end close approved and recorded.")}>Approve prepared close</button><span className="muted-note">The approver must be a different member from the preparer.</span></div>}
          {canPrepare && <div className="form-actions"><button className="button button-accent" type="button" disabled={busy} onClick={() => void perform(() => prepare({ businessId, ...period }), data.closure?.status === "awaiting_review" ? "Close snapshot refreshed. A different authorized reviewer must approve it." : "Close snapshot prepared. A different authorized reviewer must approve it.")}>{data.closure?.status === "awaiting_review" ? "Refresh close snapshot" : "Prepare for review"}</button></div>}
          {!data.closure && !data.snapshot.ready && <p className="muted-note">Complete the checklist before preparing this month for review.</p>}
          {data.events.length > 0 && <details><summary>Close history</summary><div className="entry-list">{data.events.map((event, index) => <div className="entry-row" key={`${event.action}-${event.occurredAt}-${index}`}><span className="status-chip">{event.action}</span><span>{event.actorName} · {new Date(event.occurredAt).toLocaleString(locale)}{event.reason ? ` · ${event.reason}` : ""}</span></div>)}</div></details>}
        </>}
    {feedback && <p className="muted-note" role="status">{feedback}</p>}
  </div>;
}
