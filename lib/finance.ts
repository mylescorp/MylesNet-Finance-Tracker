export function accountLabel(account: "cash" | "mobile_money" | "unallocated") {
  return account === "cash" ? "Cash" : account === "mobile_money" ? "Mobile money" : "Unallocated · Centipid";
}
