import { describe, expect, it } from "vitest";
import { billForecast, type BillForecastInput } from "../lib/bill-forecast";

const monthly = (nextDueOn: string): BillForecastInput => ({ _id: "bill-1", name: "Rent", category: "Rent", amountUgx: 100_000, recurrence: "monthly", nextDueOn, supplierName: null, reminderLeadDays: 3, scheduleAnchorDay: 15, scheduleEndOfMonth: false, paused: false, active: true });

describe("90-day bill forecast", () => {
  it("shows one overdue occurrence and still forecasts future monthly dates", () => {
    expect(billForecast([monthly("2026-10-30")], "2026-10-31").map(row => row.dueOn)).toEqual(["2026-10-30", "2026-11-15", "2026-12-15", "2027-01-15"]);
  });

  it("fast-forwards an old unpaid schedule without losing its future forecast", () => {
    expect(billForecast([monthly("2010-01-15")], "2026-10-31").map(row => row.dueOn)).toEqual(["2026-10-15", "2026-11-15", "2026-12-15", "2027-01-15"]);
  });
});
