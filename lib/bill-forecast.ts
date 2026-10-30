export type BillRecurrence = "weekly" | "monthly" | "quarterly" | "yearly";
export type BillForecastInput = {
  _id: string;
  name: string;
  category: string;
  amountUgx: number;
  recurrence: BillRecurrence;
  nextDueOn: string;
  supplierName: string | null;
  reminderLeadDays: number;
  scheduleAnchorDay: number;
  scheduleEndOfMonth: boolean;
  paused: boolean;
  active: boolean;
};

export function billOccurrenceAt(day: string, recurrence: BillRecurrence, anchorDay: number, endOfMonth: boolean, occurrenceIndex: number) {
  if (occurrenceIndex === 0) return day;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7 * occurrenceIndex);
  else {
    const months = recurrence === "monthly" ? 1 : recurrence === "quarterly" ? 3 : 12;
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months * occurrenceIndex);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(endOfMonth ? lastDay : Math.min(anchorDay, lastDay));
  }
  return date.toISOString().slice(0, 10);
}

export function nextBillOccurrence(day: string, recurrence: BillRecurrence, anchorDay: number, endOfMonth: boolean) {
  return billOccurrenceAt(day, recurrence, anchorDay, endOfMonth, 1);
}

function firstIndexOnOrAfter(day: string, today: string, recurrence: BillRecurrence) {
  if (recurrence === "weekly") {
    const overdueDays = Math.floor((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${day}T00:00:00.000Z`)) / 86_400_000);
    return Math.max(0, Math.floor(overdueDays / 7));
  }
  const dayDate = new Date(`${day}T00:00:00.000Z`);
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const monthDelta = (todayDate.getUTCFullYear() - dayDate.getUTCFullYear()) * 12 + todayDate.getUTCMonth() - dayDate.getUTCMonth();
  const interval = recurrence === "monthly" ? 1 : recurrence === "quarterly" ? 3 : 12;
  return Math.max(0, Math.floor(monthDelta / interval));
}

export function billForecast(rows: BillForecastInput[], today: string) {
  const horizon = new Date(`${today}T00:00:00.000Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 90);
  const end = horizon.toISOString().slice(0, 10);
  return rows.filter(row => row.active && !row.paused).flatMap(row => {
    const dates: string[] = [];
    let index = row.nextDueOn < today ? firstIndexOnOrAfter(row.nextDueOn, today, row.recurrence) : 0;
    let dueOn = billOccurrenceAt(row.nextDueOn, row.recurrence, row.scheduleAnchorDay, row.scheduleEndOfMonth, index);
    while (dueOn < today) {
      index++;
      dueOn = billOccurrenceAt(row.nextDueOn, row.recurrence, row.scheduleAnchorDay, row.scheduleEndOfMonth, index);
    }
    if (index > 0) dates.push(billOccurrenceAt(row.nextDueOn, row.recurrence, row.scheduleAnchorDay, row.scheduleEndOfMonth, index - 1));
    for (let count = 0; dueOn < end && count < 100; count++) {
      dates.push(dueOn);
      index++;
      const next = billOccurrenceAt(row.nextDueOn, row.recurrence, row.scheduleAnchorDay, row.scheduleEndOfMonth, index);
      if (next <= dueOn) break;
      dueOn = next;
    }
    return dates.map(dueOn => ({ billId: row._id, name: row.name, category: row.category, amountUgx: row.amountUgx, supplierName: row.supplierName, dueOn }));
  }).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.name.localeCompare(b.name));
}
