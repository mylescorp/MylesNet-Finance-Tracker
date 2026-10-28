"use client";

import { useQuery } from "convex/react";
import { ArrowDownRight, ArrowUpRight, CircleHelp, Download, Printer, Receipt, Share2, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { accountLabel } from "@/lib/finance";
import { Card } from "@/components/AppShell";
import { OwnerSetup } from "@/components/workspace/OwnerSetup";
import { formatBusinessDay } from "@/lib/format";
import { AnalyticsInsights } from "@/components/workspace/AnalyticsInsights";
import { FinancePeriodFilters } from "@/components/workspace/FinancePeriodFilters";
import { InteractiveFinanceChart } from "@/components/workspace/InteractiveFinanceChart";
import { financePeriodRange, previousFinanceRange, validateFinanceCustomRange, type FinanceAccount, type FinancePeriod } from "@/lib/finance-period";

const dailyQuotes = [
  "Steady progress is built one good decision at a time.",
  "Clarity grows when you make time to review the numbers.",
  "Small steps, recorded consistently, build stronger businesses.",
  "A thoughtful plan turns today’s work into tomorrow’s momentum.",
  "Consistency turns ordinary effort into lasting progress.",
  "Good records make room for confident decisions.",
  "Every careful entry helps tell the story of your business.",
];

function timeOfDay(timezone: string) {
  try {
    const hour = Number(new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(new Date()));
    if (hour < 12) return "morning";
    if (hour < 17) return "afternoon";
    return "evening";
  } catch {
    return "day";
  }
}

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
  const [period, setPeriod] = useState<FinancePeriod>("monthly");
  const [account, setAccount] = useState<FinanceAccount>("all");
  const [customFrom, setCustomFrom] = useState(todayKey("Africa/Kampala"));
  const [customTo, setCustomTo] = useState(todayKey("Africa/Kampala"));
  const [shareFeedback, setShareFeedback] = useState("");
  const settings = useQuery(api.settings.runtimeContext, {});
  const access = useQuery(api.workspace.currentAccess, {});
  const profile = useQuery(api.users.profile, {});
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
  const [dayPeriod, setDayPeriod] = useState("day");
  useEffect(() => {
    const refreshBusinessDay = () => {
      setBusinessDay(todayKey(timezone));
      setDayPeriod(timeOfDay(timezone));
    };
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
  const customRangeError = useMemo(() => period === "custom" ? validateFinanceCustomRange(customFrom, customTo, businessDay) : "", [period, customFrom, customTo, businessDay]);
  const customDatesValid = !customRangeError;
  const customRangeInvalid = period === "custom" && !customDatesValid;
  const range = useMemo(() => {
    if (period === "custom" && !customDatesValid) return financePeriodRange("daily", businessDay, weekStartsOn, fiscalStartMonth, customFrom, customTo);
    return financePeriodRange(period, businessDay, weekStartsOn, fiscalStartMonth, customFrom, customTo);
  }, [period, businessDay, weekStartsOn, fiscalStartMonth, customFrom, customTo, customDatesValid]);
  const accountFilter = account === "all" ? {} : { account };
  const summary = useQuery(api.workspace.dashboardSummary, period !== "custom" || customDatesValid ? { ...range, ...accountFilter } : "skip");
  const previousRange = useMemo(() => previousFinanceRange(range), [range]);
  const previousSummary = useQuery(api.workspace.dashboardSummary, period !== "custom" || customDatesValid ? { ...previousRange, ...accountFilter } : "skip");
  const todayRange = useMemo(() => periodRange("today", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const todaySummary = useQuery(api.workspace.dashboardSummary, { ...todayRange, ...accountFilter });
  const weekRange = useMemo(() => periodRange("week", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const weekSummary = useQuery(api.workspace.dashboardSummary, { ...weekRange, ...accountFilter });
  const yearRange = useMemo(() => periodRange("year", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const yearSummary = useQuery(api.workspace.dashboardSummary, { ...yearRange, ...accountFilter });
  const recent = useQuery(api.workspace.recentEntries, { limit: 8 });
  const summaryData = summary?.access === "ready" ? summary : null;
  const readySummary = summaryData?.accountFilterComplete ? summaryData : null;
  const isReady = summaryData !== null;
  const today = businessDay;
  const fmtDate = (value: string) => formatBusinessDay(value, dateFormat);
  const todaySummaryReady = todaySummary?.access === "ready" && todaySummary.accountFilterComplete ? todaySummary : null;
  const weekSummaryReady = weekSummary?.access === "ready" && weekSummary.accountFilterComplete ? weekSummary : null;
  const yearSummaryReady = yearSummary?.access === "ready" && yearSummary.accountFilterComplete ? yearSummary : null;
  const todaySales = todaySummaryReady?.days.find((day) => day.day === today)?.salesUgx ?? null;
  const periodLength = Math.max(1, (Date.parse(`${range.toExclusive}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`)) / 86_400_000);
  const chartPoints = useMemo(() => {
    if (summary?.access !== "ready") return [];
    const currentDays = new Map(summary.days.map(day => [day.day, day]));
    const previousDays = new Map((previousSummary?.access === "ready" ? previousSummary.days : []).map(day => [day.day, day]));
    return Array.from({ length: periodLength }, (_, index) => {
      const dayDate = new Date(`${range.from}T00:00:00.000Z`);
      dayDate.setUTCDate(dayDate.getUTCDate() + index);
      const day = dayDate.toISOString().slice(0, 10);
      const previousDate = new Date(`${previousRange.from}T00:00:00.000Z`);
      previousDate.setUTCDate(previousDate.getUTCDate() + index);
      const previousDay = previousDate.toISOString().slice(0, 10);
      const current = currentDays.get(day);
      const prior = previousDays.get(previousDay);
      return { day, salesUgx: current?.salesUgx ?? 0, expensesUgx: current?.expensesUgx ?? 0, netUgx: (current?.salesUgx ?? 0) - (current?.expensesUgx ?? 0), previousSalesUgx: prior?.salesUgx ?? 0 };
    });
  }, [summary, previousSummary, periodLength, range.from, previousRange.from]);
  const dayBars = chartPoints.map(({ day, salesUgx }) => ({ day, salesUgx }));
  const peak = Math.max(1, ...dayBars.map((day) => day.salesUgx));
  const averageDay = readySummary ? Math.round(readySummary.salesUgx / Math.max(1, readySummary.days.filter((day) => day.salesUgx > 0).length)) : null;
  const weekSales = weekSummaryReady?.salesUgx ?? null;
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

  const quote = dailyQuotes[(Number(businessDay.replaceAll("-", "")) || 0) % dailyQuotes.length];
  const greetingName = profile?.displayName?.trim() || profile?.email?.split("@")[0] || "there";

  return <>
    <section className="dashboard-welcome" aria-label="Daily welcome">
      <div className="dashboard-welcome-copy">
        <div className="eyebrow">MylesNet · Finance · {fmtDate(today)}</div>
        <h1>Good {dayPeriod}, <span>{greetingName}.</span></h1>
        <p className="dashboard-welcome-subtitle">Your business, clearly in view. Here’s to a focused and productive day.</p>
        <p className="dashboard-daily-quote"><span aria-hidden="true">✦</span> {quote}</p>
      </div>
      <div className="dashboard-welcome-mark" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
    </section>
    <FinancePeriodFilters period={period} onPeriodChange={setPeriod} customFrom={customFrom} customTo={customTo} onCustomFromChange={setCustomFrom} onCustomToChange={setCustomTo} account={account} onAccountChange={setAccount} today={businessDay} />
    {customRangeError && <p className="form-feedback form-error finance-range-error" role="alert">{customRangeError}</p>}
    <div className="dashboard-banner"><Image src="/brand/banner.png" alt="MylesNet Finance Tracker" fill priority sizes="(max-width: 760px) 100vw, 1100px" /></div>
    <div className="board-toolbar no-print">
      {customRangeInvalid ? <span className="toolbar-range">Complete the custom date range</span> : <span className="toolbar-range">{fmtDate(range.from)} — {fmtDate(rangeLastDay.toISOString().slice(0, 10))}</span>}
      <button className="button" type="button" onClick={() => window.print()}><Printer size={14} />Print</button>
      <button className="button" type="button" onClick={() => window.print()}><Download size={14} />Export PDF</button>
      <button className="button button-dark" type="button" onClick={() => void shareDashboard()}><Share2 size={14} />Share report</button>
      {shareFeedback && <span className="form-feedback" role="status">{shareFeedback}</span>}
    </div>
    {access?.access === "ready" && (access.permissions.includes("sales.create") || access.permissions.includes("expenses.create")) && <Card className="quick-add-strip no-print"><span className="eyebrow">Quick add</span>{access.permissions.includes("sales.create") && <Link className="button" href="/sales">+ Add sale</Link>}{access.permissions.includes("expenses.create") && <Link className="button" href="/expenses">+ Add expense</Link>}{access.permissions.includes("movements.create") && <Link className="button" href="/movements">Record withdrawal</Link>}{access.permissions.includes("partners.manage") && <Link className="button" href="/partners">Record payout</Link>}<span className="quick-add-note">Saved entries update cashbook totals and account balances.</span></Card>}
    <Card className="dashboard-sales-hero">
      <div className="hero-sales-number"><span className="eyebrow">Today’s sales · {fmtDate(today)}</span><strong>{todaySales === null ? "—" : formatMoney(todaySales)}<small>{currency}</small></strong><span className="muted-note">{todaySummary?.access === "ready" && !todaySummary.accountFilterComplete ? "Unavailable · narrow the date range" : "Recorded sales only"}</span></div>
      <div className="hero-sales-trend"><div className="card-heading"><div><h2 className="card-title">Sales activity</h2><p className="card-subtitle">Sales, expenses, and net · compared with the previous period</p></div></div>{customRangeInvalid ? <Empty message={customRangeError} /> : summary === undefined || previousSummary === undefined ? <Empty message="Loading workspace data…" /> : summary.access !== "ready" || previousSummary.access !== "ready" ? <Empty message="Trend data is not available for this workspace." /> : <InteractiveFinanceChart points={chartPoints} currency={currency} scale={currencyScale} locale={locale} dateFormat={dateFormat} accountFiltered={account !== "all"} showPrevious={previousSummary.accountFilterComplete && previousSummary.days.some(day => day.salesUgx > 0 || day.expensesUgx > 0)} complete={summary.accountFilterComplete} compact />}</div>
      <div className="hero-sales-context"><div><span className="eyebrow">This week</span><strong>{weekSales === null ? "—" : `${formatMoney(weekSales)} ${currency}`}</strong><span className="muted-note">{weekSummary?.access === "ready" && !weekSummary.accountFilterComplete ? "Unavailable · narrow the date range" : "Actual recorded sales"}</span></div><div><span className="eyebrow">Period average</span><strong>{averageDay === null ? "—" : `${formatMoney(averageDay)} ${currency}`}</strong><span className="muted-note">Per recorded sales day</span></div></div>
    </Card>
    <div className="metric-grid dashboard-kpi-grid">
      <Metric label="Sales today" value={todaySales} note={todaySales === null && todaySummary?.access === "ready" ? "Unavailable · narrow the date range" : "Recorded entries only"} currency={currency} scale={currencyScale} locale={locale} icon={<ArrowUpRight size={16} />} />
      <Metric label="Sales this period" value={readySummary?.salesUgx ?? null} note={summaryData && !summaryData.accountFilterComplete ? "Unavailable · narrow the date range" : "Gross sales recorded"} currency={currency} scale={currencyScale} locale={locale} icon={<Receipt size={16} />} />
      <Metric label="Expenses this period" value={readySummary?.expensesUgx ?? null} note={summaryData && !summaryData.accountFilterComplete ? "Unavailable · narrow the date range" : "Expenses recorded"} currency={currency} scale={currencyScale} locale={locale} icon={<ArrowDownRight size={16} />} />
      <Metric label="Net this period" value={readySummary?.netUgx ?? null} note={summaryData && !summaryData.accountFilterComplete ? "Unavailable · narrow the date range" : "Sales less expenses"} currency={currency} scale={currencyScale} locale={locale} icon={<Wallet size={16} />} />
    </div>
    <div className="balance-grid dashboard-balance-grid">
      <Metric label="Cash on hand" value={readySummary?.cashBalanceUgx ?? null} note="From entries recorded here" currency={currency} scale={currencyScale} locale={locale} icon={<Wallet size={16} />} />
      <Metric label="Mobile money" value={readySummary?.mobileMoneyBalanceUgx ?? null} note="From entries recorded here" currency={currency} scale={currencyScale} locale={locale} icon={<Wallet size={16} />} />
    </div>
    <div className="dashboard-period-row">
      <Card className="dashboard-period-card"><div className="card-heading"><div><h2 className="card-title">Year to date</h2><p className="card-subtitle">From your configured financial year</p></div></div><div className="dashboard-ytd-metrics"><div><span>Sales</span><strong>{yearSummaryReady ? `${formatMoney(yearSummaryReady.salesUgx)} ${currency}` : "—"}</strong></div><div><span>Expenses</span><strong>{yearSummaryReady ? `${formatMoney(yearSummaryReady.expensesUgx)} ${currency}` : "—"}</strong></div><div><span>Net</span><strong>{yearSummaryReady ? `${formatMoney(yearSummaryReady.netUgx)} ${currency}` : "—"}</strong></div></div>{yearSummary?.access === "ready" && !yearSummary.accountFilterComplete && <p className="muted-note">Totals unavailable · narrow the date range to include every matching record.</p>}</Card>
      <Card className="dashboard-period-card dashboard-trend-card"><div className="card-heading"><div><h2 className="card-title">Daily sales trend</h2><p className="card-subtitle">Selected period</p></div></div>{summaryData && !summaryData.accountFilterComplete ? <div className="muted-note">Trend unavailable · narrow the date range.</div> : summary?.access === "ready" ? <div className="mini-trend" role="img" aria-label={`Daily sales trend for the selected ${period} period`}>{dayBars.map((day) => <span key={day.day} title={`${fmtDate(day.day)} · ${formatMoney(day.salesUgx)} ${currency}`} style={{ height: `${Math.max(4, day.salesUgx / peak * 100)}%` }} />)}</div> : <div className="muted-note">Trend is unavailable.</div>}</Card>
    </div>
    {summary?.access === "setup" && <Card className="workspace-setup-card"><div className="card-heading"><div><h2 className="card-title">Set up the first workspace owner</h2><p className="card-subtitle">Use this one-time setup only for a new workspace. It grants your account the owner role.</p></div></div><OwnerSetup /></Card>}
    {summary?.access === "pending" && <Card className="workspace-setup-card"><div className="card-heading"><div><h2 className="card-title">Workspace access pending</h2><p className="card-subtitle">Your account will appear in the workspace owner’s pending users list. The owner can approve it or send you an invitation.</p></div></div></Card>}
    <div className="dashboard-grid">
      <Card>
        <div className="card-heading"><div><h2 className="card-title">Performance by period</h2><p className="card-subtitle">Sales, expenses, and net from saved cashbook entries</p></div></div>
        {!isReady ? <Empty message={summary === undefined ? "Loading your workspace…" : summary.access === "pending" ? "Your workspace is waiting for an owner invitation." : "Finance totals are not available for this workspace."} /> : <div className="table-scroll"><table className="dashboard-performance-table"><thead><tr><th>Period</th><th>Sales</th><th>Expenses</th><th>Net</th></tr></thead><tbody>
          <PerformanceRow label="Today" summary={todaySummaryReady} day={today} currency={currency} formatMoney={formatMoney} />
          <PerformanceRow label="This week" summary={weekSummaryReady} currency={currency} formatMoney={formatMoney} />
          <PerformanceRow label="Selected period" summary={readySummary} currency={currency} formatMoney={formatMoney} />
          <PerformanceRow label="Year to date" summary={yearSummaryReady} currency={currency} formatMoney={formatMoney} />
        </tbody></table></div>}
      </Card>
      <Card>
        <div className="card-heading"><div><h2 className="card-title">Recent entries</h2><p className="card-subtitle">Latest cashbook activity</p></div><Link className="muted-note" href="/sales">View all</Link></div>
        {recent === undefined ? <Empty message="Loading entries…" /> : recent.length === 0 ? <Empty message={isReady ? "No entries yet. Add a sale or expense to begin." : summary?.access === "restricted" ? "Partner entry details are hidden until statement access is scoped." : "Entries appear here after you are invited to a workspace."} /> : <div className="entry-list">{recent.map((entry) => <div className="entry-row" key={entry._id}><div className="entry-main"><span className="entry-icon">{entry.kind === "sale" ? <Receipt size={16} /> : <Wallet size={16} />}</span><div style={{ minWidth: 0 }}><div className="entry-description">{entry.note || entry.category}</div><div className="entry-meta">{entry.category} · {fmtDate(entry.occurredOn)} · {accountLabel(entry.account)}{entry.state === "void" ? " · Voided" : ""}</div></div></div><span className={`entry-amount ${entry.state === "void" ? "muted-note" : entry.kind === "sale" ? "amount-positive" : "amount-negative"}`}>{entry.kind === "sale" ? "+" : "−"}{formatMoney(entry.amountUgx)}</span></div>)}</div>}
      </Card>
    </div>
    <div className="dashboard-insight-grid">
      <Card><div className="card-heading"><div><h2 className="card-title">Cash flow this period</h2><p className="card-subtitle">Sales, expenses, and net from saved entries.</p></div></div>{readySummary ? <><FlowRow label="Sales" value={readySummary.salesUgx} max={Math.max(1, readySummary.salesUgx, readySummary.expensesUgx)} tone="sales" currency={currency} scale={currencyScale} locale={locale} /><FlowRow label="Expenses" value={readySummary.expensesUgx} max={Math.max(1, readySummary.salesUgx, readySummary.expensesUgx)} tone="expenses" currency={currency} scale={currencyScale} locale={locale} /><FlowRow label="Net" value={readySummary.netUgx} max={Math.max(1, readySummary.salesUgx, readySummary.expensesUgx)} tone="net" currency={currency} scale={currencyScale} locale={locale} /></> : <p className="muted-note">Cash flow totals unavailable · narrow the date range or wait for workspace data.</p>}</Card>
      <Card><div className="card-heading"><div><h2 className="card-title">Account balances</h2><p className="card-subtitle">Balances reflect entries recorded in this workspace.</p></div></div><div className="balance-detail"><span>Cash on hand</span><strong>{isReady ? `${formatMoney(summaryData?.cashBalanceUgx ?? 0)} ${currency}` : "—"}</strong></div><div className="balance-detail"><span>Mobile money</span><strong>{isReady ? `${formatMoney(summaryData?.mobileMoneyBalanceUgx ?? 0)} ${currency}` : "—"}</strong></div><p className="muted-note">Add opening balances in Finance settings before using these as a full business position.</p></Card>
      <Card><div className="card-heading"><div><h2 className="card-title">Data health</h2><p className="card-subtitle">Coverage follows configured finance workflows.</p></div></div><div className="health-row"><span>Sales and expenses</span><span className="status-chip status-ok">Live</span></div><div className="health-row"><span>Recurring bills</span><span className="status-chip status-warning">Setup needed</span></div><div className="health-row"><span>Opening balance</span><span className="status-chip status-warning">Review</span></div><Link className="text-link" href="/reconcile">Review reconciliation →</Link></Card>
    </div>
    {!customRangeInvalid && <AnalyticsInsights range={range} today={today} currency={currency} scale={currencyScale} locale={locale} compact account={account === "all" ? undefined : account} />}
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
