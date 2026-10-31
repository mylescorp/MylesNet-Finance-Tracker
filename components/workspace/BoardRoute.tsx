"use client";

import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowDownRight, ArrowUpRight, Download, Plus, Share2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { CategoryBudgetsPanel } from "@/components/workspace/CategoryBudgetsPanel";
import { ExpenseReceiptsPanel } from "@/components/workspace/ExpenseReceiptsPanel";
import { SplitCorrectionDrawer, type SplitAllocationInput } from "@/components/workspace/SplitCorrectionDrawer";
import { SupplierManager } from "@/components/workspace/SupplierManager";
import { AttachExpenseReceipt } from "@/components/workspace/AttachExpenseReceipt";
import { FinancePeriodFilters } from "@/components/workspace/FinancePeriodFilters";
import { InteractiveFinanceChart } from "@/components/workspace/InteractiveFinanceChart";
import { MonthEndClosePanel } from "@/components/workspace/MonthEndClosePanel";
import { ExpenseTemplateManager } from "@/components/workspace/ExpenseTemplateManager";
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
      { title: "Imports and data checks", detail: "Review imported batches, row counts, and reversals in Settings → Data. Imported entries retain their source and audit history." },
      { title: "Weak-day review and entry corrections", detail: "Analytics flags low-sales days and keeps explanations with the selected report period. Correct a saved entry from the ledger to retain the original and record the reason; diary notes never change sales values." },
      { title: "Voucher batches and mobile entry", detail: "Voucher redemptions can arrive through the Centipid integration. Voucher stock and issued-batch tracking are not implemented; record manual sales through the cashbook form." },
    ],
  },
  expenses: {
    title: "Expenses", eyebrow: "Cashbook", description: "Record and review operating costs and equipment purchases.", source: "04 · Expenses", entryKind: "expense",
    metrics: ["This month", "Year to date", "Expense ratio", "Average per day", "Approval queue"],
    sections: [
      { title: "Expenses by category", detail: "Category mix is calculated from saved expenses and distinguishes operating costs from equipment.", kind: "table" },
      { title: "Expenses by category · year to date", detail: "Fiscal-year totals from posted entries, using the same account filter.", kind: "table" },
      { title: "Operating vs equipment", detail: "Equipment is identified only when an expense uses the configured Equipment category.", kind: "chart" },
      { title: "Alerts", detail: "Highlights are calculated from the selected period and visible expense categories." },
      { title: "Category budgets", detail: "Set a monthly limit and review threshold for each saved expense category. Actuals are calculated from posted entries in the selected month." },
      { title: "Receipts and evidence", detail: "Attach private receipt files when recording an expense, then review or remove them here. Supplier links and spend history are available in Supplier tracking." },
      { title: "Recurring costs", detail: "Create expense reminders with cadence, due date, supplier, category, and account defaults. Reminders never post expenses automatically." },
      { title: "Supplier tracking", detail: "Maintain workspace-scoped suppliers, link an expense and invoice reference, and review posted spend history. Line-item unit prices are not captured." },
      { title: "Recurring expense detector", detail: "Repeated category and amount combinations in the selected period are suggestions only." },
      { title: "Audit trail", detail: "Audited changes are available in Settings → Access for members with audit permission." },
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
      { title: "Record and review movements", detail: "Transfers, withdrawals, deposits, and partner capital contributions can be recorded with auditable reversals.", kind: "workflow" },
      { title: "Withdrawal fees and cash reconciliation", detail: "Record an actual withdrawal fee with the movement. Cash counts, optional denomination breakdowns, and variance explanations are available in Reconcile; approved month-end closes add a separate period sign-off and posting lock." },
      { title: "Money flow and unexplained balance", detail: "Compare account balances with sales, expenses, and recorded movements." },
    ],
  },
  savings: {
    title: "Savings", eyebrow: "Cashbook", description: "Track savings holdings, contributions, goals, and returns.", source: "06 · Savings",
    metrics: ["Current value", "Contributions", "Gain or loss", "Cash buffer", "Could set aside"],
    sections: [
      { title: "Holdings", detail: "No holdings are recorded yet. Add a holding to track its value and contributions.", kind: "table" },
      { title: "Record and review savings activity", detail: "Track holdings and record contributions or withdrawals. Current values reflect saved holding and flow records.", kind: "workflow" },
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
      { title: "Record and review loans", detail: "Record loans, repayments, and reversals. Scheduled payment figures are estimates until actual payments are recorded.", kind: "workflow" },
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
      { title: "Budget versus actual", detail: "Monthly category budgets and posted expense actuals are available in Expenses. The month-end close snapshot compares budget limits with actuals for the same month; multi-month budget comparisons remain unavailable." },
      { title: "Month-end close and statement export", detail: "Prepare a full calendar-month cashbook snapshot after the close checklist passes, then have a different authorized reviewer approve it. Approval locks financial changes dated in that month; an authorized reviewer must reopen it with an audited reason before edits or reversals." },
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
      { title: "Record and review bills", detail: "Create recurring schedules, review due dates, and confirm payments. A confirmed payment records its expense; automatic external reminders are not configured." , kind: "workflow"},
      { title: "Margin impact and reminders", detail: "Accruals affect profit only when recorded as expenses; reminders do not book entries automatically." },
      { title: "Supplier price history", detail: "Supplier-linked posted expense spend history is available in Expenses. Item-level price trends are unavailable because quantity and line-item detail are not recorded." },
      { title: "Calendar sync and accrual automation", detail: "Calendar delivery is not configured. Bill schedules do not post expenses automatically; confirm a payment on Bills to create an expense entry." },
    ],
  },
  reconcile: {
    title: "Reconcile", eyebrow: "Controls", description: "Compare counted balances with the cashbook and resolve discrepancies.", source: "12 · Reconcile",
    metrics: ["Accounts", "Open issues", "Balance difference", "Tolerance", "Locked through"],
    sections: [
      { title: "Account reconciliation", detail: "Enter a counted balance for each account and inspect the variance.", kind: "table" },
      { title: "Reconciliation checklist", detail: "Count cash, confirm mobile money, and explain or reopen variances. Month-end close adds a separate reviewer approval and locks financial changes dated in the approved month." },
      { title: "Checks and variance explanations", detail: "Every difference links to its source and must be resolved or explained.", kind: "table" },
      { title: "Centipid CSV auto-match", detail: "CSV import matching becomes available after the source format is documented.", kind: "workflow" },
      { title: "Closing certificate", detail: "The approved printable statement includes the period, cashbook totals and exclusions, account movements, reconciliation evidence, matching-period budgets, close checklist, preparer, and approver." },
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
      { title: "Accounts and opening balances", detail: "The cashbook currently supports cash and mobile money. Set their opening balances before posting activity, then reconcile them against real funds.", kind: "workflow" },
      { title: "Income types and default account", detail: "Manage the saved income categories used on entries. Imported analytics totals can remain unallocated when an account split is unknown.", kind: "table" },
      { title: "Expense categories", detail: "Classify operating costs separately from equipment purchases.", kind: "table" },
      { title: "Movement types and expense warnings", detail: "Movement types are fixed. Rules can set a workspace-wide monthly expense warning; monthly category budgets are managed from Expenses.", kind: "workflow" },
      { title: "Bills setup", detail: "Recurring bill configuration is managed on the Bills screen." },
    ],
  },
  "settings/rules": {
    title: "Rules", eyebrow: "Settings", description: "Set finance thresholds, approvals, and reporting targets.", source: "15 · Settings · Rules", settings: true,
    metrics: ["Partners", "Payout day", "Approval limit", "Weak-day threshold", "Monthly target"],
    sections: [
      { title: "Partners and profit shares", detail: "Ownership must total 100% before payouts can be approved.", kind: "table" },
      { title: "Approval rules and period close", detail: "Finance Rules includes review thresholds and reporting targets. Period locking is managed in Month-end close; general transaction approvals are not configured, while partner distributions have their own approval flow.", kind: "workflow" },
      { title: "Targets and equipment", detail: "Set monthly sales, expense warning, payback, and weak-day targets.", kind: "workflow" },
      { title: "Alerts and reminders", detail: "In-app insights use saved thresholds. Automated bill and daily-report delivery reminders require a configured provider and are not active." },
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
  useEffect(() => {
    // Reset only the transient record drawer; preserve period filters when users switch boards.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenRecordRoute(null);
  }, [route]);
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
  const summary = useQuery(api.workspace.dashboardSummary, needsSummary && screen?.title !== "Expenses" && !financeRangeError ? { ...range, ...accountFilter } : "skip");
  const todayRange = useMemo(() => financePeriodRange("daily", today, weekStartsOn, fiscalStartMonth, financeCustomFrom, financeCustomTo), [today, weekStartsOn, fiscalStartMonth, financeCustomFrom, financeCustomTo]);
  const todaySummary = useQuery(api.workspace.dashboardSummary, ["Sales", "Daily Report"].includes(screen?.title ?? "") ? { ...todayRange, ...accountFilter } : "skip");
  const expensesSummary = useQuery(api.workspace.expensesSummary, screen?.title === "Expenses" && !financeRangeError ? { ...range, ...accountFilter, today } : "skip");
  const previousRange = useMemo(() => previousFinanceRange(analyticsRange), [analyticsRange]);
  const previousSummary = useQuery(api.workspace.dashboardSummary, screen?.title === "Analytics" && !financeRangeError ? { ...previousRange, ...accountFilter } : "skip");
  const entryKind = screen?.title === "Sales" ? "sale" : screen?.title === "Expenses" ? "expense" : undefined;
  const entries = useQuery(api.workspace.recentEntries, entryKind && !financeRangeError ? { limit: entryLimit, kind: entryKind, from: range.from, toExclusive: range.toExclusive, ...accountFilter } : "skip");
  const operationalOverview = useQuery(api.operations.overview, screen?.title === "Expenses" && settings?.access === "ready" && !financeRangeError ? { businessId: settings.businessId, ...range, ...accountFilter } : "skip");
  const yearToDateRange = useMemo(() => {
    const [currentYear, currentMonth] = today.split("-").map(Number);
    const startYear = currentMonth < fiscalStartMonth ? currentYear - 1 : currentYear;
    const from = `${startYear}-${String(fiscalStartMonth).padStart(2, "0")}-01`;
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { from, toExclusive: tomorrow.toISOString().slice(0, 10) };
  }, [today, fiscalStartMonth]);
  const yearSummary = useQuery(api.workspace.dashboardSummary, screen?.title === "Monthly P&L" && !financeRangeError ? { ...range, ...accountFilter } : "skip");
  const expensesYearSummary = useQuery(api.workspace.expensesSummary, screen?.title === "Expenses" && !financeRangeError ? { ...yearToDateRange, ...accountFilter, today } : "skip");
  const trailingSevenSummary = useQuery(api.workspace.dashboardSummary, needsDailyHistory && !financeRangeError ? { ...range, ...accountFilter } : "skip");
  const voidEntry = useMutation(api.workspace.voidEntry);
  const correctEntry = useMutation(api.workspace.correctEntry);
  const saveSplitEstimate = useMutation(api.splitCorrections.saveEstimate);
  const confirmSplitEstimate = useMutation(api.splitCorrections.confirmEstimate);
  const cancelSplitEstimate = useMutation(api.splitCorrections.cancelEstimate);
  const reopenSplitCorrection = useMutation(api.splitCorrections.reopenConfirmed);
  const [entryActionFeedback, setEntryActionFeedback] = useState("");
  const [splitEntry, setSplitEntry] = useState<NonNullable<typeof entries>[number] | null>(null);
  const [splitBusy, setSplitBusy] = useState(false);
  const closeSplitDrawer = useCallback(() => setSplitEntry(null), []);

  if (!screen) return <WorkspaceTitle title="Page not found" description="Choose a section from the navigation." />;
  if (settings?.access === "ready" && settings.role === "finance_approver" && screen.title !== "Partners") return <><WorkspaceTitle title="Distribution review" description="Finance approver access is scoped to independent partner distribution review." /><div className="notice-banner notice-info" role="status">Open Partners to review pending distribution requests. Business records, reports, and workspace settings are not available to this role.</div></>;

  const summaryReady = summary?.access === "ready" ? summary : null;
  const stats = summaryReady?.accountFilterComplete ? summaryReady : null;
  const todayStats = todaySummary?.access === "ready" && todaySummary.accountFilterComplete ? todaySummary : null;
  const expenseStats = expensesSummary?.access === "ready" && expensesSummary.accountFilterComplete ? expensesSummary : null;
  const expenseYearStats = expensesYearSummary?.access === "ready" && expensesYearSummary.accountFilterComplete ? expensesYearSummary : null;
  const pageAccess = screen.title === "Expenses" ? expensesSummary?.access : summary?.access;
  const canViewBills = access?.access === "ready" && access.permissions.includes("bills.view");
  const expenseBills = canViewBills && operationalOverview?.access === "ready" ? operationalOverview.bills : undefined;
  const expenseBillsAccess = access?.access === "ready" && !canViewBills ? "restricted" : operationalOverview?.access;
  const weekDays = trailingSevenSummary?.access === "ready" && trailingSevenSummary.accountFilterComplete ? trailingSevenSummary.days : undefined;
  const metricValues: Partial<Record<string, string>> = {
    Sales: fmt(stats?.salesUgx),
    "Best day": stats ? fmt(Math.max(0, ...stats.days.map((day) => day.salesUgx))) : "—",
    "Days recorded": stats ? `${stats.days.filter((day) => day.salesUgx + day.expensesUgx > 0).length}` : "—",
    "Expense ratio": screen.title === "Expenses" ? expenseStats?.expenseInsights.expenseRatioPercent === null || expenseStats?.expenseInsights.expenseRatioPercent === undefined ? "—" : `${expenseStats.expenseInsights.expenseRatioPercent}%` : stats?.salesUgx ? `${Math.round(stats.expensesUgx / stats.salesUgx * 100)}%` : "—",
    "Average daily expenses": stats ? fmt(Math.round(stats.expensesUgx / Math.max(1, stats.days.length))) : "—",
    "Net margin": stats?.salesUgx ? `${Math.round((stats.salesUgx - stats.expensesUgx) / stats.salesUgx * 100)}%` : "—",
    "Cash on hand": fmt(stats?.cashBalanceUgx),
    "Mobile money": fmt(stats?.mobileMoneyBalanceUgx),
    "Sales today": fmt(todayStats?.salesUgx),
    "This month": fmt(screen.title === "Expenses" ? expenseStats?.expensesUgx : stats?.expensesUgx),
    "Year to date": fmt(screen.title === "Expenses" ? expenseYearStats?.expensesUgx : yearSummary?.access === "ready" && yearSummary.accountFilterComplete ? yearSummary.expensesUgx : undefined),
    "Average per day": screen.title === "Expenses" ? fmt(expenseStats?.expenseInsights.averagePerDayUgx) : stats ? fmt(Math.round(stats.salesUgx / Math.max(1, (Date.parse(`${range.toExclusive}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`)) / 86_400_000))) : "—",
    "Entry basis": "Recorded",
    "Sales YTD": fmt(yearSummary?.access === "ready" && yearSummary.accountFilterComplete ? yearSummary.salesUgx : undefined),
    "Total expenses": fmt(stats?.expensesUgx),
    "Cashbook net": stats ? fmt(stats.salesUgx - stats.expensesUgx) : "—",
    // A net profit figure is withheld until equipment and other adjustments are modeled.
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
  async function saveSplitAllocationEstimate(allocations: SplitAllocationInput[], reason: string) {
    if (settings?.access !== "ready" || !splitEntry) return;
    setSplitBusy(true);
    try {
      await saveSplitEstimate({ businessId: settings.businessId, entryId: splitEntry._id, allocations, reason, idempotencyKey: crypto.randomUUID() });
      setEntryActionFeedback("Split estimate saved for review. It does not affect balances or reports until confirmed.");
      closeSplitDrawer();
    } catch (error) {
      setEntryActionFeedback(error instanceof Error ? error.message : "Could not save the split estimate.");
      throw error;
    } finally { setSplitBusy(false); }
  }
  async function requestConfirmSplit(entry: NonNullable<typeof entries>[number]) {
    const allocationSummary = entry.splitAllocations.map(item => `${item.category}: ${fmt(item.amountUgx)} (${accountLabel(item.account)})`).join("\n");
    if (settings?.access !== "ready" || !entry.splitCorrectionId || !window.confirm(`Confirm this allocation? The original row will be replaced by these entries:\n\n${allocationSummary}\n\nThe total amount stays the same; account balances will reflect the allocation.`)) return;
    setEntryActionFeedback("");
    const overrides: { confirmNegativeBalance?: boolean } = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const ids = await confirmSplitEstimate({ businessId: settings.businessId, splitCorrectionId: entry.splitCorrectionId, ...overrides });
        setEntryActionFeedback(`Split confirmed as ${ids.length} audited entries. Amount is unchanged; category and account allocations are now posted.`);
        return;
      } catch (error) {
        const details = error instanceof ConvexError ? error.data as { code?: string; message?: string } : null;
        if (details?.code === "CONFIRM_NEGATIVE" && !overrides.confirmNegativeBalance && window.confirm(`${details.message ?? "This split may make an account negative."} Continue and record this override?`)) { overrides.confirmNegativeBalance = true; continue; }
        setEntryActionFeedback(details?.message ?? (error instanceof Error ? error.message : "Could not confirm the split."));
        return;
      }
    }
  }
  async function requestCancelSplit(entry: NonNullable<typeof entries>[number]) {
    if (settings?.access !== "ready" || !entry.splitCorrectionId) return;
    const reason = window.prompt("Reason for cancelling this estimated split (at least 5 characters):") ?? "";
    if (reason.trim().length < 5) return;
    try {
      await cancelSplitEstimate({ businessId: settings.businessId, splitCorrectionId: entry.splitCorrectionId, reason });
      setEntryActionFeedback("Split estimate cancelled. The original entry remains unchanged.");
    } catch (error) { setEntryActionFeedback(error instanceof Error ? error.message : "Could not cancel the split estimate."); }
  }
  async function requestReopenSplit(entry: NonNullable<typeof entries>[number]) {
    if (settings?.access !== "ready" || !entry.splitCorrectionId) return;
    const reason = window.prompt("Reason for reopening this confirmed split (at least 5 characters):") ?? "";
    if (reason.trim().length < 5) return;
    const overrides: { confirmNegativeBalance?: boolean } = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await reopenSplitCorrection({ businessId: settings.businessId, splitCorrectionId: entry.splitCorrectionId, reason, idempotencyKey: crypto.randomUUID(), ...overrides });
        setEntryActionFeedback("Confirmed split reopened with an audit reason. The original entry is restored and the estimate can be revised.");
        return;
      } catch (error) {
        const details = error instanceof ConvexError ? error.data as { code?: string; message?: string } : null;
        if (details?.code === "CONFIRM_NEGATIVE" && !overrides.confirmNegativeBalance && window.confirm(`${details.message ?? "This operation may make an account negative."} Continue and record this override?`)) { overrides.confirmNegativeBalance = true; continue; }
        setEntryActionFeedback(details?.message ?? (error instanceof Error ? error.message : "Could not reopen the split."));
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
      <button className="button" type="button" onClick={() => window.print()}><Download size={14} />Print / Save PDF</button>
      <button className="button button-dark" type="button" onClick={() => void shareReport()}><Share2 size={14} />Copy page link</button>
      {shareFeedback && <span className="form-feedback" role="status">{shareFeedback}</span>}
      </div>
    </div>
    {financeRangeError && <p className="form-feedback form-error finance-range-error" role="alert">{financeRangeError}</p>}
    {pageAccess === "restricted" && <div className="notice-banner notice-info" role="status">Your role does not include access to this page’s summary data.</div>}
    {pageAccess === "pending" && <div className="notice-banner notice-warning" role="status">Workspace access is pending. Ask an owner to invite this Google account.</div>}
    {account !== "all" && (screen.title === "Expenses" ? expensesSummary?.access === "ready" && !expensesSummary.accountFilterComplete : summaryReady && !summaryReady.accountFilterComplete) && <div className="notice-banner notice-warning" role="status">Some account-filtered totals reached the safe record limit. Affected figures are withheld; choose a shorter date range for complete results.</div>}
    {!operationalScreen && <div className={`metric-grid board-metric-grid${screen.title === "Expenses" ? " expenses-metric-grid" : ""}`}>
      {screen.metrics.filter(label => metricValues[label] !== undefined).map((label, index) => {
        const heading = screen.title === "Expenses" && label === "This month" && financePeriod !== "monthly" ? `Expenses · ${financePeriodLabel}` : label;
        const note = screen.title === "Expenses"
          ? label === "This month" ? `Posted expenses in the selected ${financePeriodLabel.toLowerCase()} period`
            : label === "Year to date" ? "Fiscal year to date · same account filter"
              : label === "Expense ratio" ? "Expenses ÷ sales in this period"
                : label === "Average per day" ? "Period expenses ÷ calendar days"
              : "Based on saved workspace records"
          : label === "Sales today" && todaySummary?.access === "ready" && !todaySummary.accountFilterComplete ? "Unavailable · today's safe summary limit was reached"
            : (label === "Expense ratio" || label === "Net margin") && stats?.salesUgx === 0 ? "Requires recorded sales in this period"
          : summaryReady && !summaryReady.accountFilterComplete ? "Unavailable · narrow the date range" : metricValues[label] === undefined ? "Available when this record type is configured" : "Based on saved workspace records";
        return <Card className="metric-card board-metric-card" key={label}>
          <div className="card-heading"><span className="eyebrow">{screen.title === "Monthly P&L" && label === "Sales YTD" ? "Sales in period" : heading}</span><span className="entry-icon">{index % 2 === 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}</span></div>
          <div className={`metric-value${label === "Approval queue" ? " metric-value-muted" : ""}`}>{metricValues[label] ?? "—"}</div>
          <div className="metric-note">{note}</div>
        </Card>;
      })}
    </div>}
    {financeRangeError && <Card><div className="empty-state compact-empty"><strong>Choose a valid date range.</strong><span>{financeRangeError}</span></div></Card>}
    <div hidden={Boolean(financeRangeError)}>{screen.title === "Analytics" ? <AnalyticsInsights range={range} today={today} currency={currency} scale={currencyScale} locale={locale} dateFormat={dateFormat} account={account === "all" ? undefined : account} /> : screen.title === "Issues" || screen.title === "Needs attention" ? <AnalyticsInsights range={range} today={today} currency={currency} scale={currencyScale} locale={locale} account={account === "all" ? undefined : account} issuesOnly /> : operationalScreen ? <OperationsWorkspace key={screen.title} screen={screen.title as "Movements" | "Savings" | "Loans" | "Partners" | "Bills" | "Reconcile"} currency={currency} scale={currencyScale} locale={locale} timezone={timezone} dateFormat={dateFormat} range={range} account={account} recordFormOpen={recordFormOpen} onRecordSaved={() => setOpenRecordRoute(null)} onOpenRecord={() => setOpenRecordRoute(route)} /> : <div className={`board-grid${screen.title === "Expenses" ? ` board-grid-expenses${recordFormOpen ? " board-grid-expenses-record-open" : ""}` : ""}`}>
      {screen.entryKind && screen.title !== "Expenses" && <div id="record-entry-card" hidden={!recordFormOpen}><Card className="board-feature-card">
        <div className="card-heading"><div><h2 className="card-title">{screen.entryKind === "sale" ? "Add a sale" : "Add an expense"}</h2><p className="card-subtitle">Saved values update the cashbook and account balance.</p></div></div>
        <EntryForm kind={screen.entryKind} onSaved={() => setOpenRecordRoute(null)} />
      </Card></div>}
      {screen.title === "Expenses" && <div id="record-entry-card" className="expenses-record-card-wrapper" hidden={!recordFormOpen}>{recordFormOpen && <Card className="board-section-card expenses-panel expenses-panel-record-form">
        <div className="card-heading"><div><h2 className="card-title">Record an expense</h2><p className="card-subtitle">Saved expenses update the cashbook and account balance.</p></div></div>
        <EntryForm kind="expense" onSaved={() => setOpenRecordRoute(null)} />
      </Card>}</div>}
      {screen.sections.map((section) => <Card className={`board-section-card${screen.title === "Expenses" ? ` expenses-panel expenses-panel-${expensePanelSlug(section.title)}` : ""}`} key={section.title}>
        <div className="card-heading"><div><h2 className="card-title">{section.title === "Daily sales · last 14 days" ? `Sales activity · ${financePeriodLabel}` : section.title === "Daily activity" ? `Daily entries · ${financePeriodLabel}` : section.title === "Profit and loss by month" ? `Profit and loss · ${financePeriodLabel}` : section.title}</h2><p className="card-subtitle">{section.title === "Profit and loss statement" ? `Statement · ${financePeriodLabel} · ${fmtDate(range.from)} — ${fmtDate(rangeLastDay.toISOString().slice(0, 10))}` : section.detail}</p></div>{section.kind === "table" && section.title === (entryKind === "sale" ? "Daily sales · last 14 days" : "Expenses by category") && entryKind && access?.access === "ready" && access.permissions.includes("data.export") && <EntryCsvExportControl businessId={access.businessId} kind={entryKind} from={range.from} toExclusive={range.toExclusive} account={account} currency={currency} scale={currencyScale} />}</div>
        {section.title === "Imports and data checks" ? <div className="empty-state compact-empty"><strong>Import history is available in Data settings.</strong><span>{section.detail}</span><Link className="text-link" href="/settings/data">Open import history →</Link></div>
        : section.title === "Weak-day review and entry corrections" ? <div className="empty-state compact-empty"><strong>Review weak-day flags in Analytics.</strong><span>{section.detail}</span><Link className="text-link" href="/analytics">Open Analytics →</Link></div>
        : section.title === "Voucher batches and mobile entry" ? <div className="empty-state compact-empty"><strong>Voucher stock tracking is not implemented.</strong><span>{section.detail}</span></div>
        : section.title === "Supplier price history" ? <div className="empty-state compact-empty"><strong>Review supplier-linked expense spend in Expenses.</strong><span>{section.detail}</span><Link className="text-link" href="/expenses">Open Expenses →</Link></div>
        : section.title === "Budget versus actual" ? <div className="empty-state compact-empty"><strong>Review monthly category budgets in Expenses.</strong><span>{section.detail}</span><Link className="text-link" href="/expenses">Open Expenses →</Link></div>
        : section.title === "Month-end close and statement export" ? access?.access === "ready" ? <MonthEndClosePanel businessId={access.businessId} today={today} currency={currency} scale={currencyScale} locale={locale} /> : <div className="empty-state compact-empty"><strong>Workspace access is required.</strong><span>{section.detail}</span></div>
        : section.title === "Expenses by category" ? <ExpenseCategoryTable categories={preferences?.access === "ready" ? preferences.expenseCategories : []} amounts={expenseStats?.categoryTotals} total={expenseStats?.expensesUgx} formatMoney={fmt} />
        : section.title === "Expenses by category · year to date" ? <ExpenseCategoryTable categories={preferences?.access === "ready" ? preferences.expenseCategories : []} amounts={expenseYearStats?.categoryTotals} total={expenseYearStats?.expensesUgx} formatMoney={fmt} />
        : section.title === "Operating vs equipment" ? <ExpenseMix insights={expenseStats?.expenseInsights} total={expenseStats?.expensesUgx} formatMoney={fmt} />
        : section.title === "Alerts" ? <ExpenseSignals categories={expenseStats?.categoryTotals} largest={expenseStats?.expenseInsights.largest ?? null} bills={expenseBills} monthlyExpense={expenseStats?.monthlyExpense} complete={Boolean(expenseStats?.accountFilterComplete)} today={today} formatMoney={fmt} formatDay={fmtDate} />
        : section.title === "Category budgets" ? <CategoryBudgetsPanel from={range.from} toExclusive={range.toExclusive} account={account} currency={currency} scale={currencyScale} locale={locale} />
        : section.title === "Receipts and evidence" ? <ExpenseReceiptsPanel currency={currency} scale={currencyScale} locale={locale} />
        : section.title === "Recurring costs" ? <><ExpenseTemplateManager currency={currency} scale={currencyScale} locale={locale} /><RecurringCosts bills={expenseBills} access={expenseBillsAccess} today={today} formatMoney={fmt} formatDay={fmtDate} /></>
        : section.title === "Supplier tracking" ? <SupplierManager currency={currency} scale={currencyScale} locale={locale} />
        : section.title === "Recurring expense detector" ? <RecurringExpenseSuggestions patterns={expenseStats?.expenseInsights.recurringPatterns} complete={Boolean(expenseStats?.accountFilterComplete)} formatMoney={fmt} />
        : section.title === "Audit trail" ? <ExpenseAuditPreview entries={selectedEntries} formatDay={fmtDate} />
        : section.kind === "table" && (screen.title === "Sales" || screen.title === "Expenses") ? (
          hasRecordData ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Type</th><th>Category</th>{screen.title === "Expenses" && <th>Supplier</th>}<th>Account</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>{selectedEntries.map((entry) => <tr key={entry._id}><td>{fmtDate(entry.occurredOn)}</td><td>{entry.kind}</td><td>{entry.category}</td>{screen.title === "Expenses" && <td>{entry.supplierName ?? "—"}{entry.supplierReference && <small className="muted-note">{entry.supplierReference}</small>}</td>}<td>{accountLabel(entry.account)}</td><td>{fmt(entry.amountUgx)}</td><td><span className={`status-chip ${entry.state === "posted" ? "status-ok" : "status-warning"}`}>{entry.state}</span>{entry.splitCorrectionStatus === "estimated" && <small className="muted-note">Estimated split · not posted</small>}{entry.splitCorrectionStatus === "confirmed" && (entry.isSplitReplacement ? <small className="muted-note">Split allocation · confirmed</small> : <small className="muted-note">Replaced by confirmed split</small>)}{entry.splitCorrectionStatus === "cancelled" && <small className="muted-note">Split estimate cancelled · original unchanged</small>}{entry.splitCorrectionStatus === "reversed" && <small className="muted-note">{entry.isSplitReplacement ? "Split allocation · reversed" : entry.state === "posted" ? "Split correction reopened" : "Split correction reversed"}</small>}</td><td>{screen.title === "Expenses" && entry.canAttachReceipt && <AttachExpenseReceipt entryId={entry._id} />} {canCorrectEntry(entry.kind) && entry.state === "posted" && entry.canCorrect && <button className="button" type="button" onClick={() => void requestEntryCorrection(entry)}>Correct…</button>} {canCorrectEntry(entry.kind) && entry.state === "posted" && entry.canSplit && <button className="button" type="button" onClick={() => setSplitEntry(entry)}>Split…</button>} {canCorrectEntry(entry.kind) && entry.splitCorrectionStatus === "estimated" && entry.splitCorrectionId && <><button className="button" type="button" onClick={() => setSplitEntry(entry)}>Review split…</button><button className="button" type="button" onClick={() => void requestConfirmSplit(entry)}>Confirm split</button><button className="button" type="button" onClick={() => void requestCancelSplit(entry)}>Cancel estimate</button></>} {canCorrectEntry(entry.kind) && entry.splitCorrectionStatus === "confirmed" && !entry.isSplitReplacement && entry.splitCorrectionId && <button className="button" type="button" onClick={() => void requestReopenSplit(entry)}>Reopen split…</button>} {canVoidEntry(entry.kind) && entry.state === "posted" && entry.canVoid && <button className="button" type="button" onClick={() => void requestEntryVoid(entry._id)}>Void…</button>}</td></tr>)}</tbody></table></div> : <EmptyPanel message="No entries yet." next="Add an entry to populate this view. The design preview figures are examples, not live business data." />
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
      {screen.title === "Sales" || screen.title === "Expenses" ? <Card className={`board-section-card board-entry-ledger-card${screen.title === "Expenses" ? " expenses-panel expenses-panel-recent" : ""}`}>
        <div className="card-heading"><div><h2 className="card-title">Recent cashbook entries</h2><p className="card-subtitle">Latest saved records in this workspace.</p></div><span className="board-ledger-count">{selectedEntries?.length ?? 0} {(selectedEntries?.length ?? 0) === 1 ? "entry" : "entries"}</span></div>
        {entryActionFeedback && <p className="form-feedback" role="status">{entryActionFeedback}</p>}
        {hasRecordData ? <><div className="table-scroll board-entry-ledger-scroll"><table className="data-table board-entry-ledger"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Status</th><th className="board-entry-amount-heading">Amount</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{selectedEntries.map((entry) => <tr key={entry._id}>
          <td className="board-entry-date">{fmtDate(entry.occurredOn)}</td>
          <td className="board-entry-description"><strong>{entry.note || entry.category}</strong><small>{entry.kind === "sale" ? "Sale" : "Expense"} record{entry.supplierName ? ` · ${entry.supplierName}${entry.supplierReference ? ` · Ref ${entry.supplierReference}` : ""}` : ""}</small></td>
          <td>{entry.category}</td><td>{accountLabel(entry.account)}</td>
          <td><span className={`status-chip ${entry.state === "posted" ? "status-ok" : "status-warning"}`}>{entry.state === "posted" ? "Posted" : "Voided"}</span>{entry.splitCorrectionStatus === "estimated" && <small className="muted-note">Estimated split · not posted</small>}{entry.splitCorrectionStatus === "confirmed" && <small className="muted-note">{entry.isSplitReplacement ? "Split allocation · confirmed" : "Replaced by confirmed split"}</small>}{entry.splitCorrectionStatus === "cancelled" && <small className="muted-note">Split estimate cancelled · original unchanged</small>}{entry.splitCorrectionStatus === "reversed" && <small className="muted-note">{entry.isSplitReplacement ? "Split allocation · reversed" : entry.state === "posted" ? "Split correction reopened" : "Split correction reversed"}</small>}</td>
          <td className={`board-entry-amount ${entry.kind === "sale" ? "amount-positive" : "amount-negative"}`}>{entry.kind === "sale" ? "+" : "−"}{fmt(entry.amountUgx)}</td>
          <td><div className="board-entry-actions">{screen.title === "Expenses" && entry.canAttachReceipt && <AttachExpenseReceipt entryId={entry._id} />}{canCorrectEntry(entry.kind) && entry.state === "posted" && entry.canCorrect && <button className="button" type="button" aria-label={`Correct ${entry.note || entry.category}`} onClick={() => void requestEntryCorrection(entry)}>Correct</button>}{canCorrectEntry(entry.kind) && entry.state === "posted" && entry.canSplit && <button className="button" type="button" aria-label={`Split ${entry.note || entry.category} by category`} onClick={() => setSplitEntry(entry)}>Split</button>}{canCorrectEntry(entry.kind) && entry.splitCorrectionStatus === "estimated" && entry.splitCorrectionId && <><button className="button" type="button" onClick={() => setSplitEntry(entry)}>Review split</button><button className="button" type="button" onClick={() => void requestConfirmSplit(entry)}>Confirm split</button><button className="button" type="button" onClick={() => void requestCancelSplit(entry)}>Cancel estimate</button></>}{canCorrectEntry(entry.kind) && entry.splitCorrectionStatus === "confirmed" && !entry.isSplitReplacement && entry.splitCorrectionId && <button className="button" type="button" onClick={() => void requestReopenSplit(entry)}>Reopen split</button>}{canVoidEntry(entry.kind) && entry.state === "posted" && entry.canVoid && <button className="button board-entry-void" type="button" aria-label={`Void ${entry.note || entry.category}`} onClick={() => void requestEntryVoid(entry._id)}>Void</button>}</div></td>
        </tr>)}</tbody></table></div>{entries?.length === entryLimit && entryLimit < 500 && <div className="board-entry-load-more"><button className="button" type="button" onClick={() => setEntryLimit(limit => Math.min(limit + 100, 500))}>Load more entries</button></div>}{entries?.length === 500 && <p className="muted-note">Showing the latest 500 matching records. Narrow the date range to review older entries.</p>}</> : <EmptyPanel message="No entries have been recorded." next="Use the form to save the first entry." />}
      </Card> : null}
    </div>}</div>
    <SplitCorrectionDrawer key={splitEntry?._id ?? "closed"} entry={splitEntry} currency={currency} scale={currencyScale} busy={splitBusy} reviewOnly={splitEntry?.splitCorrectionStatus === "estimated"} onClose={closeSplitDrawer} onSave={saveSplitAllocationEstimate} />
    <div className="board-source-note">{screen.source} · Values shown here come from authorized Convex records. Sample values from the design references are not loaded into the workspace.</div>
  </>;
}

function EmptyPanel({ message, next }: { message: string; next: string }) {
  return <div className="empty-state compact-empty"><strong>{message}</strong><span>{next}</span></div>;
}

type ExpenseCategoryAmount = { category: string; amountUgx: number; sharePercent: number };
type ExpenseEntryLike = { _id?: string; kind?: "sale" | "expense"; category: string; amountUgx: number; occurredOn: string; state: "posted" | "void" };

function expensePanelSlug(title: string) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function ExpenseCategoryTable({ categories, amounts, total, formatMoney }: { categories: string[]; amounts: ExpenseCategoryAmount[] | undefined; total: number | undefined; formatMoney: (amount: number | undefined) => string }) {
  if (total === undefined || amounts === undefined) return <EmptyPanel message="Category totals are unavailable." next="The selected range exceeded the safe summary limit. Choose a shorter period." />;
  const byCategory = new Map(amounts.map(row => [row.category, row]));
  const names = [...new Set([...categories, ...amounts.map(row => row.category)])];
  const rows = names.map(category => ({ category, amount: byCategory.get(category)?.amountUgx ?? 0, sharePercent: byCategory.get(category)?.sharePercent ?? 0 })).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  return <div className="table-scroll"><table className="data-table expense-category-table"><thead><tr><th>Category</th><th>Amount</th><th>Share</th><th>Mix</th></tr></thead><tbody>{rows.map(row => {
    const share = row.sharePercent;
    return <tr key={row.category}><td>{row.category}</td><td>{row.amount ? formatMoney(row.amount) : "—"}</td><td>{row.amount ? `${Math.round(share)}%` : "0%"}</td><td><span className="expense-mini-track"><i style={{ width: `${Math.max(0, Math.min(100, share))}%` }} /></span></td></tr>;
  })}</tbody><tfoot><tr><th>Total</th><th>{formatMoney(total)}</th><th>{total > 0 ? "100%" : "—"}</th><th /></tr></tfoot></table>{rows.length === 0 && <p className="muted-note">No expenses have been posted in this period.</p>}</div>;
}

type ExpenseInsightsLike = { operatingUgx: number; equipmentUgx: number; operatingPercent: number; equipmentPercent: number; expenseRatioPercent: number | null; averagePerDayUgx: number; largest: { category: string; amountUgx: number; occurredOn: string } | null; recurringPatterns: Array<{ category: string; amountUgx: number; count: number; latest: string }> };
type MonthlyExpenseLike = { totalUgx: number | null; warningUgx: number; status: "not_set" | "within_limit" | "reached" | "unavailable" };

function ExpenseMix({ insights, total, formatMoney }: { insights: ExpenseInsightsLike | undefined; total: number | undefined; formatMoney: (amount: number | undefined) => string }) {
  if (total === undefined || !insights) return <EmptyPanel message="Expense mix is unavailable." next="Choose a shorter period if the record limit was reached." />;
  if (total === 0) return <EmptyPanel message="No expenses in this period." next="The operating and equipment split will appear after an expense is recorded." />;
  return <div className="expense-mix-content"><strong className="expense-mix-total">{formatMoney(total)}</strong><div className="expense-mix-track" aria-label={`Operating costs ${insights.operatingPercent} percent; equipment ${insights.equipmentPercent} percent`}><i className="expense-mix-operating" style={{ width: `${insights.operatingPercent}%` }} /><i className="expense-mix-equipment" style={{ width: `${insights.equipmentPercent}%` }} /></div><div className="expense-mix-legend"><span><i className="legend-sales" />Operating <b>{formatMoney(insights.operatingUgx)}</b> · {insights.operatingPercent}%</span><span><i className="legend-equipment" />Equipment <b>{formatMoney(insights.equipmentUgx)}</b> · {insights.equipmentPercent}%</span></div><p className="muted-note">Only entries in the configured Equipment category count as equipment; all other categories are grouped as operating costs.</p></div>;
}

function ExpenseSignals({ categories, largest, bills, monthlyExpense, complete, today, formatMoney, formatDay }: { categories: ExpenseCategoryAmount[] | undefined; largest: ExpenseInsightsLike["largest"]; bills: RecurringBillLike[] | undefined; monthlyExpense: MonthlyExpenseLike | undefined; complete: boolean; today: string; formatMoney: (amount: number | undefined) => string; formatDay: (day: string) => string }) {
  const top = categories?.[0];
  const dueSoon = bills?.filter(bill => bill.nextDueOn >= today && (Date.parse(`${bill.nextDueOn}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000 <= 30).sort((a, b) => a.nextDueOn.localeCompare(b.nextDueOn))[0];
  const monthlyWarningText = monthlyExpense?.status === "unavailable" || !monthlyExpense ? "Monthly total unavailable" : monthlyExpense.status === "not_set" ? "Not set" : `${formatMoney(monthlyExpense.totalUgx ?? undefined)} / ${formatMoney(monthlyExpense.warningUgx)}${monthlyExpense.status === "reached" ? " · reached" : ""}`;
  return <div className="expense-signal-list"><div><span>Next bill due</span><strong>{dueSoon ? `${dueSoon.name} · ${formatDay(dueSoon.nextDueOn)}` : bills ? "No bill due in the next 30 days" : "Bills unavailable for your role"}</strong></div><div><span>Highest-spend category</span><strong>{top ? `${top.category} · ${top.sharePercent}%` : "No expense activity"}</strong></div><div><span>Monthly expense warning</span><strong>{monthlyWarningText}</strong></div><div><span>Summary coverage</span><strong>{complete ? "Complete for selected range" : "Unavailable or still loading"}</strong></div>{largest && <small>Largest listed entry: {formatMoney(largest.amountUgx)} · {largest.category} · {formatDay(largest.occurredOn)}</small>}</div>;
}

type RecurringBillLike = { _id: string; name: string; category: string; amountUgx: number; recurrence: "weekly" | "monthly" | "quarterly" | "yearly"; nextDueOn: string };
function RecurringCosts({ bills, access, today, formatMoney, formatDay }: { bills: RecurringBillLike[] | undefined; access: "ready" | "restricted" | "pending" | undefined; today: string; formatMoney: (amount: number | undefined) => string; formatDay: (day: string) => string }) {
  const recurrenceLabel = { weekly: "every week", monthly: "every month", quarterly: "every 3 months", yearly: "every year" };
  return <div className="expense-recurring-list">{access === "restricted" ? <EmptyPanel message="Bill schedule access is not included in your role." next="Ask a workspace owner to grant Bills view access." /> : access !== "ready" ? <EmptyPanel message="Loading recurring schedules…" next="Saved Bills schedules and next due dates appear here." /> : bills?.length ? bills.slice(0, 4).map(bill => {
    const days = Math.floor((Date.parse(`${bill.nextDueOn}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86_400_000);
    const due = days < 0 ? `Overdue ${Math.abs(days)}d` : days === 0 ? "Due today" : `Due in ${days}d`;
    return <div className="expense-recurring-row" key={bill._id}><span>{bill.name}<small>{bill.category} · {recurrenceLabel[bill.recurrence]}</small></span><strong>{formatMoney(bill.amountUgx)}</strong><small>{formatDay(bill.nextDueOn)} · {due}</small></div>;
  }) : <EmptyPanel message="No active recurring bills." next="Add a schedule on Bills. It updates its next due date after each recorded payment." />}{access === "ready" && <Link className="text-link" href="/bills">Open Bills →</Link>}</div>;
}

function ExpenseAuditPreview({ entries, formatDay }: { entries: ExpenseEntryLike[] | undefined; formatDay: (day: string) => string }) {
  const options = useQuery(api.audits.filterOptions, {});
  const allExpenseIds = useMemo(() => entries?.filter(entry => entry.kind === "expense" && entry._id).map(entry => entry._id!) ?? [], [entries]);
  const expenseIds = allExpenseIds.slice(0, 100);
  const auditArgs = useMemo(() => ({ entityIds: expenseIds }), [expenseIds]);
  const audit = usePaginatedQuery(api.audits.list, options?.access === "ready" && entries ? auditArgs : "skip", { initialNumItems: 20 });
  if (options?.access === "restricted") return <div className="expense-info-panel"><span className="status-chip status-warning">Audit access required</span><p>Your role does not include audit history access.</p><Link className="text-link" href="/audits">Open audit log →</Link></div>;
  if (!entries) return <p className="muted-note">Loading expense entry links…</p>;
  const expenseEvents = audit.results.filter(event => event.entityType === "entry").slice(0, 4);
  return <><div className="expense-audit-list">{expenseEvents.length ? expenseEvents.map(event => <div key={event.id}><i /><span>{event.summary}<small>{event.action.replaceAll(".", " ")} · {event.actorName}</small></span><time>{formatDay(new Date(event.occurredAt).toISOString().slice(0, 10))}</time></div>) : <p className="muted-note">{audit.status === "LoadingFirstPage" ? "Loading audited expense activity…" : "No audited expense changes match the listed records."}</p>}</div>{allExpenseIds.length > 100 && <p className="muted-note">Preview covers the 100 most recent listed expenses. Open the audit log for older records.</p>}<Link className="text-link" href="/audits">Open audit log →</Link></>;
}

function RecurringExpenseSuggestions({ patterns, complete, formatMoney }: { patterns: ExpenseInsightsLike["recurringPatterns"] | undefined; complete: boolean; formatMoney: (amount: number | undefined) => string }) {
  if (!patterns) return <EmptyPanel message="Loading saved expense entries…" next="Suggestions are calculated on the server from posted records." />;
  return <div className="expense-suggestion-list">{patterns.length ? patterns.map(row => <div key={`${row.category}-${row.amountUgx}`}><span className="status-chip status-info">Pattern</span><strong>{row.category} · {formatMoney(row.amountUgx)} × {row.count}</strong><small>Most recent: {row.latest}</small></div>) : <EmptyPanel message="No repeated category and amount pattern found." next="The review uses posted entries for this period; it never creates a bill automatically." />}{patterns.length > 0 && <p className="muted-note">Suggestions use posted records only and need your review before creating a Bills schedule{complete ? "." : "; summary coverage may be incomplete."}</p>}</div>;
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
      const results: Array<{ entryId: Id<"entries">; kind: "sale" | "expense"; amountUgx: number; occurredOn: string; account: "cash" | "mobile_money" | "unallocated"; category: string; note: string; supplierName: string | null; supplierReference: string | null; state: "posted" | "void"; source: "manual" | "import" | "webhook" | "google_form"; createdAt: number; createdBy: Id<"users"> }> = [];
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
    const headers = ["Date", "Type", "Category", "Supplier", "Supplier reference", "Account", `Amount (${currency})`, "Currency", "Status", "Source", "Entry ID", "Created at (UTC)", "Actor ID", "Description"];
    const escape = (value: string) => {
      const spreadsheetSafe = /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
      return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
    };
    const rows = results.map(row => [row.occurredOn, row.kind, row.category, row.supplierName ?? "", row.supplierReference ?? "", accountLabel(row.account), String(row.amountUgx / scale), currency, row.state, row.source, row.entryId, new Date(row.createdAt).toISOString(), row.createdBy, row.note]);
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
  const recordKind = section === "Record and review movements" || section === "Movement tracking status" ? "movement" : section === "Record and review savings activity" || section === "Holdings tracking status" ? "holding" : section === "Record and review loans" || section === "Loan tracking status" ? "loan" : section === "Record and review bills" || section === "Bill tracking status" ? "bill" : null;
  if (recordKind) return <OperationalRecordForm kind={recordKind} currency={currency} scale={scale} businessDay={businessDay} />;
  const settingsWorkflow = screen.settings || screen.title === "Reconcile";
  return <div className="workflow-callout"><span className="workflow-indicator" /><div><strong>{settingsWorkflow ? `${section} is not configured yet` : `${section} is not available yet`}</strong><p className="muted-note">{settingsWorkflow ? "Review the related Finance or Rules settings. This card does not create financial records." : "This workflow is a product roadmap item; it does not yet save records or change account balances."}</p>{settingsWorkflow && <Link href={screen.title === "Reconcile" ? "/settings/rules" : "/settings/finance"} className="text-link">Review related settings →</Link>}</div></div>;
}
