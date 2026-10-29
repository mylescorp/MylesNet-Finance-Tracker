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
  const analyticsOverview = useQuery(api.analytics.overview, access?.access === "ready" && (period !== "custom" || customDatesValid) ? { businessId: access.businessId, ...range, today: businessDay, ...(account === "all" ? {} : { account }) } : "skip");
  const previousRange = useMemo(() => previousFinanceRange(range), [range]);
  const previousSummary = useQuery(api.workspace.dashboardSummary, period !== "custom" || customDatesValid ? { ...previousRange, ...accountFilter } : "skip");
  const todayRange = useMemo(() => periodRange("today", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const todaySummary = useQuery(api.workspace.dashboardSummary, { ...todayRange, ...accountFilter });
  const weekRange = useMemo(() => periodRange("week", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const weekSummary = useQuery(api.workspace.dashboardSummary, { ...weekRange, ...accountFilter });
  const fourteenDayRange = useMemo(() => {
    const fromDate = new Date(`${businessDay}T00:00:00.000Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - 13);
    const toDate = new Date(`${businessDay}T00:00:00.000Z`);
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    return { from: fromDate.toISOString().slice(0, 10), toExclusive: toDate.toISOString().slice(0, 10) };
  }, [businessDay]);
  const fourteenDaySummary = useQuery(api.workspace.dashboardSummary, { ...fourteenDayRange, ...accountFilter });
  const yearRange = useMemo(() => periodRange("year", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const yearSummary = useQuery(api.workspace.dashboardSummary, { ...yearRange, ...accountFilter });
  const monthRange = useMemo(() => periodRange("month", businessDay, weekStartsOn, fiscalStartMonth), [businessDay, weekStartsOn, fiscalStartMonth]);
  const monthSummary = useQuery(api.workspace.dashboardSummary, { ...monthRange, ...accountFilter });
  const recent = useQuery(api.workspace.recentEntries, { limit: 8 });
  const summaryData = summary?.access === "ready" ? summary : null;
  const readySummary = summaryData?.accountFilterComplete ? summaryData : null;
  const isReady = summaryData !== null;
  const today = businessDay;
  const fmtDate = (value: string) => formatBusinessDay(value, dateFormat);
  const todaySummaryReady = todaySummary?.access === "ready" && todaySummary.accountFilterComplete ? todaySummary : null;
  const todayBalanceReady = todaySummary?.access === "ready" ? todaySummary : null;
  const weekSummaryReady = weekSummary?.access === "ready" && weekSummary.accountFilterComplete ? weekSummary : null;
  const yearSummaryReady = yearSummary?.access === "ready" && yearSummary.accountFilterComplete ? yearSummary : null;
  const monthSummaryReady = monthSummary?.access === "ready" && monthSummary.accountFilterComplete ? monthSummary : null;
  const fourteenDaySummaryReady = fourteenDaySummary?.access === "ready" && fourteenDaySummary.accountFilterComplete ? fourteenDaySummary : null;
  const todaySales = todaySummaryReady ? todaySummaryReady.days.find((day) => day.day === today)?.salesUgx ?? 0 : null;
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
  const fourteenDayChartPoints = useMemo(() => {
    if (!fourteenDaySummaryReady) return [];
    return Array.from({ length: 14 }, (_, index) => {
      const date = new Date(`${fourteenDayRange.from}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const day = date.toISOString().slice(0, 10);
      const row = fourteenDaySummaryReady.days.find(item => item.day === day);
      return { day, salesUgx: row?.salesUgx ?? 0, expensesUgx: row?.expensesUgx ?? 0, netUgx: (row?.salesUgx ?? 0) - (row?.expensesUgx ?? 0), previousSalesUgx: 0 };
    });
  }, [fourteenDaySummaryReady, fourteenDayRange.from]);
  const averageDay = readySummary ? Math.round(readySummary.salesUgx / Math.max(1, readySummary.days.filter((day) => day.salesUgx > 0).length)) : null;
  const weekSales = weekSummaryReady?.salesUgx ?? null;
  const monthlySalesTarget = analyticsOverview?.access === "ready" ? analyticsOverview.target.amountUgx : 0;
  const weeklySalesTarget = analyticsOverview?.access === "ready" && analyticsOverview.target.monthComplete ? analyticsOverview.target.weeklyAmountUgx : null;
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
      <div className="hero-sales-trend"><div className="card-heading"><div><h2 className="card-title">Sales activity</h2><p className="card-subtitle">Sales, expenses, and net · compared with the previous period</p></div></div>{customRangeInvalid ? <Empty message={customRangeError} /> : summary === undefined || previousSummary === undefined ? <Empty message="Loading workspace data…" /> : summary.access !== "ready" || previousSummary.access !== "ready" ? <Empty message="Trend data is not available for this workspace." /> : <InteractiveFinanceChart points={chartPoints} currency={currency} scale={currencyScale} locale={locale} dateFormat={dateFormat} accountFiltered={account !== "all"} showPrevious={previousSummary.accountFilterComplete && previousSummary.days.some(day => day.salesUgx > 0 || day.expensesUgx > 0)} complete={summary.accountFilterComplete} compact highlightDay={today} />}</div>
      <div className="hero-sales-context"><div><div className="dashboard-progress-heading"><span className="eyebrow">This week</span><strong>{weekSales === null ? "—" : formatMoney(weekSales)}</strong></div><Meter value={weekSales ?? 0} max={Math.max(1, weeklySalesTarget ?? 0)} /><span className="muted-note">{weeklySalesTarget ? `${Math.round((weekSales ?? 0) / weeklySalesTarget * 100)}% of estimated weekly target` : analyticsOverview?.access === "ready" && !analyticsOverview.target.monthComplete ? "Target pace unavailable · narrow the date range" : "Set a monthly target to track weekly pace"}</span></div><div><div className="dashboard-progress-heading"><span className="eyebrow">This month</span><strong>{monthSummaryReady ? formatMoney(monthSummaryReady.salesUgx) : "—"}</strong></div><Meter value={monthSummaryReady?.salesUgx ?? 0} max={Math.max(1, monthlySalesTarget)} /><span className="muted-note">{monthlySalesTarget ? `${Math.round((monthSummaryReady?.salesUgx ?? 0) / monthlySalesTarget * 100)}% of monthly target` : "Set a monthly target to track pace"}</span></div><div><span className="eyebrow">Period average</span><strong>{averageDay === null ? "—" : `${formatMoney(averageDay)} ${currency}`}</strong><span className="muted-note">Per recorded sales day</span></div></div>
    </Card>
    <section className="dashboard-reference-cards" aria-label="Dashboard finance overview">
      <div className="dashboard-reference-kpis">
        <Card className="dashboard-reference-metric"><span className="eyebrow">Sales this month</span><strong className="dashboard-reference-value">{monthSummaryReady ? formatMoney(monthSummaryReady.salesUgx) : "—"}</strong><div className="dashboard-reference-detail"><span>Today</span><strong>{todaySales === null ? "—" : formatMoney(todaySales)}</strong></div><div className="dashboard-reference-detail"><span>This week</span><strong>{weekSales === null ? "—" : formatMoney(weekSales)}</strong></div></Card>
        <Card className="dashboard-reference-metric"><span className="eyebrow">Expenses this month</span><strong className="dashboard-reference-value">{monthSummaryReady ? formatMoney(monthSummaryReady.expensesUgx) : "—"}</strong><div className="dashboard-reference-detail"><span>Share of sales</span><strong>{monthSummaryReady && monthSummaryReady.salesUgx > 0 ? `${Math.round(monthSummaryReady.expensesUgx / monthSummaryReady.salesUgx * 100)}%` : "—"}</strong></div><Meter value={monthSummaryReady && monthSummaryReady.salesUgx > 0 ? monthSummaryReady.expensesUgx : 0} max={Math.max(1, monthSummaryReady?.salesUgx ?? 0)} tone="expenses" /></Card>
        <Card className="dashboard-reference-metric"><span className="eyebrow">Net this month</span><strong className={`dashboard-reference-value ${monthSummaryReady && monthSummaryReady.netUgx < 0 ? "amount-negative" : ""}`}>{monthSummaryReady ? formatMoney(monthSummaryReady.netUgx) : "—"}</strong><div className="dashboard-reference-detail"><span>Margin</span><strong>{monthSummaryReady && monthSummaryReady.salesUgx > 0 ? `${(monthSummaryReady.netUgx / monthSummaryReady.salesUgx * 100).toFixed(1)}%` : "—"}</strong></div><Meter value={monthSummaryReady && monthSummaryReady.netUgx > 0 ? monthSummaryReady.netUgx : 0} max={Math.max(1, monthSummaryReady?.salesUgx ?? 0)} tone="net" /></Card>
        <Card className="dashboard-reference-metric dashboard-reference-total-balance"><span className="eyebrow">Total balance</span><strong className="dashboard-reference-value accent">{todayBalanceReady ? formatMoney(todayBalanceReady.totalBalanceUgx) : "—"}</strong><div className="dashboard-reference-detail"><span><i className="balance-dot cash" />Cash on hand</span><strong>{todayBalanceReady ? formatMoney(todayBalanceReady.cashBalanceUgx) : "—"}</strong></div><div className="dashboard-reference-detail"><span><i className="balance-dot mobile" />Mobile money</span><strong>{todayBalanceReady ? formatMoney(todayBalanceReady.mobileMoneyBalanceUgx) : "—"}</strong></div></Card>
        <Card className="dashboard-reference-metric"><span className="eyebrow">Active loans</span><strong className="dashboard-reference-value">{analyticsOverview?.access === "ready" && analyticsOverview.dashboardCards?.loansComplete ? analyticsOverview.dashboardCards.activeLoanCount ? formatMoney(analyticsOverview.dashboardCards.activeLoanTotalUgx) : "—" : "—"}</strong><div className="dashboard-reference-detail"><span>Monthly payments · estimate</span><strong>{analyticsOverview?.access === "ready" && analyticsOverview.dashboardCards?.loansComplete ? formatMoney(analyticsOverview.dashboardCards.estimatedMonthlyLoanPaymentsUgx) : "—"}</strong></div><div className="dashboard-reference-detail"><span>Status</span><strong>{analyticsOverview?.access === "ready" && analyticsOverview.dashboardCards?.loansComplete ? analyticsOverview.dashboardCards.activeLoanCount ? "Active" : "None active" : "Unavailable"}</strong></div><Link className="text-link" href="/loans">Open loans →</Link></Card>
        <Card className="dashboard-reference-metric"><span className="eyebrow">Savings & investments</span><strong className="dashboard-reference-value">{analyticsOverview?.access === "ready" && analyticsOverview.dashboardCards?.savingsComplete && analyticsOverview.dashboardCards.savingsTotalUgx > 0 ? formatMoney(analyticsOverview.dashboardCards.savingsTotalUgx) : "—"}</strong><div className="dashboard-reference-detail"><span>Gain / loss</span><strong>Not tracked</strong></div><div className="dashboard-reference-detail"><span>Status</span><strong>{analyticsOverview?.access === "ready" && analyticsOverview.dashboardCards?.savingsComplete ? analyticsOverview.dashboardCards.savingsTotalUgx > 0 ? "Holdings recorded" : "No holdings" : "Unavailable"}</strong></div><Link className="text-link" href="/savings">Open savings →</Link></Card>
      </div>
      <div className="dashboard-reference-ytd-row">
        <ReferenceMetric label="Revenue year to date" value={yearSummaryReady?.salesUgx ?? null} note="Sales" currency={currency} formatMoney={formatMoney} />
        <ReferenceMetric label="Expenses year to date" value={yearSummaryReady?.expensesUgx ?? null} note="Recorded expenses" currency={currency} formatMoney={formatMoney} />
        <ReferenceMetric label="Net year to date" value={yearSummaryReady?.netUgx ?? null} note="Sales less expenses" currency={currency} formatMoney={formatMoney} tone={yearSummaryReady && yearSummaryReady.netUgx < 0 ? "amount-negative" : ""} />
        <Card className="dashboard-reference-metric"><span className="eyebrow">Net margin year to date</span><strong className={`dashboard-reference-value ${yearSummaryReady && yearSummaryReady.netUgx < 0 ? "amount-negative" : ""}`}>{yearSummaryReady && yearSummaryReady.salesUgx > 0 ? `${(yearSummaryReady.netUgx / yearSummaryReady.salesUgx * 100).toFixed(1)}%` : "—"}</strong><div className="dashboard-reference-detail"><span>Basis</span><strong>Net ÷ sales</strong></div></Card>
        <Card className="dashboard-reference-summary dashboard-reference-mini-trend">
          <div className="card-heading"><div><h2 className="card-title">14-day sales trend</h2><p className="card-subtitle">Selected period · today highlighted</p></div></div>
          {fourteenDaySummary === undefined ? <p className="muted-note">Loading trend…</p> : fourteenDaySummaryReady === null ? <p className="muted-note">Trend unavailable for this view.</p> : <InteractiveFinanceChart points={fourteenDayChartPoints} currency={currency} scale={currencyScale} locale={locale} dateFormat={dateFormat} accountFiltered={account !== "all"} compact mini showPrevious={false} highlightDay={today} />}
        </Card>
      </div>
    </section>
    {analyticsOverview?.access === "ready" && analyticsOverview.dashboardCards && <>
      <section className="dashboard-reference-overview-grid" aria-label="Cash flow and workspace health">
        <Card><CardHeading title="Cash flow · this period" subtitle="Saved sales, expenses, and net" />{readySummary ? <><FlowRow label="Sales" value={readySummary.salesUgx} max={Math.max(1, readySummary.salesUgx, readySummary.expensesUgx)} tone="sales" currency={currency} scale={currencyScale} locale={locale} /><FlowRow label="Expenses" value={readySummary.expensesUgx} max={Math.max(1, readySummary.salesUgx, readySummary.expensesUgx)} tone="expenses" currency={currency} scale={currencyScale} locale={locale} /><FlowRow label="Net" value={readySummary.netUgx} max={Math.max(1, readySummary.salesUgx, readySummary.expensesUgx)} tone="net" currency={currency} scale={currencyScale} locale={locale} /></> : <p className="muted-note">Totals unavailable for this view.</p>}</Card>
        <Card><CardHeading title="Balance composition" subtitle={`Current recorded balance · ${formatMoney(analyticsOverview.balances.totalUgx)} ${currency}`} /><BalanceBar label="Cash on hand" value={analyticsOverview.balances.cashUgx} share={analyticsOverview.balances.cashShareBps} currency={currency} formatMoney={formatMoney} /><BalanceBar label="Mobile money" value={analyticsOverview.balances.mobileMoneyUgx} share={analyticsOverview.balances.mobileShareBps} currency={currency} formatMoney={formatMoney} /></Card>
        <Card><CardHeading title="Profit split · partners" subtitle="Illustrative share of selected-period cashbook net" />{!analyticsOverview.partnerChartComplete ? <p className="muted-note">Partner shares unavailable · narrow the reporting period to include all matching entries.</p> : analyticsOverview.partners.length && analyticsOverview.ownershipComplete ? <div className="dashboard-partner-split"><PartnerDonut partners={analyticsOverview.partnerChart} /><div>{analyticsOverview.partnerChart.map(partner => <div className="dashboard-partner-legend" key={partner.id}><i /><span>{partner.name} · {(partner.ownershipBps / 100).toFixed(1)}%</span><strong>{formatMoney(partner.shareOfNetUgx)}</strong></div>)}</div></div> : <p className="muted-note">{analyticsOverview.partners.length ? "Ownership must total 100% before profit shares can be shown." : "No active partners are configured."}</p>}<p className="muted-note">Illustration only; it is not an approved payout.</p></Card>
        <Card><CardHeading title="Data health" subtitle="Checks based on recorded workspace data" />{analyticsOverview.issues.slice(0, 3).map(issue => <div className="dashboard-detail-row" key={issue.id}><span>{issue.title}</span><Link href={issue.href}>Review</Link></div>)}{!analyticsOverview.issues.length && <div className="health-row"><span>No open flags found</span><span className="status-chip status-ok">Clear</span></div>}<Link className="text-link" href="/issues">Review all checks →</Link></Card>
      </section>
      <section className="dashboard-operations-grid" aria-label="Finance operations overview">
        <Card><CardHeading title="Cash runway" badge={analyticsOverview.dashboardCards.cashRunwayComplete && analyticsOverview.dashboardCards.cashRunwayDays !== null && analyticsOverview.dashboardCards.cashRunwayDays < 30 ? "Below alert" : undefined} /><strong className="dashboard-operations-value">{!analyticsOverview.dashboardCards.cashRunwayComplete ? "Unavailable" : analyticsOverview.dashboardCards.cashRunwayDays === null ? "—" : `≈ ${analyticsOverview.dashboardCards.cashRunwayDays} days`}</strong><p className="muted-note">{analyticsOverview.dashboardCards.cashRunwayComplete ? "Based on cash on hand and average daily expenses over the last 30 days." : account === "mobile_money" || account === "unallocated" ? "Cash runway is unavailable for this account filter." : "Cash runway is unavailable until recent finance data is complete."}</p><Meter value={analyticsOverview.balances.cashUgx} max={Math.max(1, analyticsOverview.balances.lowCashThresholdUgx)} /><div className="dashboard-detail-row"><span>Cash on hand</span><strong>{formatMoney(analyticsOverview.balances.cashUgx)} {currency}</strong></div><div className="dashboard-detail-row"><span>Shortfall to alert level</span><strong>{formatMoney(Math.max(0, analyticsOverview.balances.lowCashThresholdUgx - analyticsOverview.balances.cashUgx))} {currency}</strong></div></Card>
        <Card><CardHeading title="Centipid withdrawal" badge={analyticsOverview.dashboardCards.withdrawalTotalUgx ? "Action needed" : undefined} /><strong className="dashboard-operations-value">{analyticsOverview.dashboardCards.withdrawalComplete ? `${formatMoney(analyticsOverview.dashboardCards.withdrawalTotalUgx)} ${currency}` : "Unavailable"}</strong><p className="muted-note">Recorded posted withdrawals this month.</p><div className="dashboard-detail-row"><span>Withdrawals recorded</span><strong>{analyticsOverview.dashboardCards.withdrawalComplete ? analyticsOverview.dashboardCards.withdrawalCount : "—"}</strong></div><div className="dashboard-detail-row"><span>Last withdrawal</span><strong>{analyticsOverview.dashboardCards.lastWithdrawalOn ? fmtDate(analyticsOverview.dashboardCards.lastWithdrawalOn) : "None"}</strong></div><Link className="button dashboard-card-action" href="/movements">Record withdrawal</Link></Card>
        <Card><CardHeading title="Reconciliation" badge={analyticsOverview.dashboardCards.reconciliationCount ? "Differs" : undefined} /><strong className="dashboard-operations-value">{analyticsOverview.dashboardCards.reconciliationComplete ? `${formatMoney(analyticsOverview.dashboardCards.reconciliationDifferenceUgx)} ${currency}` : "Unavailable"}</strong><p className="muted-note">Open account differences recorded in the last 90 days.</p><div className="dashboard-detail-row"><span>Open reconciliations</span><strong>{analyticsOverview.dashboardCards.reconciliationComplete ? analyticsOverview.dashboardCards.reconciliationCount : "—"}</strong></div><Link className="button dashboard-card-action" href="/reconcile">Review entries</Link></Card>
        <Card><CardHeading title="Monthly target" badge={analyticsOverview.target.monthComplete && analyticsOverview.target.amountUgx > 0 && analyticsOverview.target.monthSalesUgx < analyticsOverview.target.monthPaceRequiredUgx ? "Behind pace" : undefined} /><strong className="dashboard-operations-value">{analyticsOverview.target.amountUgx > 0 ? `${formatMoney(analyticsOverview.target.amountUgx)} ${currency}` : "Not set"}</strong><p className="muted-note">Month to date · {analyticsOverview.target.monthComplete ? `${formatMoney(analyticsOverview.target.monthSalesUgx)} ${currency} recorded` : "Unavailable · narrow the date range to include all entries"}</p><Meter value={analyticsOverview.target.monthComplete && analyticsOverview.target.amountUgx ? analyticsOverview.target.monthSalesUgx : 0} max={Math.max(1, analyticsOverview.target.amountUgx)} /><div className="dashboard-detail-row"><span>Projected finish</span><strong>{!analyticsOverview.target.monthComplete ? "Unavailable" : analyticsOverview.target.amountUgx ? `${Math.round(analyticsOverview.target.projectedSalesUgx / analyticsOverview.target.amountUgx * 100)}% of target` : "Set a target in Settings"}</strong></div><div className="dashboard-detail-row"><span>Needed per day</span><strong>{!analyticsOverview.target.monthComplete ? "Unavailable" : analyticsOverview.target.amountUgx ? `${formatMoney(analyticsOverview.target.requiredSalesPerDayUgx)} ${currency}` : "—"}</strong></div></Card>
        <Card><CardHeading title="Equipment payback" badge="Not tracked" /><strong className="dashboard-operations-value">—</strong><p className="muted-note">Equipment investment and recovered value are not recorded in this workspace.</p><Link className="text-link" href="/settings/data">Review finance data →</Link></Card>
        <Card><CardHeading title="Payout readiness" badge={analyticsOverview.dashboardCards.payoutBalanceUgx ? "Pending" : undefined} /><div className="dashboard-detail-row"><span>Approved unpaid partner payouts</span><strong>{analyticsOverview.dashboardCards.payoutsComplete ? `${formatMoney(analyticsOverview.dashboardCards.payoutBalanceUgx)} ${currency}` : "Unavailable"}</strong></div><div className="dashboard-detail-row"><span>Outstanding distributions</span><strong>{analyticsOverview.dashboardCards.payoutsComplete ? analyticsOverview.dashboardCards.payoutCount : "—"}</strong></div><p className="muted-note">Partners are ready for payout only when their recorded distribution balance is positive and approved.</p><Link className="text-link" href="/partners">Review partner distributions →</Link></Card>
      </section>
      <section className="dashboard-reference-secondary dashboard-reference-breakdowns" aria-label="Income, expenses and obligations">
        <Card className="dashboard-reference-summary"><CardHeading title="Sales by income type" subtitle="Selected period · posted entries" />{analyticsOverview.dashboardCards.salesCategories.complete ? <CategoryRows rows={analyticsOverview.dashboardCards.salesCategories.rows} currency={currency} formatMoney={formatMoney} /> : <p className="muted-note">Breakdown unavailable · narrow the date range.</p>}</Card>
        <Card className="dashboard-reference-summary"><CardHeading title="Expenses by category" subtitle="Selected period · posted entries" />{analyticsOverview.dashboardCards.expenseCategories.complete ? <CategoryRows rows={analyticsOverview.dashboardCards.expenseCategories.rows} currency={currency} formatMoney={formatMoney} /> : <p className="muted-note">Breakdown unavailable · narrow the date range.</p>}</Card>
        <Card className="dashboard-reference-summary"><CardHeading title="Wealth & debt summary" subtitle="Recorded balances and obligations" /><div className="dashboard-detail-row"><span>Savings holdings</span><strong>{analyticsOverview.dashboardCards.savingsComplete ? `${formatMoney(analyticsOverview.dashboardCards.savingsTotalUgx)} ${currency}` : "Unavailable"}</strong></div><div className="dashboard-detail-row"><span>Outstanding loans</span><strong>{analyticsOverview.dashboardCards.loansComplete ? `${formatMoney(analyticsOverview.dashboardCards.activeLoanTotalUgx)} ${currency}` : "Unavailable"}</strong></div><div className="dashboard-detail-row"><span>Net recorded position</span><strong>{analyticsOverview.dashboardCards.netRecordedPositionComplete ? `${formatMoney(analyticsOverview.dashboardCards.netRecordedPositionUgx)} ${currency}` : "Unavailable"}</strong></div><p className="muted-note">Excludes unrecorded assets and investment valuations.</p></Card>
        <Card className="dashboard-reference-summary"><CardHeading title="Recurring bills needing attention" subtitle="Overdue or due in the next 30 days" />{analyticsOverview.dashboardCards.upcomingBillsComplete ? analyticsOverview.dashboardCards.upcomingBills.length ? analyticsOverview.dashboardCards.upcomingBills.slice(0, 4).map(bill => <div className="dashboard-detail-row" key={`${bill.name}:${bill.nextDueOn}`}><span>{bill.name} · {bill.overdue ? "Overdue" : fmtDate(bill.nextDueOn)}</span><strong>{formatMoney(bill.amountUgx)} {currency}</strong></div>) : <p className="muted-note">Nothing due in the next 30 days.</p> : <p className="muted-note">Bill data is not available for this role or view.</p>}<Link className="text-link" href="/bills">Review bills →</Link></Card>
      </section>
      <section className="dashboard-activity-grid" aria-label="Upcoming items and audit activity">
        <Card><CardHeading title="Upcoming · next 30 days" subtitle="Scheduled bills that may need attention" />{analyticsOverview.dashboardCards.upcomingBillsComplete && analyticsOverview.dashboardCards.upcomingBills.length ? analyticsOverview.dashboardCards.upcomingBills.slice(0, 5).map(bill => <div className="dashboard-detail-row" key={`upcoming:${bill.name}:${bill.nextDueOn}`}><span>{fmtDate(bill.nextDueOn)} · {bill.name}</span><strong>{formatMoney(bill.amountUgx)} {currency}</strong></div>) : <p className="muted-note">No upcoming bills recorded, or bill access is unavailable.</p>}</Card>
        <Card><CardHeading title="Audit trail · dashboard" subtitle="Recent audited workspace actions" badge={analyticsOverview.dashboardCards.auditAvailable ? "Logged" : undefined} />{analyticsOverview.dashboardCards.auditAvailable && analyticsOverview.dashboardCards.recentAudit.length ? analyticsOverview.dashboardCards.recentAudit.slice(0, 5).map(event => <div className="dashboard-detail-row" key={event.id}><span>{event.summary} · {event.actor}</span><strong>{new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(event.occurredAt)}</strong></div>) : <p className="muted-note">{analyticsOverview.dashboardCards.auditAvailable ? "No recent audit events." : "Audit details are unavailable for your role."}</p>}<Link className="text-link" href="/audits">Open audit log →</Link></Card>
      </section>
    </>}
    <div className="metric-grid dashboard-kpi-grid">
      <Metric label="Sales today" value={todaySales} note={todaySales === null && todaySummary?.access === "ready" ? "Unavailable · narrow the date range" : "Recorded entries only"} currency={currency} scale={currencyScale} locale={locale} icon={<ArrowUpRight size={16} />} />
      <Metric label="Sales this period" value={readySummary?.salesUgx ?? null} note={summaryData && !summaryData.accountFilterComplete ? "Unavailable · narrow the date range" : "Gross sales recorded"} currency={currency} scale={currencyScale} locale={locale} icon={<Receipt size={16} />} />
      <Metric label="Expenses this period" value={readySummary?.expensesUgx ?? null} note={summaryData && !summaryData.accountFilterComplete ? "Unavailable · narrow the date range" : "Expenses recorded"} currency={currency} scale={currencyScale} locale={locale} icon={<ArrowDownRight size={16} />} />
      <Metric label="Net this period" value={readySummary?.netUgx ?? null} note={summaryData && !summaryData.accountFilterComplete ? "Unavailable · narrow the date range" : "Sales less expenses"} currency={currency} scale={currencyScale} locale={locale} icon={<Wallet size={16} />} />
    </div>
    <div className="dashboard-period-row">
      <Card className="dashboard-period-card"><div className="card-heading"><div><h2 className="card-title">Year to date</h2><p className="card-subtitle">From your configured financial year</p></div></div><div className="dashboard-ytd-metrics"><div><span>Sales</span><strong>{yearSummaryReady ? `${formatMoney(yearSummaryReady.salesUgx)} ${currency}` : "—"}</strong></div><div><span>Expenses</span><strong>{yearSummaryReady ? `${formatMoney(yearSummaryReady.expensesUgx)} ${currency}` : "—"}</strong></div><div><span>Net</span><strong>{yearSummaryReady ? `${formatMoney(yearSummaryReady.netUgx)} ${currency}` : "—"}</strong></div></div>{yearSummary?.access === "ready" && !yearSummary.accountFilterComplete && <p className="muted-note">Totals unavailable · narrow the date range to include every matching record.</p>}</Card>
      <Card className="dashboard-period-card dashboard-trend-card"><div className="card-heading"><div><h2 className="card-title">Daily sales trend</h2><p className="card-subtitle">Selected period · today highlighted</p></div></div>{customRangeInvalid ? <div className="muted-note">{customRangeError}</div> : summary === undefined ? <div className="muted-note">Loading trend…</div> : summary.access !== "ready" ? <div className="muted-note">Trend is unavailable.</div> : !summary.accountFilterComplete ? <div className="muted-note">Trend unavailable · narrow the date range.</div> : <InteractiveFinanceChart points={chartPoints} currency={currency} scale={currencyScale} locale={locale} dateFormat={dateFormat} accountFiltered={account !== "all"} showPrevious={previousSummary?.access === "ready" && previousSummary.accountFilterComplete && previousSummary.days.some(day => day.salesUgx > 0 || day.expensesUgx > 0)} compact highlightDay={today} />}</Card>
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

function ReferenceMetric({ label, value, note, currency, formatMoney, tone = "" }: { label: string; value: number | null; note: string; currency: string; formatMoney: (amount: number) => string; tone?: string }) {
  return <Card className="dashboard-reference-metric"><span className="eyebrow">{label}</span><strong className={`dashboard-reference-value ${tone}`}>{value === null ? "—" : formatMoney(value)}</strong><span className="dashboard-reference-note">{value === null ? "Complete finance data unavailable" : `${currency} · ${note}`}</span></Card>;
}

function CardHeading({ title, subtitle, badge }: { title: string; subtitle?: string; badge?: string }) {
  return <div className="card-heading"><div><h2 className="card-title">{title}</h2>{subtitle && <p className="card-subtitle">{subtitle}</p>}</div>{badge && <span className="status-chip status-warning">{badge}</span>}</div>;
}

function BalanceBar({ label, value, share, currency, formatMoney }: { label: string; value: number; share: number; currency: string; formatMoney: (value: number) => string }) {
  return <div className="dashboard-balance-bar"><div><span>{label}</span><strong>{formatMoney(value)} {currency}</strong></div><div className="flow-track"><span className="flow-fill flow-sales" style={{ width: `${Math.min(100, share / 100)}%` }} /></div><small>{(share / 100).toFixed(0)}%</small></div>;
}

function CategoryRows({ rows, currency, formatMoney }: { rows: { category: string; amountUgx: number; count: number; shareBps: number }[]; currency: string; formatMoney: (value: number) => string }) {
  return rows.length ? <div className="dashboard-category-list">{rows.map(row => <div className="dashboard-category-row" key={row.category}><div><span>{row.category}</span><strong>{formatMoney(row.amountUgx)} {currency}</strong></div><div className="flow-track"><span className="flow-fill flow-sales" style={{ width: `${Math.min(100, row.shareBps / 100)}%` }} /></div><small>{(row.shareBps / 100).toFixed(0)}% · {row.count} {row.count === 1 ? "entry" : "entries"}</small></div>)}</div> : <p className="muted-note">No posted entries for this period.</p>;
}

function PartnerDonut({ partners }: { partners: { id: string; name: string; ownershipBps: number }[] }) {
  const colors = ["var(--mn-chart-1)", "var(--mn-chart-2)", "var(--mn-chart-3)", "var(--mn-chart-4)"];
  const stops = partners.reduce<{ offset: number; values: string[] }>((result, partner, index) => {
    const end = result.offset + partner.ownershipBps / 100;
    return { offset: end, values: [...result.values, `${colors[index % colors.length]} ${result.offset}% ${end}%`] };
  }, { offset: 0, values: [] }).values;
  return <div className="dashboard-partner-donut" style={{ background: `conic-gradient(${stops.join(", ")})` }} role="img" aria-label={`Partner ownership split: ${partners.map(row => `${row.name} ${(row.ownershipBps / 100).toFixed(1)} percent`).join(", ")}`}><span /></div>;
}

function Meter({ value, max, tone = "sales" }: { value: number; max: number; tone?: "sales" | "expenses" | "net" }) {
  return <div className="flow-track dashboard-meter"><span className={`flow-fill flow-${tone}`} style={{ width: `${Math.min(100, Math.max(0, value / max * 100))}%` }} /></div>;
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
