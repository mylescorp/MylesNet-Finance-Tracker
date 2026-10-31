import { describe, expect, it } from "vitest";
import { normalizeCashDenominations } from "./reconciliationUtils";

describe("cash denomination reconciliation", () => {
  it("normalizes valid denomination rows and removes zero-count rows", () => {
    expect(normalizeCashDenominations([
      { denominationUgx: 5000, quantity: 1 },
      { denominationUgx: 1000, quantity: 3 },
      { denominationUgx: 2000, quantity: 0 },
    ], "cash", 8000)).toEqual([
      { denominationUgx: 1000, quantity: 3 },
      { denominationUgx: 5000, quantity: 1 },
    ]);
  });

  it("allows a reconciliation without an optional breakdown", () => {
    expect(normalizeCashDenominations(undefined, "cash", 0)).toBeUndefined();
    expect(normalizeCashDenominations([], "mobile_money", 12000)).toBeUndefined();
    expect(normalizeCashDenominations([{ denominationUgx: 1000, quantity: 0 }], "cash", 0)).toBeUndefined();
  });

  it("requires the denomination sum to equal the counted cash balance", () => {
    expect(() => normalizeCashDenominations([{ denominationUgx: 5000, quantity: 1 }], "cash", 4000))
      .toThrow("The cash denomination total must equal the counted balance.");
  });

  it("rejects denomination counts for mobile money", () => {
    expect(() => normalizeCashDenominations([{ denominationUgx: 5000, quantity: 1 }], "mobile_money", 5000))
      .toThrow("Denomination counts can only be attached to a cash reconciliation.");
  });

  it("rejects repeated denominations and unsafe subtotals", () => {
    expect(() => normalizeCashDenominations([
      { denominationUgx: 5000, quantity: 1 },
      { denominationUgx: 5000, quantity: 1 },
    ], "cash", 10000)).toThrow("Each cash denomination can only be listed once.");
    expect(() => normalizeCashDenominations([
      { denominationUgx: Number.MAX_SAFE_INTEGER, quantity: 2 },
    ], "cash", Number.MAX_SAFE_INTEGER)).toThrow("A denomination subtotal is outside the supported amount range.");
  });
});
