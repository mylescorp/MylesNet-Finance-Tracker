export type FinancePeriod = "daily" | "weekly" | "monthly" | "yearly" | "last-year" | "custom";
export type FinanceAccount = "all" | "cash" | "mobile_money" | "unallocated";
export type FinanceRange = { from: string; toExclusive: string };

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function financePeriodRange(
  period: FinancePeriod,
  today: string,
  weekStartsOn: "monday" | "sunday",
  fiscalStartMonth: number,
  customFrom: string,
  customTo: string,
): FinanceRange {
  const current = new Date(`${today}T00:00:00.000Z`);
  if (period === "custom") {
    const end = new Date(`${customTo}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { from: customFrom, toExclusive: isoDay(end) };
  }

  if (period === "daily") return { from: today, toExclusive: isoDay(new Date(current.getTime() + 86_400_000)) };
  if (period === "weekly") {
    const offset = weekStartsOn === "sunday" ? current.getUTCDay() : (current.getUTCDay() + 6) % 7;
    current.setUTCDate(current.getUTCDate() - offset);
  } else if (period === "monthly") {
    current.setUTCDate(1);
  } else if (period === "yearly") {
    const year = current.getUTCMonth() + 1 < fiscalStartMonth ? current.getUTCFullYear() - 1 : current.getUTCFullYear();
    current.setUTCFullYear(year, fiscalStartMonth - 1, 1);
  } else if (period === "last-year") {
    const year = current.getUTCMonth() + 1 < fiscalStartMonth ? current.getUTCFullYear() - 1 : current.getUTCFullYear();
    current.setUTCFullYear(year - 1, fiscalStartMonth - 1, 1);
    const end = new Date(current);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    return { from: isoDay(current), toExclusive: isoDay(end) };
  }
  return { from: isoDay(current), toExclusive: isoDay(new Date(new Date(`${today}T00:00:00.000Z`).getTime() + 86_400_000)) };
}

export function previousFinanceRange(range: FinanceRange): FinanceRange {
  const duration = (Date.parse(`${range.toExclusive}T00:00:00.000Z`) - Date.parse(`${range.from}T00:00:00.000Z`)) / 86_400_000;
  const from = new Date(`${range.from}T00:00:00.000Z`);
  from.setUTCDate(from.getUTCDate() - duration);
  return { from: isoDay(from), toExclusive: range.from };
}

export function validateFinanceCustomRange(from: string, to: string, today: string) {
  const isIsoDay = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && isoDay(parsed) === value;
  };
  if (!isIsoDay(from) || !isIsoDay(to)) return "Choose both valid dates.";
  if (from > to) return "The end date must be on or after the start date.";
  if (to > today) return "The end date cannot be in the future.";
  if ((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1 > 370) return "Choose a period of 370 days or less.";
  return "";
}
