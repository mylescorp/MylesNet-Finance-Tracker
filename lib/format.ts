export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

export function formatBusinessDay(value: string, pattern: DateFormat = "DD/MM/YYYY") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  if (pattern === "YYYY-MM-DD") return `${year}-${month}-${day}`;
  if (pattern === "MM/DD/YYYY") return `${month}/${day}/${year}`;
  return `${day}/${month}/${year}`;
}
