"use client";

import { useQuery, useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { FinanceAccount } from "@/lib/finance-period";

type CategoryBudget = {
  category: string;
  configured: boolean;
  monthlyBudgetUgx: number | null;
  warningAtPercent: number | null;
  actualUgx: number;
  utilizationPercent: number | null;
  status: "not_set" | "below_warning" | "threshold_reached" | "incomplete";
};

function dayBefore(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function CategoryBudgetsPanel({ from, toExclusive, account, currency, scale, locale }: { from: string; toExclusive: string; account: FinanceAccount; currency: string; scale: number; locale: string }) {
  const overview = useQuery(api.categoryBudgets.overview, { from, toExclusive, ...(account === "all" ? {} : { account }) });
  const saveBudget = useMutation(api.categoryBudgets.save);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const [warningAtPercent, setWarningAtPercent] = useState("80");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const formatMoney = (amount: number) => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Math.round(Math.log10(scale)) }).format(amount / scale);
  const rows: CategoryBudget[] = overview?.access === "ready" ? overview.categories : [];
  const configuredCategories = rows.filter(row => row.configured);

  function editBudget(row?: CategoryBudget) {
    setEditingCategory(row?.category ?? "new");
    setCategory(row?.category ?? configuredCategories.find(item => item.monthlyBudgetUgx === null)?.category ?? configuredCategories[0]?.category ?? "");
    setMonthlyBudget(row?.monthlyBudgetUgx === null || row?.monthlyBudgetUgx === undefined ? "" : String(row.monthlyBudgetUgx / scale));
    setWarningAtPercent(String(row?.warningAtPercent ?? 80));
    setFeedback(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const scaledBudget = Number(monthlyBudget) * scale;
      const monthlyBudgetUgx = Math.round(scaledBudget);
      const warning = Number(warningAtPercent);
      if (!category || !Number.isFinite(scaledBudget) || Math.abs(scaledBudget - monthlyBudgetUgx) > 1e-8 || !Number.isSafeInteger(monthlyBudgetUgx) || monthlyBudgetUgx <= 0 || !Number.isSafeInteger(warning) || warning < 1 || warning > 300) {
        throw new Error("Enter a positive monthly amount and a whole-number warning threshold from 1% to 300%.");
      }
      await saveBudget({ category, monthlyBudgetUgx, warningAtPercent: warning, active: true });
      setFeedback({ error: false, message: `${category} monthly budget saved.` });
      setEditingCategory(null);
    } catch (error) {
      setFeedback({ error: true, message: error instanceof Error ? error.message : "Could not save this category budget." });
    } finally {
      setBusy(false);
    }
  }

  async function archiveBudget(row: CategoryBudget) {
    if (row.monthlyBudgetUgx === null || !window.confirm(`Archive the ${row.category} monthly budget? Its audit history will remain available.`)) return;
    setBusy(true);
    setFeedback(null);
    try {
      await saveBudget({ category: row.category, monthlyBudgetUgx: row.monthlyBudgetUgx, warningAtPercent: row.warningAtPercent ?? 80, active: false });
      setFeedback({ error: false, message: `${row.category} monthly budget archived.` });
    } catch (error) {
      setFeedback({ error: true, message: error instanceof Error ? error.message : "Could not archive this category budget." });
    } finally {
      setBusy(false);
    }
  }

  if (overview === undefined) return <div className="empty-state compact-empty" role="status"><strong>Loading category budgets…</strong><span>Budget settings and saved expense totals are loading.</span></div>;
  if (overview.access !== "ready") return <div className="empty-state compact-empty"><strong>Category budget access is restricted.</strong><span>Your role needs Expenses view access to see budget actuals.</span></div>;
  const periodThrough = dayBefore(overview.toExclusive);

  return <div className="category-budgets-panel">
      <div className="form-actions">{overview.canManage && <button className="button button-dark" type="button" disabled={busy || configuredCategories.length === 0} onClick={() => editBudget()}>+ Add or edit category budget</button>}</div>
      <p className="muted-note">Actuals use posted expenses for {overview.from} through {periodThrough} and the selected account filter. The comparison uses the full monthly budget; it does not prorate partial periods. Thresholds are review alerts, not automatic blocks.</p>
      {!overview.singleMonth && <p className="notice-banner notice-info" role="status">Choose dates within one calendar month to compare saved expenses with that month&apos;s budget. Budget settings remain available below.</p>}
      {overview.singleMonth && !overview.complete && <p className="notice-banner notice-warning" role="status">This date range exceeded the safe record limit. Actuals are partial and cannot be treated as a complete budget comparison.</p>}
      {feedback && <p className={`form-feedback${feedback.error ? " form-error" : " form-success"}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
      {overview.canManage && editingCategory !== null && <form className="form-layout category-budget-editor" onSubmit={event => void submit(event)}>
        <label className="field"><span>Expense category</span><select value={category} onChange={event => setCategory(event.target.value)} required>{editingCategory !== "new" && !configuredCategories.some(row => row.category === category) && <option value={category}>{category} · saved category</option>}{configuredCategories.map(row => <option key={row.category} value={row.category}>{row.category}</option>)}</select></label>
        <label className="field"><span>Monthly budget ({currency})</span><input type="number" min={1 / scale} step={1 / scale} value={monthlyBudget} onChange={event => setMonthlyBudget(event.target.value)} required /></label>
        <label className="field"><span>Review warning at</span><select value={warningAtPercent} onChange={event => setWarningAtPercent(event.target.value)}>{[50, 75, 80, 90, 100, 120, 150, 200, 300].map(value => <option value={value} key={value}>{value}% of monthly budget</option>)}</select></label>
        <div className="form-actions"><button className="button button-accent" type="submit" disabled={busy}>{busy ? "Saving…" : "Save budget"}</button><button className="button" type="button" disabled={busy} onClick={() => setEditingCategory(null)}>Cancel</button></div>
      </form>}
      {rows.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Category</th><th>{overview.singleMonth ? `Actual · ${overview.from} to ${periodThrough}` : "Actual · selected period"}</th><th>Monthly budget</th><th>Budget used</th><th>Warning at</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={row.category}>
        <td>{row.category}{!row.configured && <small className="muted-note"> · no longer in current category list</small>}</td>
        <td>{!overview.singleMonth ? "Select one month" : !overview.complete ? `Partial · ${formatMoney(row.actualUgx)}` : formatMoney(row.actualUgx)}</td>
        <td>{row.monthlyBudgetUgx === null ? "Not set" : formatMoney(row.monthlyBudgetUgx)}</td>
        <td>{!overview.singleMonth || row.utilizationPercent === null ? "—" : `${row.utilizationPercent}%`}</td>
        <td>{row.warningAtPercent === null ? "—" : `${row.warningAtPercent}%`}</td>
        <td><span className={`status-chip ${row.status === "threshold_reached" ? "status-warning" : row.status === "below_warning" ? "status-ok" : "status-info"}`}>{!overview.singleMonth ? "Select one month" : row.status === "not_set" ? "Not set" : row.status === "below_warning" ? "Within threshold" : row.status === "threshold_reached" ? "Review threshold reached" : "Incomplete actual"}</span></td>
        <td>{overview.canManage ? <>{row.configured && <button className="button" type="button" disabled={busy} onClick={() => editBudget(row)}>{row.monthlyBudgetUgx === null ? "Set" : "Edit"}</button>}{row.monthlyBudgetUgx !== null && <button className="button" type="button" disabled={busy} onClick={() => void archiveBudget(row)}>Archive</button>}</> : "—"}</td>
      </tr>)}</tbody></table></div> : <div className="empty-state compact-empty"><strong>No expense categories are configured.</strong><span>Add expense categories in Finance settings before creating budgets.</span></div>}
  </div>;
}
