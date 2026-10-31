export type CashDenominationCount = { denominationUgx: number; quantity: number };
export type ReconciliationAccount = "cash" | "mobile_money";

export function normalizeCashDenominations(
  counts: CashDenominationCount[] | undefined,
  account: ReconciliationAccount,
  countedBalanceUgx: number,
): CashDenominationCount[] | undefined {
  if (!counts?.length) return undefined;
  if (account !== "cash") throw new Error("Denomination counts can only be attached to a cash reconciliation.");
  if (counts.length > 50) throw new Error("A cash count can include at most 50 denomination rows.");
  const seen = new Set<number>();
  let totalUgx = 0;
  for (const count of counts) {
    if (!Number.isSafeInteger(count.denominationUgx) || count.denominationUgx <= 0 || !Number.isSafeInteger(count.quantity) || count.quantity < 0 || count.quantity > 1_000_000) {
      throw new Error("Each denomination must be a positive supported amount and each quantity a whole number from 0 to 1,000,000.");
    }
    if (seen.has(count.denominationUgx)) throw new Error("Each cash denomination can only be listed once.");
    seen.add(count.denominationUgx);
    const subtotal = count.denominationUgx * count.quantity;
    if (!Number.isSafeInteger(subtotal)) throw new Error("A denomination subtotal is outside the supported amount range.");
    totalUgx += subtotal;
    if (!Number.isSafeInteger(totalUgx)) throw new Error("Cash denomination total is outside the supported amount range.");
  }
  if (totalUgx !== countedBalanceUgx) throw new Error("The cash denomination total must equal the counted balance.");
  const normalized = counts.filter(count => count.quantity > 0).sort((a, b) => a.denominationUgx - b.denominationUgx);
  return normalized.length ? normalized : undefined;
}
