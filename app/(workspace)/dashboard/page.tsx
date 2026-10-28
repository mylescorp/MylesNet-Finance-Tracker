"use client";

import { useQuery } from "convex/react";
import { ArrowDownRight, ArrowUpRight, CircleHelp, Download, Printer, Receipt, Share2, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { accountLabel } from "@/lib/finance";
import { Card, WorkspaceTitle } from "@/components/AppShell";
import { OwnerSetup } from "@/components/workspace/OwnerSetup";
import { ConvexLiveStatus } from "@/components/workspace/ConvexLiveStatus";
import { formatBusinessDay } from "@/lib/format";
import { AnalyticsInsights } from "@/components/workspace/AnalyticsInsights";

function todayKey(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function money(amount: number, scale = 1, locale = "en-UG") {
  const digits = Math.round(Math.log10(scale));
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount / scale);
}
function periodRange(period: string, today: string, weekStartsOn: "monday" | "sunday", fiscalStartMonth: number) {
  const date = new Date(`${today}T00:00:00Z`);
  let start = new Date(date);
  if (period === "week") {
    const offset = weekStartsOn === "sunday" ? date.getUTCDay() : (date.getUTCDay() + 6) % 7;
    start.setUTCDate(date.getUTCDate() - offset);
  }
  if (period === "month") start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (period === "year") {
    const year = date.getUTCMonth() + 1 < fiscalStartMonth ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
    start = new Date(Date.UTC(year, fiscalStartMonth - 1, 1));
  }
  const from = start.toISOString().slice(0, 10);
  const to = new Date(date.getTime() + 86400000).toISOString().slice(0, 10);
  return { from, toExclusive: to };
}

export default function DashboardPage() {
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState(todayKey("Africa/Kampala"));
  const [customTo, setCustomTo] = useState(todayKey("Africa/Kampala"));
  const [shareFeedback, setShareFeedback] = useState("");
  const settings = useQuery(api.settings.runtimeContext, {});
  const access = useQuery(api.workspace.currentAccess, {});
  const preferences = settings;
  const timezone = settings?.access === "ready" ? settings.timezone : "Africa/Kampala";
  const weekStartsOn = settings?.access === "ready" ? settings.weekStartsOn : "monday";
  const currency = settings?.access === "ready" ? settings.currency : "UGX";
  const currencyScale = 10 ** (preferences?.access === "ready" ? (preferences.currencyMinorDigits ?? 0) : 0);
  const locale = preferences?.access === "ready" ? preferences.locale : "en-UG";
  const dateFormat = preferences?.access === "ready" ? preferences.dateFormat : "DD/MM/YYYY";
  const fiscalStartMonth = preferences?.access === "ready" ? preferences.fiscalYearStartMonth : 1;
  const formatMoney = (amount: number) => money(amount, currencyScale, locale);
  const [businessDay, setBusinessDay] = useState(() => todayKey("Africa/Kampala"));
  useEffect(() => {
    const refreshBusinessDay = () => setBusinessDay(todayKey(timezone));
    refreshBusinessDay();
    const timer = window.setInterval(refreshBusinessDay, 30_000);
    window.addEventListener("focus", refreshBusinessDay);
    document.addEventListener("visibilitychange", refreshBusinessDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshBusinessDay);
      document.removeEventListener("visibilitychange", refreshBusinessDay);
    };
  }, [timezone]);
  const customRangeError = useMemo(() => {
    if (period !== "custom") return "";
    const isIsoDay = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    };
    if (!isIsoDay(customFrom) || !isIsoDay(customTo)) return "Choose both valid dates.";
    if (customFrom > customTo) return "The end date must be on or after the start date.";
    if (customTo > businessDay) return "The end date cannot be in the future.";
    if ((Date.parse(`${customTo}T00:00:00.000Z`) - Date.parse(`${customFrom}T00:00:00.000Z`)) / 86400000 + 1 > 370) return "Choose a period of 370 days or less.";
    return "";
  }, [period, customFrom, customTo, businessDay]);
  const customDatesValid = !customRangeError;
  const customRangeInvalid = period === "custom" && !customDatesValid;
  const range = useMemo(() => {
    if (period === "custom") {
      if (!customDatesValid) return periodRange("today", businessDay, weekStartsOn, fiscalStartMonth);
      const end = new Date(`${customTo}T00:00:00.000Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      return { from: customFrom, toExclusive: end.toISOString().slice(0, 10) };
    }
    return periodRange(period, businessDay, weekStartsOn, fiscalStartMonth);
  }, [period, businessDay, weekStartsOn, fiscalStartMonth, customFrom, customTo, customDatesValid]);
  const summary = useQuery(api.workspace.dashboardSummary, period !== "custom" || customDatesValid ? range : "skip");
  const todayRange = useMemo(() => periodRange("today", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const todaySummary = useQuery(api.workspace.dashboardSummary, todayRange);
  const weekRange = useMemo(() => periodRange("week", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const weekSummary = useQuery(api.workspace.dashboardSummary, weekRange);
  const yearRange = useMemo(() => periodRange("year", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const yearSummary = useQuery(api.workspace.dashboardSummary, yearRange);
  const trendRange = useMemo(() => {
    const end = new Date(`${businessDay}T00:00:00.000Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 13);
    end.setUTCDate(end.getUTCDate() + 1);
    return { from: start.toISOString().slice(0, 10), toExclusive: end.toISOString().slice(0, 10) };
  }, [businessDay]);
  const trendSummary = useQuery(api.workspace.dashboardSummary, trendRange);
  const recent = useQuery(api.workspace.recentEntries, { limit: 8 });
  const readySummary = summary?.access === "ready" ? summary : null;
  const isReady = readySummary !== null;
  const today = businessDay;
  const fmtDate = (value: string) => formatBusinessDay(value, dateFormat);
  const todaySales = todaySummary?.access === "ready" ? todaySummary.days.find((day) => day.day === today)?.salesUgx ?? 0 : 0;
  const dayBars = (trendSummary?.access === "ready" ? trendSummary.days : readySummary?.days.slice(-14)) ?? [];
  const peak = Math.max(1, ...dayBars.map((day) => day.salesUgx));
  const averageDay = readySummary ? Math.round(readySummary.salesUgx / Math.max(1, readySummary.days.filter((day) => day.salesUgx > 0).length)) : 0;
  const weekSales = weekSummary?.access === "ready" ? weekSummary.salesUgx : 0;
  const rangeLastDay = new Date(`${range.toExclusive}T00:00:00.000Z`);
  rangeLastDay.setUTCDate(rangeLastDay.getUTCDate() - 1);

  async function shareDashboard() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareFeedback("Dashboard link copied.");
      window.setTimeout(() => setShareFeedback(""), 3000);
    } catch {
      setShareFeedback("Copy this page URL to share the dashboard.");
    }
  }

  return <>
    <WorkspaceTitle eyebrow="MylesNet · Finance" title="Dashboard" description="A clear view of your recorded business activity." action={<label className="period-control">Period <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Dashboard period"><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option><option value="custom">Custom</option></select></label>} />
    {period === "custom" && <div className="custom-period-row"><label>From <input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>To <input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></label>{customRangeError && <span className="form-feedback form-error" role="alert">{customRangeError}</span>}</div>}
    <div className="dashboard-banner"><Image src="/brand/banner.png" alt="MylesNet Finance Tracker" fill priority sizes="(max-width: 760px) 100vw, 1100px" /><div className="banner-caption">Your business, clearly in view.</div></div>
    <div className="board-toolbar no-print">
      <ConvexLiveStatus />
      {customRangeInvalid ? <span className="toolbar-range">Complete the custom date range</span> : <span className="toolbar-range">{fmtDate(range.from)} — {fmtDate(rangeLastDay.toISOString().slice(0, 10))}</span>}
      <button className="button" type="button" onClick={() => window.print()}><Printer size={14} />Print</button>
      <button className="button" type="button" onClick={() => window.print()}><Download size={14} />Export PDF</button>
      <button className="button button-dark" type="button" onClick={() => void shareDashboard()}><Share2 size={14} />Share report</button>
      {shareFeedback && <span className="form-feedback" role="status">{shareFeedback}</span>}
    </div>
    {access?.access === "ready" && (access.permissions.includes("sales.create") || access.permissions.includes("expenses.create")) && <Card className="quick-add-strip no-print"><span className="eyebrow">Quick add</span>{access.permissions.includes("sales.create") && <Link className="button" href="/sales">+ Add sale</Link>}{access.permissions.includes("expenses.create") && <Link className="button" href="/expenses">+ Add expense</Link>}{access.permissions.includes("movements.create") && <Link className="button" href="/movements">Record withdrawal</Link>}{access.permissions.includes("partners.manage") && <Link className="button" href="/partners">Record payout</Link>}<span className="quick-add-note">Saved entries update cashbook totals and account balances.</span></Card>}
    <Card className="dashboard-sales-hero">
      <div className="hero-sales-number"><span className="eyebrow">Today’s sales · {fmtDate(today)}</span><strong>{isReady ? formatMoney(todaySales) : "—"}<small>{currency}</small></strong><span className="muted-note">Recorded sales only</span></div>
      <div className="hero-sales-trend"><div className="card-heading"><div><h2 className="card-title">Sales activity</h2><p className="card-subtitle">Daily totals · last 14 days</p></div></div>{customRangeInvalid ? <Empty message={customRangeError} /> : trendSummary === undefined ? <Empty message="Loading workspace data…" /> : trendSummary.access !== "ready" ? <Empty message="Trend data is not available for this workspace." /> : dayBars.length === 0 ? <Empty message="No sales have been recorded in the last 14 days." /> : <><div className="chart-bars" role="img" aria-label={`Sales over ${dayBars.length} days. Total ${formatMoney(trendSummary.salesUgx)} ${currency}.`}>{dayBars.map((day) => <div className="chart-day" key={day.day} title={`${fmtDate(day.day)}: ${formatMoney(day.salesUgx)} ${currency}`}><div className="chart-bar" style={{ height: `${Math.max(2, day.salesUgx / peak * 100)}%`, opacity: day.day === today ? 1 : 0.45 }} /></div>)}</div><div className="chart-labels"><span>{dayBars[0] ? fmtDate(dayBars[0].day) : ""}</span><span>{dayBars.at(-1) ? fmtDate(dayBars.at(-1)!.day) : ""}</span></div></>}</div>
      <div className="hero-sales-context"><div><span className="eyebrow">This week</span><strong>{weekSummary?.access === "ready" ? `${formatMoney(weekSales)} ${currency}` : "—"}</strong><span className="muted-note">Actual recorded sales</span></div><div><span className="eyebrow">Period average</span><strong>{readySummary ? `${formatMoney(averageDay)} ${currency}` : "—"}</strong><span className="muted-note">Per recorded sales day</span></div></div>
    </Card>
    <div className="metric-grid dashboard-kpi-grid">
      <Metric label="Sales today" value={isReady ? todaySales : null} note="Recorded entries only" currency={currency} scale={currencyScale} locale={locale} icon={<ArrowUpRight size={16} />} />
      <Metric label="Sales this period" value={readySummary?.salesUgx ?? null} note="Gross sales recorded" currency={currency} scale={currencyScale} locale={locale} icon={<Receipt size={16} />} />
      <Metric label="Expenses this period" value={readySummary?.expensesUgx ?? null} note="Expenses recorded" currency={currency} scale={currencyScale} locale={locale} icon={<ArrowDownRight size={16} />} />
      <Metric label="Net this period" value={readySummary?.netUgx ?? null} note="Sales less expenses" currency={currency} scale={currencyScale} locale={locale} icon={<Wallet size={16} />} />
    </div>
    <div className="balance-grid dashboard-balance-grid">
      <Metric label="Cash on hand" value={readySummary?.cashBalanceUgx ?? null} note="From entries recorded here" currency={currency} scale={currencyScale} locale={locale} icon={<Wallet size={16} />} />
      <Metric label="Mobile money" value={readySummary?.mobileMoneyBalanceUgx ?? null} note="From entries recorded here" currency={currency} scale={currencyScale} locale={locale} icon={<Wallet size={16} />} />
    </div>
    <div className="dashboard-period-row">
      <Card className="dashboard-period-card"><div className="card-heading"><div><h2 className="card-title">Year to date</h2><p className="card-subtitle">From your configured financial year</p></div></div><div className="dashboard-ytd-metrics"><div><span>Sales</span><strong>{yearSummary?.access === "ready" ? `${formatMoney(yearSummary.salesUgx)} ${currency}` : "—"}</strong></div><div><span>Expenses</span><strong>{yearSummary?.access === "ready" ? `${formatMoney(yearSummary.expensesUgx)} ${currency}` : "—"}</strong></div><div><span>Net</span><strong>{yearSummary?.access === "ready" ? `${formatMoney(yearSummary.netUgx)} ${currency}` : "—"}</strong></div></div></Card>
      <Card className="dashboard-period-card dashboard-trend-card"><div className="card-heading"><div><h2 className="card-title">Daily sales trend</h2><p className="card-subtitle">Last 14 days</p></div></div>{trendSummary?.access === "ready" ? <div className="mini-trend" role="img" aria-label="Daily sales trend for the last 14 days">{dayBars.map((day) => <span key={day.day} title={`${fmtDate(day.day)} · ${formatMoney(day.salesUgx)} ${currency}`} style={{ height: `${Math.max(4, day.salesUgx / peak * 100)}%` }} />)}</div> : <div className="muted-note">Trend is unavailable.</div>}</Card>
    </div>
    {summary?.access === "setup" && <Card className="workspace-setup-card"><div className="card-heading"><div><h2 className="card-title">Set up the first workspace owner</h2><p className="card-subtitle">Use this one-time setup only for a new workspace. It grants your account the owner role.</p></div></div><OwnerSetup /></Card>}
    {summary?.access === "pending" && <Card className="workspace-setup-card"><div className="card-heading"><div><h2 className="card-title">Workspace access pending</h2><p className="card-subtitle">Your account will appear in the workspace owner’s pending users list. The owner can approve it or send you an invitation.</p></div></div></Card>}
    <div className="dashboard-grid">
      <Card>
        <div className="card-heading"><div><h2 className="card-title">Performance by period</h2><p className="card-subtitle">Sales, expenses, and net from saved cashbook entries</p></div></div>
        {!isReady ? <Empty message={summary === undefined ? "Loading your workspace…" : summary.access === "pending" ? "Your workspace is waiting for an owner invitation." : "Finance totals are not available for this workspace."} /> : <div className="table-scroll"><table className="dashboard-performance-table"><thead><tr><th>Period</th><th>Sales</th><th>Expenses</th><th>Net</th></tr></thead><tbody>
          <PerformanceRow label="Today" summary={todaySummary?.access === "ready" ? todaySummary : null} day={today} currency={currency} formatMoney={formatMoney} />
          <PerformanceRow label="This week" summary={weekSummary?.access === "ready" ? weekSummary : null} currency={currency} formatMoney={formatMoney} />
          <PerformanceRow label="Selected period" summary={readySummary} currency={currency} formatMoney={formatMoney} />
          <PerformanceRow label="Year to date" summary={yearSummary?.access === "ready" ? yearSummary : null} currency={currency} formatMoney={formatMoney} />
        </tbody></table></div>}
      </Card>
      <Card>
        <div className="card-heading"><div><h2 className="card-title">Recent entries</h2><p className="card-subtitle">Latest cashbook activity</p></div><Link className="muted-note" href="/sales">View all</Link></div>
        {recent === undefined ? <Empty message="Loading entries…" /> : recent.length === 0 ? <Empty message={isReady ? "No entries yet. Add a sale or expense to begin." : summary?.access === "restricted" ? "Partner entry details are hidden until statement access is scoped." : "Entries appear here after you are invited to a workspace."} /> : <div className="entry-list">{recent.map((entry) => <div className="entry-row" key={entry._id}><div className="entry-main"><span className="entry-icon">{entry.kind === "sale" ? <Receipt size={16} /> : <Wallet size={16} />}</span><div style={{ minWidth: 0 }}><div className="entry-description">{entry.note || entry.category}</div><div className="entry-meta">{entry.category} · {fmtDate(entry.occurredOn)} · {accountLabel(entry.account)}{entry.state === "void" ? " · Voided" : ""}</div></div></div><span className={`entry-amount ${entry.state === "void" ? "muted-note" : entry.kind === "sale" ? "amount-positive" : "amount-negative"}`}>{entry.kind === "sale" ? "+" : "−"}{formatMoney(entry.amountUgx)}</span></div>)}</div>}
      </Card>
    </div>
    <div className="dashboard-insight-grid">
      <Card><div className="card-heading"><div><h2 className="card-title">Cash flow this period</h2><p className="card-subtitle">Sales, expenses, and net from saved entries.</p></div></div><FlowRow label="Sales" value={readySummary?.salesUgx ?? 0} max={Math.max(1, readySummary?.salesUgx ?? 0, readySummary?.expensesUgx ?? 0)} tone="sales" currency={currency} scale={currencyScale} locale={locale} /><FlowRow label="Expenses" value={readySummary?.expensesUgx ?? 0} max={Math.max(1, readySummary?.salesUgx ?? 0, readySummary?.expensesUgx ?? 0)} tone="expenses" currency={currency} scale={currencyScale} locale={locale} /><FlowRow label="Net" value={readySummary?.netUgx ?? 0} max={Math.max(1, readySummary?.salesUgx ?? 0, readySummary?.expensesUgx ?? 0)} tone="net" currency={currency} scale={currencyScale} locale={locale} /></Card>
      <Card><div className="card-heading"><div><h2 className="card-title">Account balances</h2><p className="card-subtitle">Balances reflect entries recorded in this workspace.</p></div></div><div className="balance-detail"><span>Cash on hand</span><strong>{isReady ? `${formatMoney(readySummary?.cashBalanceUgx ?? 0)} ${currency}` : "—"}</strong></div><div className="balance-detail"><span>Mobile money</span><strong>{isReady ? `${formatMoney(readySummary?.mobileMoneyBalanceUgx ?? 0)} ${currency}` : "—"}</strong></div><p className="muted-note">Add opening balances in Finance settings before using these as a full business position.</p></Card>
      <Card><div className="card-heading"><div><h2 className="card-title">Data health</h2><p className="card-subtitle">Coverage follows configured finance workflows.</p></div></div><div className="health-row"><span>Sales and expenses</span><span className="status-chip status-ok">Live</span></div><div className="health-row"><span>Recurring bills</span><span className="status-chip status-warning">Setup needed</span></div><div className="health-row"><span>Opening balance</span><span className="status-chip status-warning">Review</span></div><Link className="text-link" href="/reconcile">Review reconciliation →</Link></Card>
    </div>
    {!customRangeInvalid && <AnalyticsInsights range={range} today={today} currency={currency} scale={currencyScale} locale={locale} compact />}
  </>;
}

function Metric({ label, value, note, icon, currency, scale, locale }: { label: string; value: number | null; note: string; icon: ReactNode; currency: string; scale: number; locale: string }) {
  return <Card className="metric-card"><div className="card-heading"><span className="eyebrow">{label}</span><span className="entry-icon">{icon}</span></div><div className="metric-value">{value === null ? "—" : `${money(value, scale, locale)} ${currency}`}</div><div className="metric-note">{note}</div></Card>;
}

function Empty({ message }: { message: string }) {
  return <div className="empty-state"><CircleHelp size={20} style={{ margin: "0 auto 8px" }} /><strong>{message}</strong><span>Numbers are calculated from saved cashbook entries, not the sample figures in the design boards.</span></div>;
}

function PerformanceRow({ label, summary, day, currency, formatMoney }: { label: string; summary: { salesUgx: number; expensesUgx: number; netUgx: number; days: { day: string; salesUgx: number; expensesUgx: number }[] } | null; day?: string; currency: string; formatMoney: (amount: number) => string }) {
  const sales = summary ? day ? summary.days.find((item) => item.day === day)?.salesUgx ?? 0 : summary.salesUgx : null;
  const expenses = summary ? day ? summary.days.find((item) => item.day === day)?.expensesUgx ?? 0 : summary.expensesUgx : null;
  const net = sales === null || expenses === null ? null : sales - expenses;
  return <tr><th scope="row">{label}</th><td>{sales === null ? "—" : `${formatMoney(sales)} ${currency}`}</td><td>{expenses === null ? "—" : `${formatMoney(expenses)} ${currency}`}</td><td>{net === null ? "—" : `${formatMoney(net)} ${currency}`}</td></tr>;
}

function FlowRow({ label, value, max, tone, currency, scale, locale }: { label: string; value: number; max: number; tone: "sales" | "expenses" | "net"; currency: string; scale: number; locale: string }) {
  const width = Math.min(100, Math.abs(value) / max * 100);
  return <div className="flow-row"><div className="flow-label"><span>{label}</span><strong>{money(value, scale, locale)} {currency}</strong></div><div className="flow-track"><span className={`flow-fill flow-${tone}`} style={{ width: `${width}%` }} /></div></div>;
}
