"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowDownRight, ArrowUpRight, Download, Plus, Printer, Share2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { accountLabel } from "@/lib/finance";
import { Card, WorkspaceTitle } from "@/components/AppShell";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { EntryForm } from "@/components/workspace/EntryForm";
import { OperationsWorkspace } from "@/components/workspace/OperationsWorkspace";
import { ConvexLiveStatus } from "@/components/workspace/ConvexLiveStatus";
import { OperationalRecordForm } from "@/components/workspace/OperationalRecordForm";
import { formatBusinessDay } from "@/lib/format";
import type { DateFormat } from "@/lib/format";
import { AnalyticsInsights } from "@/components/workspace/AnalyticsInsights";
import { FinancePeriodFilters } from "@/components/workspace/FinancePeriodFilters";
import { InteractiveFinanceChart } from "@/components/workspace/InteractiveFinanceChart";
import { financePeriodRange, previousFinanceRange, validateFinanceCustomRange, type FinanceAccount, type FinancePeriod } from "@/lib/finance-period";

type BoardSpec = {
  title: string;
  eyebrow: string;
  description: string;
  source: string;
  metrics: string[];
  sections: { title: string; detail: string; kind?: "table" | "chart" | "workflow" }[];
  settings?: boolean;
  entryKind?: "sale" | "expense";
};
const EXPORT_ENTRY_LIMIT = 10_000;

const specs: Record<string, BoardSpec> = {
  sales: {
    title: "Sales", eyebrow: "Cashbook", description: "Record and review income from approved sources.", source: "03 · Sales", entryKind: "sale",
    metrics: ["Sales today", "Sales", "Best day", "Days recorded", "Entry basis"],
    sections: [
      { title: "Daily sales · last 14 days", detail: "Recorded entries by date, account, and amount. Estimated split is shown only when an imported estimate exists.", kind: "table" },
      { title: "Sales by income type", detail: "Category breakdown uses saved entries; no mock amounts are loaded.", kind: "chart" },
      { title: "Best days and weekday pattern", detail: "Strongest sales days are calculated from the selected period.", kind: "chart" },
      { title: "Imports and data checks", detail: "Import history will be available after a source mapping and staging import are approved.", kind: "table" },
      { title: "Weak-day diary and split corrections", detail: "Record the reason for an unusual day and correct estimated account splits with an audit trail.", kind: "workflow" },
      { title: "Voucher batches and mobile entry", detail: "Voucher stock and mobile entry layouts are not populated until those record types are configured." },
    ],
  },
  expenses: {
    title: "Expenses", eyebrow: "Cashbook", description: "Record and review operating costs and equipment purchases.", source: "04 · Expenses", entryKind: "expense",
    metrics: ["Expenses", "Year to date", "Expense ratio", "Average per day", "Approval queue"],
    sections: [
      { title: "Expenses by category", detail: "Category mix is calculated from saved expenses and distinguishes operating costs from equipment.", kind: "table" },
      { title: "Add an expense", detail: "Attach the date, category, account, and business context to each cashbook entry.", kind: "workflow" },
      { title: "Operating vs equipment", detail: "Expense classification comes from Finance settings.", kind: "chart" },
      { title: "Alerts, budgets, and recurring costs", detail: "Configure category budgets and recurring bills before enabling alerts." },
      { title: "Receipts and suppliers", detail: "Receipt files and supplier histories require storage and supplier records to be configured." },
      { title: "Recurring expense review", detail: "Potential patterns are suggestions only; no bill is created without confirmation." },
    ],
  },
  analytics: {
    title: "Analytics", eyebrow: "Reports", description: "Compare recorded performance, pace, and data quality.", source: "02 · Analytics",
    metrics: ["Sales", "Average per day", "Best day", "Days recorded", "Expense ratio", "Projected sales", "Average daily expenses", "Net margin", "Strongest weekday", "Equipment invested"],
    sections: [
      { title: "Period comparison", detail: "Sales, average per day, best day, weakest day, and recorded days compared with the previous equal-length period." },
      { title: "Projected sales", detail: "Month-to-date run rate, days remaining, required daily sales, and the assumptions behind this estimate.", kind: "chart" },
      { title: "Monthly target and scenarios", detail: "Track the target from Finance settings and compare current pace with recent pace. Scenarios are run-rates, not forecasts." },
      { title: "Month pace and equipment payback", detail: "Cumulative monthly sales and operating-profit recovery. Historical comparisons appear when source data is available.", kind: "chart" },
      { title: "Sales and expenses over time", detail: "Recorded daily totals compared with the previous equal-length period. Hover, focus, or tap a date for details.", kind: "chart" },
      { title: "Sales by weekday", detail: "All seven weekdays, strongest day highlighted; switch between total and average." , kind: "chart"},
      { title: "Daily heatmap and anomaly flags", detail: "Missing days and unusually weak days are distinguished from days with zero sales." , kind: "table"},
      { title: "Income type and spending category", detail: "Breakdowns use saved categories and show estimated split provenance where applicable." , kind: "chart"},
      { title: "Daily data and weekday summary", detail: "Last 14 days and a complete Monday-to-Sunday comparison." , kind: "table"},
      { title: "What the data says · goals · what-if", detail: "Trend, margin, capital, payback, pattern, and watch insights with targets from Settings." },
    ],
  },
  movements: {
    title: "Movements", eyebrow: "Cashbook", description: "Track transfers between business accounts and other movement types.", source: "05 · Movements",
    metrics: ["Movements recorded", "Cash on hand", "Mobile money", "Capital in", "Default fee"],
    sections: [
      { title: "Money map", detail: "Follow recorded sales, mobile money, cash, partner flows, withdrawals, and payouts." },
      { title: "Movement ledger", detail: "Transfers do not count as income or expense. Each movement must have a date, source, destination, type, and amount.", kind: "table" },
      { title: "Movement tracking status", detail: "Transfer and withdrawal records are not available yet.", kind: "workflow" },
      { title: "Withdrawal planner and cash count", detail: "Estimate the fee and net cash received, then compare a denomination count with the book balance." },
      { title: "Money flow and unexplained balance", detail: "Compare account balances with sales, expenses, and recorded movements." },
    ],
  },
  savings: {
    title: "Savings", eyebrow: "Cashbook", description: "Track savings holdings, contributions, goals, and returns.", source: "06 · Savings",
    metrics: ["Current value", "Contributions", "Gain or loss", "Cash buffer", "Could set aside"],
    sections: [
      { title: "Holdings", detail: "No holdings are recorded yet. Add a holding to track its value and contributions.", kind: "table" },
      { title: "Holdings tracking status", detail: "Savings holdings and contributions are not available yet.", kind: "workflow" },
      { title: "Savings goals and reserve target", detail: "Set a reserve target from monthly operating costs and review progress toward selected goals." },
      { title: "Set-aside planner", detail: "Compare 10%, 20%, and 30% of recorded monthly operating profit." },
      { title: "Allocation and returns", detail: "View the allocation when holdings exist and compare expected returns with equipment payback.", kind: "chart" },
    ],
  },
  loans: {
    title: "Loans", eyebrow: "Cashbook", description: "Track borrowing, repayments, interest assumptions, and affordability.", source: "07 · Loans",
    metrics: ["Active loans", "Monthly payments", "Outstanding", "Debt capacity", "Equipment financing"],
    sections: [
      { title: "Loans", detail: "No loans are recorded. Add a loan to start a repayment schedule.", kind: "table" },
      { title: "Loan tracking status", detail: "Loan records and repayments are not available yet.", kind: "workflow" },
      { title: "Loan planner and affordability", detail: "Calculate monthly payment, total repayment, interest, and compare with recorded operating profit." },
      { title: "Repayment schedule", detail: "Scheduled principal and interest are estimates until actual payments are recorded.", kind: "table" },
      { title: "Early repayment and equipment impact", detail: "Compare interest saved and revised equipment payback from entered assumptions." },
    ],
  },
  "daily-report": {
    title: "Daily Report", eyebrow: "Reports", description: "Review recorded activity for a business day.", source: "08 · Daily Report",
    metrics: ["Sales today", "Cash on hand", "Delivery time", "Recipients", "Open checks"],
    sections: [
      { title: "Report preview", detail: "Daily summary from recorded sales, expenses, balances, and open checks." },
      { title: "Daily activity", detail: "Recorded and missing days are clearly distinguished for the selected period.", kind: "table" },
      { title: "Delivery settings and recipients", detail: "Report delivery is unavailable until a provider and recipient consent are configured.", kind: "workflow" },
      { title: "Weekly digest", detail: "Monday digest preview with sales, change, strongest and weakest days, balances, and open flags." },
      { title: "Delivery status and mobile view", detail: "Delivery receipts and WhatsApp replies appear only after an integration is configured." },
    ],
  },
  "monthly-pnl": {
    title: "Monthly P&L", eyebrow: "Reports", description: "Review recorded sales, total expenses, and cashbook net from saved entries.", source: "09 · Monthly P&L",
    metrics: ["Sales YTD", "Total expenses", "Cashbook net", "Equipment", "Net profit"],
    sections: [
      { title: "Profit and loss by month", detail: "Monthly totals use saved cashbook entries. Missing source history is not filled with sample values.", kind: "table" },
      { title: "Profit and loss statement", detail: "Monthly sales, total expenses, and cashbook net from recorded entries in the selected period.", kind: "table" },
      { title: "Operating margin and equipment", detail: "Compare recorded operating costs and equipment spend by period.", kind: "chart" },
      { title: "Budget versus actual", detail: "Budgets are read from Finance settings when configured." },
      { title: "Month-end close and shareable statement", detail: "Close controls and share links require permissions and configured export delivery." },
    ],
  },
  partners: {
    title: "Partners", eyebrow: "Workspace", description: "Manage ownership, capital, and partner-scoped statements.", source: "10 · Partners",
    metrics: ["Net profit YTD", "Payouts taken", "Ownership allocated", "Capital balance", "Break-even"],
    sections: [
      { title: "Partner statements", detail: "Partner-specific access is enforced separately from business-wide totals.", kind: "table" },
      { title: "Capital accounts and profit distribution", detail: "Ownership shares must total 100% before a distribution can be approved.", kind: "chart" },
      { title: "Payout planner and approvals", detail: "Payout eligibility, minimums, and second sign-off are required before payment." },
      { title: "Capital and payout ledger", detail: "Partner contributions and payouts are tracked as movements, not income or expenses.", kind: "table" },
      { title: "Ownership history and partner portal", detail: "Changes are auditable; partners only see their own statement." },
    ],
  },
  bills: {
    title: "Bills", eyebrow: "Cashbook", description: "Track recurring costs, due dates, and payment status.", source: "11 · Bills",
    metrics: ["Bills tracked", "Due soon", "Next bill", "Monthly equivalent", "Paid YTD"],
    sections: [
      { title: "Bills and next 90 days", detail: "No recurring bills are configured. Add the next due date and recurrence to see upcoming obligations.", kind: "table" },
      { title: "Bill tracking status", detail: "Recurring bill records and payment reminders are not available yet.", kind: "workflow" },
      { title: "Margin impact and reminders", detail: "Accruals affect profit only when recorded as expenses; reminders do not book entries automatically." },
      { title: "Supplier price history", detail: "Payment history appears after supplier-linked expenses exist.", kind: "chart" },
      { title: "Calendar sync and accrual automation", detail: "Calendar delivery requires a configured provider. Bill payments must be confirmed before creating an expense." },
    ],
  },
  reconcile: {
    title: "Reconcile", eyebrow: "Controls", description: "Compare counted balances with the cashbook and resolve discrepancies.", source: "12 · Reconcile",
    metrics: ["Accounts", "Open issues", "Balance difference", "Tolerance", "Locked through"],
    sections: [
      { title: "Account reconciliation", detail: "Enter a counted balance for each account and inspect the variance.", kind: "table" },
      { title: "Close checklist", detail: "Count cash, confirm mobile money, resolve checks, then request sign-off." },
      { title: "Checks and variance explanations", detail: "Every difference links to its source and must be resolved or explained.", kind: "table" },
      { title: "Centipid CSV auto-match", detail: "CSV import matching becomes available after the source format is documented.", kind: "workflow" },
      { title: "Closing certificate", detail: "A printable record will include counted accounts, open issues, signer, and date." },
    ],
  },
  issues: {
    title: "Issues", eyebrow: "Controls", description: "Review data checks, assign follow-ups, and keep a clear audit trail.", source: "Issues",
    metrics: ["Open issues", "Fix first", "Review", "Warnings"],
    sections: [
      { title: "Issue inbox", detail: "Issues are generated from saved records and configured thresholds. No mock issues are shown as live.", kind: "table" },
      { title: "Data quality rules", detail: "Missing days, weak days, estimated splits, and reconciliation differences are reviewed here." },
    ],
  },
  "settings/finance": {
    title: "Finance settings", eyebrow: "Settings", description: "Configure accounts, income types, categories, and cashbook behavior.", source: "14 · Settings · Finance", settings: true,
    metrics: ["Accounts", "Income types", "Expense categories", "Movement types", "Currency"],
    sections: [
      { title: "Accounts and opening balances", detail: "Configure cash, mobile money, and any additional account. Opening balances must be reconciled." , kind: "workflow"},
      { title: "Income types and default account", detail: "Mark estimated mobile-money and cash splits as estimated until corrected.", kind: "table" },
      { title: "Expense categories", detail: "Classify operating costs separately from equipment purchases.", kind: "table" },
      { title: "Movement types and category budgets", detail: "Movement ordering is fixed for reports; budgets include warning thresholds.", kind: "workflow" },
      { title: "Bills setup", detail: "Recurring bill configuration is managed on the Bills screen." },
    ],
  },
  "settings/rules": {
    title: "Rules", eyebrow: "Settings", description: "Set finance thresholds, approvals, and reporting targets.", source: "15 · Settings · Rules", settings: true,
    metrics: ["Partners", "Payout day", "Approval limit", "Weak-day threshold", "Monthly target"],
    sections: [
      { title: "Partners and profit shares", detail: "Ownership must total 100% before payouts can be approved.", kind: "table" },
      { title: "Period locking and approvals", detail: "Configure approval limits, fee handling, and locked-period behavior.", kind: "workflow" },
      { title: "Targets and equipment", detail: "Set monthly sales, expense warning, payback, and weak-day targets.", kind: "workflow" },
      { title: "Alerts and reminders", detail: "Low-cash, bill, missing-day, and daily-report reminders require validated settings." },
    ],
  },
  "settings/data": {
    title: "Data", eyebrow: "Settings", description: "Review data quality, imports, backups, and exports.", source: "16 · Settings · Data", settings: true,
    metrics: ["Rows imported", "Duplicates", "Last backup", "Exports", "Restore points"],
    sections: [
      { title: "Data quality rules", detail: "Review duplicate detection, required fields, date windows, and safe amount validation." },
      { title: "Integrations and imports", detail: "The source workbook and webhook contract must be inventoried before import or cutover.", kind: "workflow" },
      { title: "Import history", detail: "Each import needs a source, batch identifier, row counts, and reconciliation results.", kind: "table" },
      { title: "Backup and export", detail: "Automated backup and restore are not enabled until an off-platform location and retention policy are configured." },
      { title: "Sandbox mode", detail: "Use a non-production dataset for trial changes. No production copy is made here." },
    ],
  },
  "settings/access": {
    title: "Access", eyebrow: "Settings", description: "Manage users, roles, and workspace permissions.", source: "17 · Settings · Access", settings: true,
    metrics: ["Users", "Invitations", "Role templates", "Features", "Recent changes"],
    sections: [
      { title: "Users and roles", detail: "Only active members can view business records. Role changes are audited.", kind: "table" },
      { title: "Role templates and feature permissions", detail: "Owner, partner, and cashier access is enforced by Convex functions." },
      { title: "Recent settings changes", detail: "Review the actor, affected setting, previous value, and new value.", kind: "table" },
      { title: "Audit log detail", detail: "Audit events are append-only and scoped to this workspace." },
    ],
  },
  "settings/releases": {
    title: "Releases", eyebrow: "Settings", description: "Review application version, update channel, and release notes.", source: "18 · Settings · Releases", settings: true,
    metrics: ["Current version", "Channel", "Latest release", "Readiness", "Preview features"],
    sections: [
      { title: "Releases and upgrades", detail: "Production updates are deployed through reviewed releases. The app will not overwrite finance data automatically." },
      { title: "Upgrade readiness", detail: "Check data migration, backup, environment variables, and rollback readiness before release." },
      { title: "Preview features", detail: "Preview controls stay off until the feature is available and acceptance criteria pass." },
      { title: "Release notes and history", detail: "Only verified application releases appear here.", kind: "table" },
    ],
  },
};

function businessDate(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function formatMoney(value: number | undefined, currency = "UGX", scale = 1, locale = "en-UG") {
  if (value === undefined) return "—";
  const digits = Math.round(Math.log10(scale));
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value / scale)} ${currency}`;
}

export function BoardRoute({ route }: { route: string }) {
  const screen = specs[route];
  const [financePeriod, setFinancePeriod] = useState<FinancePeriod>("monthly");
  const [financeCustomFrom, setFinanceCustomFrom] = useState(businessDate("Africa/Kampala"));
  const [financeCustomTo, setFinanceCustomTo] = useState(businessDate("Africa/Kampala"));
  const [account, setAccount] = useState<FinanceAccount>("all");
  const [entryLimit, setEntryLimit] = useState(100);
  const [openRecordRoute, setOpenRecordRoute] = useState<string | null>(null);
  const recordFormOpen = openRecordRoute === route;
  useEffect(() => setOpenRecordRoute(null), [route]);
  const [shareFeedback, setShareFeedback] = useState("");
  const settings = useQuery(api.workspace.businessSettings, {});
  const access = useQuery(api.workspace.currentAccess, {});
  const preferences = useQuery(api.settings.runtimeContext, {});
  const timezone = settings?.access === "ready" ? settings.timezone : "Africa/Kampala";
  const weekStartsOn = settings?.access === "ready" ? settings.weekStartsOn : "monday";
  const currency = preferences?.access === "ready" ? preferences.currency : "UGX";
  const currencyScale = 10 ** (preferences?.access === "ready" ? (preferences.currencyMinorDigits ?? 0) : 0);
  const locale = preferences?.access === "ready" ? preferences.locale : "en-UG";
  const fmt = (value: number | undefined) => formatMoney(value, currency, currencyScale, locale);
  const dateFormat = preferences?.access === "ready" ? preferences.dateFormat : "DD/MM/YYYY";
  const fmtDate = (value: string) => formatBusinessDay(value, dateFormat);
  const today = businessDate(timezone);
  const fiscalStartMonth = preferences?.access === "ready" ? preferences.fiscalYearStartMonth : 1;
  const financeRangeError = useMemo(() => financePeriod === "custom" ? validateFinanceCustomRange(financeCustomFrom, financeCustomTo, today) : "", [financePeriod, financeCustomFrom, financeCustomTo, today]);
  const financePeriodLabel = ({ daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly", "last-year": "Last year", custom: "Custom" } as const)[financePeriod];
  const analyticsRange = useMemo(() => financePeriod === "custom" && financeRangeError
    ? financePeriodRange("daily", today, weekStartsOn, fiscalStartMonth, financeCustomFrom, financeCustomTo)
    : financePeriodRange(financePeriod, today, weekStartsOn, fiscalStartMonth, financeCustomFrom, financeCustomTo),
  [financePeriod, financeRangeError, today, weekStartsOn, fiscalStartMonth, financeCustomFrom, financeCustomTo]);
  const range = analyticsRange;
  const rangeLastDay = new Date(`${range.toExclusive}T00:00:00.000Z`); rangeLastDay.setUTCDate(rangeLastDay.getUTCDate() - 1);
  const accountFilter = account !== "all" ? { account } : {};
  const needsSummary = screen?.entryKind !== undefined || ["Analytics", "Daily Report", "Monthly P&L", "Movements"].includes(screen?.title ?? "");
  const needsDailyHistory = screen?.title === "Daily Report";
  const summary = useQuery(api.workspace.dashboardSummary, needsSummary && !financeRangeError ? { ...range, ...accountFilter } : "skip");
  const previousRange = useMemo(() => previousFinanceRange(analyticsRange), [analyticsRange]);
  const previousSummary = useQuery(api.workspace.dashboardSummary, screen?.title === "Analytics" && !financeRangeError ? { ...previousRange, ...accountFilter } : "skip");
  const entryKind = screen?.title === "Sales" ? "sale" : screen?.title === "Expenses" ? "expense" : undefined;
  const entries = useQuery(api.workspace.recentEntries, entryKind && !financeRangeError ? { limit: entryLimit, kind: entryKind, from: range.from, toExclusive: range.toExclusive, ...accountFilter } : "skip");
  const yearSummary = useQuery(api.workspace.dashboardSummary, screen?.title === "Monthly P&L" && !financeRangeError ? { ...range, ...accountFilter } : "skip");
  const trailingSevenSummary = useQuery(api.workspace.dashboardSummary, needsDailyHistory && !financeRangeError ? { ...range, ...accountFilter } : "skip");
  const voidEntry = useMutation(api.workspace.voidEntry);
  const correctEntry = useMutation(api.workspace.correctEntry);
  const [entryActionFeedback, setEntryActionFeedback] = useState("");

  if (!screen) return <WorkspaceTitle title="Page not found" description="Choose a section from the navigation." />;
  if (settings?.access === "ready" && settings.role === "finance_approver" && screen.title !== "Partners") return <><WorkspaceTitle title="Distribution review" description="Finance approver access is scoped to independent partner distribution review." /><div className="notice-banner notice-info" role="status">Open Partners to review pending distribution requests. Business records, reports, and workspace settings are not available to this role.</div></>;

  const summaryReady = summary?.access === "ready" ? summary : null;
  const stats = summaryReady?.accountFilterComplete ? summaryReady : null;
  const weekDays = trailingSevenSummary?.access === "ready" && trailingSevenSummary.accountFilterComplete ? trailingSevenSummary.days : undefined;
  const metricValues: Record<string, string> = {
    Sales: fmt(stats?.salesUgx),
    "Best day": stats ? fmt(Math.max(0, ...stats.days.map((day) => day.salesUgx))) : "—",
    "Days recorded": stats ? `${stats.days.filter((day) => day.salesUgx + day.expensesUgx > 0).length}` : "—",
    "Expense ratio": stats ? `${stats.salesUgx ? Math.round(stats.expensesUgx / stats.salesUgx * 100) : 0}%` : "—",
    "Average daily expenses": stats ? fmt(Math.round(stats.expensesUgx / Math.max(1, stats.days.length))) : "—",
    "Net margin": stats ? `${stats.salesUgx ? Math.round((stats.salesUgx - stats.expensesUgx) / stats.salesUgx * 100) : 0}%` : "—",
    "Cash on hand": fmt(stats?.cashBalanceUgx),
    "Mobile money": fmt(stats?.mobileMoneyBalanceUgx),
    "Sales today": stats ? fmt(stats.days.find((day) => day.day === today)?.salesUgx ?? 0) : "—",
    "Expenses": fmt(stats?.expensesUgx),
    "Average per day": stats ? fmt(Math.round((screen?.title === "Expenses" ? stats.expensesUgx : stats.salesUgx) / Math.max(1, stats.days.length))) : "—",
    "Entry basis": "Recorded",
    "Approval queue": "—",
    "Sales YTD": fmt(yearSummary?.access === "ready" && yearSummary.accountFilterComplete ? yearSummary.salesUgx : undefined),
    "Total expenses": fmt(stats?.expensesUgx),
    "Cashbook net": stats ? fmt(stats.salesUgx - stats.expensesUgx) : "—",
    // A net profit figure is withheld until equipment and other adjustments are modeled.
    "Balance difference": "—",
    Currency: currency,
  };
  const selectedEntries = entries;
  const hasRecordData = selectedEntries && selectedEntries.length > 0;
  const canVoidEntry = (kind: "sale" | "expense") => access?.access === "ready" && access.permissions.includes(kind === "sale" ? "sales.void" : "expenses.void");
  const canCorrectEntry = (kind: "sale" | "expense") => access?.access === "ready" && access.permissions.includes(kind === "sale" ? "sales.update" : "expenses.update");

  async function requestEntryVoid(entryId: string) {
    const reason = window.prompt("Reason for voiding this entry (at least 3 characters):") ?? "";
    if (reason.trim().length < 3) return;
    setEntryActionFeedback("");
    try {
      if (settings?.access !== "ready") throw new Error("Workspace is still loading.");
      await voidEntry({ businessId: settings.businessId, entryId: entryId as Id<"entries">, reason });
      setEntryActionFeedback("Entry voided. Its account balance and daily totals were reversed and the reason was recorded.");
    } catch (error) {
      setEntryActionFeedback(error instanceof Error ? error.message : "Could not void this entry.");
    }
  }
  async function requestEntryCorrection(entry: NonNullable<typeof entries>[number]) {
    if (settings?.access !== "ready") return;
    const rawAmount = window.prompt(`Corrected amount in ${currency}:`, String(entry.amountUgx / currencyScale));
    if (rawAmount === null) return;
    const scaledAmount = Number(rawAmount) * currencyScale;
    const amountUgx = Math.round(scaledAmount);
    if (!Number.isFinite(scaledAmount) || amountUgx <= 0 || !Number.isSafeInteger(amountUgx) || Math.abs(scaledAmount - amountUgx) > 1e-7) { window.alert("Enter a positive amount using the currency's supported decimal places."); return; }
    const occurredOn = window.prompt("Corrected date (YYYY-MM-DD):", entry.occurredOn);
    if (occurredOn === null) return;
    const accountChoice = window.prompt("Corrected account: enter cash or mobile_money.", entry.account === "unallocated" ? "cash" : entry.account);
    if (accountChoice === null) return;
    if (accountChoice !== "cash" && accountChoice !== "mobile_money") { window.alert("Choose cash or mobile_money."); return; }
    const category = window.prompt("Corrected category:", entry.category);
    if (category === null) return;
    const note = window.prompt("Corrected description:", entry.note);
    if (note === null) return;
    const reason = window.prompt("Reason for correcting this entry (at least 5 characters):") ?? "";
    if (reason.trim().length < 5) return;
    const idempotencyKey = crypto.randomUUID();
    const args = { businessId: settings.businessId, entryId: entry._id, amountUgx, occurredOn, account: accountChoice, category, note, reason, idempotencyKey } as const;
    setEntryActionFeedback("");
    const overrides: { confirmNegativeBalance?: boolean; confirmPossibleDuplicate?: boolean } = {};
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await correctEntry({ ...args, ...overrides });
        setEntryActionFeedback("Entry corrected. The original is retained, the replacement is linked, and account and daily totals were updated.");
        return;
      } catch (error) {
        const details = error instanceof ConvexError ? error.data as { code?: string; message?: string } : null;
        if (details?.code === "CONFIRM_NEGATIVE" && !overrides.confirmNegativeBalance && window.confirm(`${details.message ?? "This correction may create a negative balance."} Continue and record this override?`)) { overrides.confirmNegativeBalance = true; continue; }
        if (details?.code === "CONFIRM_DUPLICATE" && !overrides.confirmPossibleDuplicate && window.confirm(`${details.message ?? "This correction resembles another entry."} Continue and record this override?`)) { overrides.confirmPossibleDuplicate = true; continue; }
        setEntryActionFeedback(details?.message ?? (error instanceof Error ? error.message : "Could not correct this entry."));
        return;
      }
    }
  }
  const operationalScreen = ["Movements", "Savings", "Loans", "Partners", "Bills", "Reconcile"].includes(screen.title);
  const recordPermissionsByScreen: Record<string, string[]> = {
    Sales: ["sales.create"], Expenses: ["expenses.create"], Movements: ["movements.create"],
    Savings: ["savings.create"], Loans: ["loans.create", "loans.repay"], Bills: ["bills.create", "bills.pay"],
    Partners: ["partners.manage"], Reconcile: ["reconcile.create"],
  };
  const canOpenRecordForm = Boolean(access?.access === "ready" && recordPermissionsByScreen[screen.title]?.some(permission => access.permissions.includes(permission)));
  const hasAnalyticsActivity = stats?.days.some((day) => day.salesUgx > 0 || day.expensesUgx > 0) ?? false;

  async function shareReport() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareFeedback("Page link copied.");
      window.setTimeout(() => setShareFeedback(""), 3000);
    } catch {
      setShareFeedback("Copy this page URL to share the report.");
    }
  }

  return <>
    <WorkspaceTitle
      title={screen.title}
      description={screen.description}
    />
    {screen.settings && <SettingsNav current={`/${route}`} />}
    <div className="board-toolbar no-print has-finance-filters">
      <FinancePeriodFilters period={financePeriod} onPeriodChange={setFinancePeriod} customFrom={financeCustomFrom} customTo={financeCustomTo} onCustomFromChange={setFinanceCustomFrom} onCustomToChange={setFinanceCustomTo} account={account} onAccountChange={setAccount} today={today} ariaLabel={`${screen.title} period and account filters`} />
      <div className="board-toolbar-actions">
      <ConvexLiveStatus />
      <span className="toolbar-range">{fmtDate(range.from)} — {fmtDate(rangeLastDay.toISOString().slice(0, 10))}</span>
      {canOpenRecordForm && !financeRangeError && <button className={`button${recordFormOpen ? "" : " button-accent"}`} type="button" aria-controls="record-entry-card" aria-expanded={recordFormOpen} onClick={() => setOpenRecordRoute(open => open === route ? null : route)}>{recordFormOpen ? <X size={14} /> : <Plus size={14} />}{recordFormOpen ? "Close record" : "Record"}</button>}
      <button className="button" type="button" onClick={() => window.print()}><Printer size={14} />Print</button>
      <button className="button" type="button" onClick={() => window.print()}><Download size={14} />Print / Save PDF</button>
      <button className="button button-dark" type="button" onClick={() => void shareReport()}><Share2 size={14} />Share report</button>
      {shareFeedback && <span className="form-feedback" role="status">{shareFeedback}</span>}
      </div>
    </div>
    {financeRangeError && <p className="form-feedback form-error finance-range-error" role="alert">{financeRangeError}</p>}
    {summary?.access === "restricted" && <div className="notice-banner notice-info" role="status">Partner-specific reporting is being prepared. Business-wide totals are hidden from partner accounts.</div>}
    {summary?.access === "pending" && <div className="notice-banner notice-warning" role="status">Workspace access is pending. Ask an owner to invite this Google account.</div>}
    {account !== "all" && summaryReady && !summaryReady.accountFilterComplete && <div className="notice-banner notice-warning" role="status">Some account-filtered totals reached the safe record limit. Affected figures are withheld; choose a shorter date range for complete results.</div>}
    {!operationalScreen && <div className="metric-grid board-metric-grid">
      {screen.metrics.map((label, index) => <Card className="metric-card board-metric-card" key={label}>
        <div className="card-heading"><span className="eyebrow">{screen.title === "Monthly P&L" && label === "Sales YTD" ? "Sales in period" : label}</span><span className="entry-icon">{index % 2 === 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</span></div>
        <div className="metric-value">{metricValues[label] ?? "—"}</div>
        <div className="metric-note">{summaryReady && !summaryReady.accountFilterComplete ? "Unavailable · narrow the date range" : metricValues[label] === undefined ? "Available when this record type is configured" : "Based on saved workspace records"}</div>
      </Card>)}
    </div>}
    {financeRangeError && <Card><div className="empty-state compact-empty"><strong>Choose a valid date range.</strong><span>{financeRangeError}</span></div></Card>}
    <div hidden={Boolean(financeRangeError)}>{screen.title === "Analytics" ? <AnalyticsInsights range={range} today={today} currency={currency} scale={currencyScale} locale={locale} dateFormat={dateFormat} account={account === "all" ? undefined : account} /> : screen.title === "Issues" ? <AnalyticsInsights range={range} today={today} currency={currency} scale={currencyScale} locale={locale} account={account === "all" ? undefined : account} issuesOnly /> : operationalScreen ? <OperationsWorkspace key={screen.title} screen={screen.title as "Movements" | "Savings" | "Loans" | "Partners" | "Bills" | "Reconcile"} currency={currency} scale={currencyScale} locale={locale} timezone={timezone} dateFormat={dateFormat} range={range} account={account} recordFormOpen={recordFormOpen} onRecordSaved={() => setOpenRecordRoute(null)} onOpenRecord={() => setOpenRecordRoute(route)} /> : <div className="board-grid">
      {screen.entryKind && <div id="record-entry-card" hidden={!recordFormOpen}><Card className="board-feature-card">
        <div className="card-heading"><div><h2 className="card-title">{screen.entryKind === "sale" ? "Add a sale" : "Add an expense"}</h2><p className="card-subtitle">Saved values update the cashbook and account balance.</p></div></div>
        <EntryForm kind={screen.entryKind} onSaved={() => setOpenRecordRoute(null)} />
      </Card></div>}
      {screen.sections.map((section) => <Card className="board-section-card" key={section.title}>
        <div className="card-heading"><div><h2 className="card-title">{section.title === "Daily sales · last 14 days" ? `Sales activity · ${financePeriodLabel}` : section.title === "Daily activity" ? `Daily entries · ${financePeriodLabel}` : section.title === "Profit and loss by month" ? `Profit and loss · ${financePeriodLabel}` : section.title}</h2><p className="card-subtitle">{section.title === "Profit and loss statement" ? `Statement · ${financePeriodLabel} · ${fmtDate(range.from)} — ${fmtDate(rangeLastDay.toISOString().slice(0, 10))}` : section.detail}</p></div>{section.kind === "table" && section.title === (entryKind === "sale" ? "Daily sales · last 14 days" : "Expenses by category") && entryKind && access?.access === "ready" && access.permissions.includes("data.export") && <EntryCsvExportControl businessId={access.businessId} kind={entryKind} from={range.from} toExclusive={range.toExclusive} account={account} currency={currency} scale={currencyScale} />}</div>
        {section.kind === "table" && section.title === "Expenses by category" ? <CategoryBreakdown categories={stats?.categoryTotals.expenses} formatMoney={fmt} />
        : section.kind === "table" && (screen.title === "Sales" || screen.title === "Expenses") ? (
          hasRecordData ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Account</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>{selectedEntries.map((entry) => <tr key={entry._id}><td>{fmtDate(entry.occurredOn)}</td><td>{entry.kind}</td><td>{entry.category}</td><td>{accountLabel(entry.account)}</td><td>{fmt(entry.amountUgx)}</td><td><span className={`status-chip ${entry.state === "posted" ? "status-ok" : "status-warning"}`}>{entry.state}</span></td><td>{canCorrectEntry(entry.kind) && entry.state === "posted" && entry.canCorrect && <button className="button" type="button" onClick={() => void requestEntryCorrection(entry)}>Correct…</button>} {canVoidEntry(entry.kind) && entry.state === "posted" && entry.canVoid && <button className="button" type="button" onClick={() => void requestEntryVoid(entry._id)}>Void…</button>}</td></tr>)}</tbody></table></div> : <EmptyPanel message="No entries yet." next="Add an entry to populate this view. The design preview figures are examples, not live business data." />
        ) : section.kind === "table" && screen.title === "Daily Report" ? <DailyHistoryTable days={weekDays} totals={trailingSevenSummary?.access === "ready" && trailingSevenSummary.accountFilterComplete ? trailingSevenSummary.periodTotals : undefined} range={range} periodLabel={financePeriodLabel} loading={trailingSevenSummary === undefined} formatDay={fmtDate} formatMoney={fmt} />
          : section.kind === "table" && screen.title === "Monthly P&L" ? <MonthlyPnlTable months={yearSummary?.access === "ready" && yearSummary.accountFilterComplete ? yearSummary.monthTotals : undefined} totals={yearSummary?.access === "ready" && yearSummary.accountFilterComplete ? yearSummary.periodTotals : undefined} loading={yearSummary === undefined} locale={locale} periodLabel={financePeriodLabel} formatMoney={fmt} />
          : section.kind === "chart" && section.title === "Sales by income type" ? <CategoryBreakdown categories={summaryReady?.accountFilterComplete ? summaryReady.categoryTotals.sales : undefined} formatMoney={fmt} />
          : section.kind === "chart" ? <ChartPanel summary={screen.title === "Analytics" ? summaryReady : stats} previous={previousSummary?.access === "ready" ? previousSummary : null} range={range} previousRange={previousRange} interactive={screen.title === "Analytics" && section.title.toLowerCase().includes("sales and expenses over time")} account={account} dateFormat={dateFormat} title={section.title} message={section.detail} currency={currency} scale={currencyScale} locale={locale} />
          : section.kind === "workflow" ? <WorkflowPanel screen={screen} section={section.title} currency={currency} scale={currencyScale} businessDay={today} />
            : <EmptyPanel
              message={screen.title === "Analytics"
                ? hasAnalyticsActivity
                  ? "Recorded activity is reflected in the metrics and charts above."
                  : "No saved activity exists in the selected period."
                : hasRecordData
                  ? "Live records are available for the selected period."
                  : "No records yet."}
              next={section.detail}
            />}
      </Card>)}
      {screen.title === "Sales" || screen.title === "Expenses" ? <Card className="board-section-card">
        <div className="card-heading"><div><h2 className="card-title">Recent cashbook entries</h2><p className="card-subtitle">Latest saved records in this workspace.</p></div></div>
        {entryActionFeedback && <p className="form-feedback" role="status">{entryActionFeedback}</p>}
        {hasRecordData ? <><div className="entry-list">{selectedEntries.map((entry) => <div className="entry-row" key={entry._id}><div className="entry-main"><span className="entry-icon">{entry.kind === "sale" ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</span><div><div className="entry-description">{entry.note || entry.category}</div><div className="entry-meta">{fmtDate(entry.occurredOn)} · {entry.category} · {accountLabel(entry.account)} · {entry.state}</div></div></div><span className={`entry-amount ${entry.kind === "sale" ? "amount-positive" : "amount-negative"}`}>{entry.kind === "sale" ? "+" : "−"}{fmt(entry.amountUgx)}</span>{canCorrectEntry(entry.kind) && entry.state === "posted" && entry.canCorrect && <button className="button" type="button" onClick={() => void requestEntryCorrection(entry)}>Correct…</button>}{canVoidEntry(entry.kind) && entry.state === "posted" && entry.canVoid && <button className="button" type="button" onClick={() => void requestEntryVoid(entry._id)}>Void…</button>}</div>)}</div>{entries?.length === entryLimit && entryLimit < 500 && <button className="button" type="button" onClick={() => setEntryLimit(limit => Math.min(limit + 100, 500))}>Load more entries</button>}{entries?.length === 500 && <p className="muted-note">Showing the latest 500 matching records. Narrow the date range to review older entries.</p>}</> : <EmptyPanel message="No entries have been recorded." next="Use the form to save the first entry." />}
      </Card> : null}
    </div>}</div>
    <div className="board-source-note">{screen.source} · Values shown here come from authorized Convex records. Sample values from the design references are not loaded into the workspace.</div>
  </>;
}

function EmptyPanel({ message, next }: { message: string; next: string }) {
  return <div className="empty-state compact-empty"><strong>{message}</strong><span>{next}</span></div>;
}

function EntryCsvExportControl({ businessId, kind, from, toExclusive, account, currency, scale }: { businessId: Id<"businesses">; kind: "sale" | "expense"; from: string; toExclusive: string; account: FinanceAccount; currency: string; scale: number }) {
  const convex = useConvex();
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  async function exportCsv() {
    setExporting(true);
    setMessage("");
    try {
      let cursor: string | null = null;
      const results: Array<{ entryId: Id<"entries">; kind: "sale" | "expense"; amountUgx: number; occurredOn: string; account: "cash" | "mobile_money" | "unallocated"; category: string; note: string; state: "posted" | "void"; source: "manual" | "import" | "webhook" | "google_form"; createdAt: number; createdBy: Id<"users"> }> = [];
      let done = false;
      while (!done) {
        const page: { page: typeof results; isDone: boolean; continueCursor: string } = await convex.query(api.workspace.entriesForExport, { businessId, kind, from, toExclusive, ...(account === "all" ? {} : { account }), paginationOpts: { numItems: 100, cursor } });
        if (results.length + page.page.length > EXPORT_ENTRY_LIMIT || (results.length + page.page.length === EXPORT_ENTRY_LIMIT && !page.isDone)) {
          setMessage("This range contains more than 10,000 entries. Narrow the date range before exporting.");
          return;
        }
        results.push(...page.page);
        cursor = page.continueCursor;
        done = page.isDone;
      }
    const headers = ["Date", "Type", "Category", "Account", `Amount (${currency})`, "Currency", "Status", "Source", "Entry ID", "Created at (UTC)", "Actor ID", "Description"];
    const escape = (value: string) => {
      const spreadsheetSafe = /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
      return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
    };
    const rows = results.map(row => [row.occurredOn, row.kind, row.category, accountLabel(row.account), String(row.amountUgx / scale), currency, row.state, row.source, row.entryId, new Date(row.createdAt).toISOString(), row.createdBy, row.note]);
    const csv = [headers, ...rows].map(row => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `mylesnet-${kind}-${from}-to-${toExclusive}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`${rows.length.toLocaleString()} ${kind} entries exported.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export this range.");
    } finally {
      setExporting(false);
    }
  }

  return <div className="form-actions"><button className="button" type="button" disabled={exporting} onClick={() => void exportCsv()}><Download size={14} />{exporting ? "Preparing CSV…" : "Export CSV"}</button>{message && <span className="muted-note" role="status">{message}</span>}</div>;
}

type DailyTotal = { day: string; salesUgx: number; expensesUgx: number; netUgx: number };

function DailyHistoryTable({ days, totals, range, periodLabel, loading, formatDay, formatMoney }: { days: DailyTotal[] | undefined; totals: { salesUgx: number; expensesUgx: number; netUgx: number } | undefined; range: { from: string; toExclusive: string }; periodLabel: string; loading: boolean; formatDay: (day: string) => string; formatMoney: (amount: number) => string }) {
  if (!days || !totals) return <EmptyPanel message={loading ? "Loading daily activity…" : "Daily history is not available for this account."} next={`Complete daily rows and totals for the selected ${periodLabel.toLowerCase()} period are shown here.`} />;
  const byDate = new Map(days.map(day => [day.day, day]));
  const start = new Date(`${range.from}T00:00:00.000Z`);
  const count = Math.min(370, Math.max(0, (Date.parse(`${range.toExclusive}T00:00:00.000Z`) - start.getTime()) / 86_400_000));
  const recentDays = Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return byDate.get(key) ?? { day: key, salesUgx: 0, expensesUgx: 0, netUgx: 0 };
  });
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>Business date</th><th>Sales</th><th>Total expenses</th><th>Cashbook net</th><th>Activity</th></tr></thead><tbody>{recentDays.map(day => <tr key={day.day}><td>{formatDay(day.day)}</td><td>{formatMoney(day.salesUgx)}</td><td>{formatMoney(day.expensesUgx)}</td><td>{formatMoney(day.netUgx)}</td><td>{byDate.has(day.day) ? "Recorded" : "No recorded activity"}</td></tr>)}</tbody><tfoot><tr><th>{periodLabel} total</th><th>{formatMoney(totals.salesUgx)}</th><th>{formatMoney(totals.expensesUgx)}</th><th>{formatMoney(totals.netUgx)}</th><th /></tr></tfoot></table></div>;
}

function MonthlyPnlTable({ months, totals, loading, locale, periodLabel, formatMoney }: { months: { month: string; salesUgx: number; expensesUgx: number; netUgx: number }[] | undefined; totals: { salesUgx: number; expensesUgx: number; netUgx: number } | undefined; loading: boolean; locale: string; periodLabel: string; formatMoney: (amount: number) => string }) {
  if (!months || !totals) return <EmptyPanel message={loading ? "Loading selected-period statement…" : "This statement is not available for this account."} next={`Values reflect the selected ${periodLabel.toLowerCase()} period and saved cashbook totals.`} />;
  if (months.length === 0) return <EmptyPanel message="No activity in the selected period." next="Monthly results will appear here as sales and expenses are saved." />;
  const monthLabel = (month: string) => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00.000Z`));
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>Month in selected period</th><th>Sales</th><th>Total expenses</th><th>Cashbook net</th></tr></thead><tbody>{months.map(values => <tr key={values.month}><td>{monthLabel(values.month)}</td><td>{formatMoney(values.salesUgx)}</td><td>{formatMoney(values.expensesUgx)}</td><td>{formatMoney(values.netUgx)}</td></tr>)}</tbody><tfoot><tr><th>{periodLabel} total</th><th>{formatMoney(totals.salesUgx)}</th><th>{formatMoney(totals.expensesUgx)}</th><th>{formatMoney(totals.netUgx)}</th></tr></tfoot></table></div>;
}

function CategoryBreakdown({ categories, formatMoney }: { categories: { category: string; amountUgx: number; sharePercent: number }[] | undefined; formatMoney: (amount: number) => string }) {
  if (!categories) return <EmptyPanel message="Loading complete category totals…" next="Category totals appear when the selected period is within its safe reporting limit." />;
  return categories.length === 0
    ? <EmptyPanel message="No saved category activity in this period." next="Category totals will appear when posted entries are recorded." />
    : <div className="category-breakdown-list">{categories.map(({ category, amountUgx, sharePercent }) => <div className="category-breakdown-row" key={category}><span>{category}</span><span className="category-breakdown-track"><i style={{ width: `${Math.max(1, sharePercent)}%` }} /></span><strong>{formatMoney(amountUgx)}</strong><small>{sharePercent}%</small></div>)}</div>;
}

function ChartPanel({ summary, previous, range, previousRange, interactive, account, dateFormat, title, message, currency, scale, locale }: { summary: { days: { day: string; salesUgx: number; expensesUgx: number }[]; accountFilterComplete?: boolean } | null; previous: { days: { day: string; salesUgx: number; expensesUgx: number }[]; accountFilterComplete?: boolean } | null; range: { from: string; toExclusive: string }; previousRange: { from: string; toExclusive: string }; interactive: boolean; account: FinanceAccount; dateFormat: DateFormat; title: string; message: string; currency: string; scale: number; locale: string }) {
  if (summary?.accountFilterComplete === false || previous?.accountFilterComplete === false) return <p className="notice-banner notice-warning" role="status">Chart values are unavailable because the account scan reached its safe limit. Narrow the date range for complete results.</p>;
  const weekday = title.toLowerCase().includes("weekday") || title.toLowerCase().includes("best days");
  const daily = title.toLowerCase().includes("14 days") || title.toLowerCase().includes("daily");
  if (!weekday && !daily) return <EmptyPanel message="This chart is not available yet." next="The selected comparison needs categorized or workflow-specific records that are not stored in the cashbook yet." />;
  if (interactive) {
    const length = Math.max(1, (Date.parse(`${range.toExclusive}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`)) / 86_400_000);
    const currentDays = new Map((summary?.days ?? []).map(day => [day.day, day]));
    const previousDays = new Map((previous?.days ?? []).map(day => [day.day, day]));
    const points = Array.from({ length }, (_, index) => {
      const currentDate = new Date(`${range.from}T00:00:00.000Z`);
      currentDate.setUTCDate(currentDate.getUTCDate() + index);
      const day = currentDate.toISOString().slice(0, 10);
      const previousDate = new Date(`${previousRange.from}T00:00:00.000Z`);
      previousDate.setUTCDate(previousDate.getUTCDate() + index);
      const prior = previousDays.get(previousDate.toISOString().slice(0, 10));
      const current = currentDays.get(day);
      return { day, salesUgx: current?.salesUgx ?? 0, expensesUgx: current?.expensesUgx ?? 0, netUgx: (current?.salesUgx ?? 0) - (current?.expensesUgx ?? 0), previousSalesUgx: prior?.salesUgx ?? 0 };
    });
    return <InteractiveFinanceChart points={points} currency={currency} scale={scale} locale={locale} dateFormat={dateFormat} accountFiltered={account !== "all"} complete />;
  }
  const days = summary?.days.slice(-14) ?? [];
  const bars = weekday ? Array.from({ length: 7 }, (_, weekdayIndex) => {
    const matching = (summary?.days ?? []).filter(day => new Date(`${day.day}T00:00:00.000Z`).getUTCDay() === weekdayIndex);
    return { key: String(weekdayIndex), label: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, 7 + weekdayIndex))), salesUgx: matching.reduce((total, day) => total + day.salesUgx, 0), expensesUgx: matching.reduce((total, day) => total + day.expensesUgx, 0) };
  }) : days.map(day => ({ key: day.day, label: day.day.slice(8), salesUgx: day.salesUgx, expensesUgx: day.expensesUgx }));
  const max = Math.max(1, ...bars.map((day) => Math.max(day.salesUgx, day.expensesUgx)));
  if (bars.length === 0 || !bars.some((day) => day.salesUgx || day.expensesUgx)) return <EmptyPanel message="No chart data yet." next="Recorded activity will appear here. Mock chart values are not treated as real." />;
  return <>
    <div className="board-bars" role="img" aria-label={message}>{bars.map((day) => <div className="board-bar-day" key={day.key} title={`${day.label}: sales ${formatMoney(day.salesUgx, currency, scale, locale)}; expenses ${formatMoney(day.expensesUgx, currency, scale, locale)}`}><div className="board-bar-pair"><span className="board-bar-sales" style={{ height: `${Math.max(2, day.salesUgx / max * 100)}%` }} /><span className="board-bar-expenses" style={{ height: `${Math.max(2, day.expensesUgx / max * 100)}%` }} /></div><span>{day.label}</span></div>)}</div>
    <div className="chart-legend"><span><i className="legend-sales" /> Sales</span><span><i className="legend-expenses" /> Expenses</span></div>
  </>;
}

function WorkflowPanel({ screen, section, currency, scale, businessDay }: { screen: BoardSpec; section: string; currency: string; scale: number; businessDay: string }) {
  if (section === "Add an expense" || section === "Add a sale") return <div className="empty-state compact-empty"><strong>Entry capture is available above.</strong><span>Use the saved cashbook form so the balance and audit trail update together.</span></div>;
  const recordKind = section === "Movement tracking status" ? "movement" : section === "Holdings tracking status" ? "holding" : section === "Loan tracking status" ? "loan" : section === "Bill tracking status" ? "bill" : null;
  if (recordKind) return <OperationalRecordForm kind={recordKind} currency={currency} scale={scale} businessDay={businessDay} />;
  const settingsWorkflow = screen.settings || screen.title === "Reconcile";
  return <div className="workflow-callout"><span className="workflow-indicator" /><div><strong>{settingsWorkflow ? `${section} is not configured yet` : `${section} is not available yet`}</strong><p className="muted-note">{settingsWorkflow ? "Review the related Finance or Rules settings. This card does not create financial records." : "This workflow is a product roadmap item; it does not yet save records or change account balances."}</p>{settingsWorkflow && <Link href={screen.title === "Reconcile" ? "/settings/rules" : "/settings/finance"} className="text-link">Review related settings →</Link>}</div></div>;
}
