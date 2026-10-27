"use client";

import { useQuery } from "convex/react";
import { ArrowDownRight, ArrowUpRight, CircleHelp, Receipt, Wallet } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { Card, WorkspaceTitle } from "@/components/AppShell";
import { OwnerSetup } from "@/components/workspace/OwnerSetup";

function todayKey(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function money(amount: number) {
  return new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(amount);
}
function periodRange(period: string, today: string, weekStartsOn: "monday" | "sunday") {
  const date = new Date(`${today}T00:00:00Z`);
  let start = new Date(date);
  if (period === "week") {
    const offset = weekStartsOn === "sunday" ? date.getUTCDay() : (date.getUTCDay() + 6) % 7;
    start.setUTCDate(date.getUTCDate() - offset);
  }
  if (period === "month") start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  if (period === "year") start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const from = start.toISOString().slice(0, 10);
  const to = new Date(date.getTime() + 86400000).toISOString().slice(0, 10);
  return { from, toExclusive: to };
}

export default function DashboardPage() {
  const [period, setPeriod] = useState("month");
  const settings = useQuery(api.workspace.businessSettings, {});
  const timezone = settings?.access === "ready" ? settings.timezone : "Africa/Kampala";
  const weekStartsOn = settings?.access === "ready" ? settings.weekStartsOn : "monday";
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
  const range = useMemo(
    () => periodRange(period, businessDay, weekStartsOn),
    [period, businessDay, weekStartsOn],
  );
  const summary = useQuery(api.workspace.dashboardSummary, range);
  const recent = useQuery(api.workspace.recentEntries, { limit: 8 });
  const readySummary = summary?.access === "ready" ? summary : null;
  const isReady = readySummary !== null;
  const today = businessDay;
  const todaySales = readySummary?.days.find((day) => day.day === today)?.salesUgx ?? 0;
  const dayBars = readySummary?.days.slice(-14) ?? [];
  const peak = Math.max(1, ...dayBars.map((day) => day.salesUgx));

  return <>
    <WorkspaceTitle eyebrow="MylesNet · Finance" title="Dashboard" description="A clear view of your recorded business activity." action={<label className="period-control">Period <select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Dashboard period"><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option></select></label>} />
    <div className="dashboard-banner"><Image src="/brand/banner.png" alt="MylesNet Finance Tracker" fill priority sizes="(max-width: 760px) 100vw, 1100px" /><div className="banner-caption">Your business, clearly in view.</div></div>
    <div className="metric-grid">
      <Metric label="Sales today" value={isReady ? todaySales : null} note="Recorded entries only" icon={<ArrowUpRight size={16} />} />
      <Metric label="Sales this period" value={readySummary?.salesUgx ?? null} note="Gross sales recorded" icon={<Receipt size={16} />} />
      <Metric label="Expenses this period" value={readySummary?.expensesUgx ?? null} note="Expenses recorded" icon={<ArrowDownRight size={16} />} />
      <Metric label="Net this period" value={readySummary?.netUgx ?? null} note="Sales less expenses" icon={<Wallet size={16} />} />
    </div>
    <div className="balance-grid">
      <Metric label="Cash on hand" value={readySummary?.cashBalanceUgx ?? null} note="From entries recorded here" icon={<Wallet size={16} />} />
      <Metric label="Mobile money" value={readySummary?.mobileMoneyBalanceUgx ?? null} note="From entries recorded here" icon={<Wallet size={16} />} />
    </div>
    {summary?.access === "setup" && <Card className="workspace-setup-card"><div className="card-heading"><div><h2 className="card-title">Set up the first workspace owner</h2><p className="card-subtitle">Use this one-time setup only for a new workspace. It grants the signed-in Google account the owner role.</p></div></div><OwnerSetup /></Card>}
    {summary?.access === "pending" && <Card className="workspace-setup-card"><div className="card-heading"><div><h2 className="card-title">Workspace access pending</h2><p className="card-subtitle">Ask the workspace owner to invite your Google account. Owner setup is only available before a workspace exists.</p></div></div></Card>}
    <div className="dashboard-grid">
      <Card>
        <div className="card-heading"><div><h2 className="card-title">Sales activity</h2><p className="card-subtitle">Daily recorded sales in the selected period</p></div></div>
        {!isReady ? <Empty message={summary === undefined ? "Loading your workspace…" : summary.access === "pending" ? "Your workspace is waiting for an owner invitation." : "Partner-specific reports are not ready yet. Finance totals are hidden until statement access is scoped."} /> : dayBars.length === 0 ? <Empty message="No sales have been recorded in this period." /> : <>
          <div className="chart-bars" role="img" aria-label={`Sales over ${dayBars.length} days. Total ${money(readySummary?.salesUgx ?? 0)} UGX.`}>{dayBars.map((day) => <div className="chart-day" key={day.day} title={`${day.day}: ${money(day.salesUgx)} UGX`}><div className="chart-bar" style={{ height: `${Math.max(2, day.salesUgx / peak * 100)}%` }} /></div>)}</div>
          <div className="chart-labels"><span>{dayBars[0]?.day}</span><span>{dayBars.at(-1)?.day}</span></div>
        </>}
      </Card>
      <Card>
        <div className="card-heading"><div><h2 className="card-title">Recent entries</h2><p className="card-subtitle">Latest cashbook activity</p></div><Link className="muted-note" href="/sales">View all</Link></div>
        {recent === undefined ? <Empty message="Loading entries…" /> : recent.length === 0 ? <Empty message={isReady ? "No entries yet. Add a sale or expense to begin." : summary?.access === "restricted" ? "Partner entry details are hidden until statement access is scoped." : "Entries appear here after you are invited to a workspace."} /> : <div className="entry-list">{recent.map((entry) => <div className="entry-row" key={entry._id}><div className="entry-main"><span className="entry-icon">{entry.kind === "sale" ? <Receipt size={16} /> : <Wallet size={16} />}</span><div style={{ minWidth: 0 }}><div className="entry-description">{entry.note || entry.category}</div><div className="entry-meta">{entry.category} · {entry.occurredOn} · {entry.account === "cash" ? "Cash" : "Mobile money"}{entry.state === "void" ? " · Voided" : ""}</div></div></div><span className={`entry-amount ${entry.state === "void" ? "muted-note" : entry.kind === "sale" ? "amount-positive" : "amount-negative"}`}>{entry.kind === "sale" ? "+" : "−"}{money(entry.amountUgx)}</span></div>)}</div>}
      </Card>
    </div>
  </>;
}

function Metric({ label, value, note, icon }: { label: string; value: number | null; note: string; icon: ReactNode }) {
  return <Card className="metric-card"><div className="card-heading"><span className="eyebrow">{label}</span><span className="entry-icon">{icon}</span></div><div className="metric-value">{value === null ? "—" : `${money(value)} UGX`}</div><div className="metric-note">{note}</div></Card>;
}

function Empty({ message }: { message: string }) {
  return <div className="empty-state"><CircleHelp size={20} style={{ margin: "0 auto 8px" }} /><strong>{message}</strong><span>Numbers are calculated from saved cashbook entries, not the sample figures in the design boards.</span></div>;
}
