"use client";

import type { FinanceAccount, FinancePeriod } from "@/lib/finance-period";

const options: { value: FinancePeriod; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "last-year", label: "Last year" },
  { value: "custom", label: "Custom" },
];

export function FinancePeriodFilters({
  period,
  onPeriodChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  account,
  onAccountChange,
  today,
  ariaLabel = "Finance filters",
}: {
  period: FinancePeriod;
  onPeriodChange: (period: FinancePeriod) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  account: FinanceAccount;
  onAccountChange: (account: FinanceAccount) => void;
  today: string;
  ariaLabel?: string;
}) {
  return <section className="finance-filter-bar no-print" aria-label={ariaLabel}>
    <div className="finance-period-tabs" role="group" aria-label="Reporting period">
      {options.map(option => <button key={option.value} type="button" className={`finance-period-tab${period === option.value ? " is-active" : ""}`} aria-pressed={period === option.value} onClick={() => onPeriodChange(option.value)}>{option.label}</button>)}
    </div>
    {period === "custom" && <div className="finance-custom-range">
      <label>From <input type="date" max={today} value={customFrom} onChange={event => onCustomFromChange(event.target.value)} /></label>
      <label>To <input type="date" min={customFrom || undefined} max={today} value={customTo} onChange={event => onCustomToChange(event.target.value)} /></label>
    </div>}
    <label className="finance-account-filter"><span>Account</span><select value={account} onChange={event => onAccountChange(event.target.value as FinanceAccount)} aria-label="Filter by account">
      <option value="all">All accounts</option>
      <option value="cash">Cash</option>
      <option value="mobile_money">Mobile money</option>
      <option value="unallocated">Unallocated</option>
    </select></label>
  </section>;
}
