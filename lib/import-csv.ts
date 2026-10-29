export type CsvRow = string[];

export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function sectionIndex(rows: CsvRow[], title: string) { return rows.findIndex(row => row.length === 1 && row[0].trim().toLowerCase() === title.toLowerCase()); }
function isIsoDay(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function amount(value: string) {
  const number = Number(value.replaceAll(",", "").trim());
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(number)) throw new Error(`Invalid whole UGX amount: ${value}`);
  return number;
}

export type ImportRow = { rowNumber: number; kind: "sale" | "expense"; amountUgx: number; occurredOn: string; account: "cash" | "mobile_money" | "unallocated"; category: string; note: string };
export type CentipidReport = { summary: Record<string, string | number>; paymentMethods: Array<{ method: string; amount: number; count: number }>; dailyRevenue: Array<{ date: string; amount: number }>; dailyUsage: Array<{ date: string; bytes: number }>; routers: Array<{ router: string; online: string; revenue: number; sessions: number; bytes: number; subscribers: number }>; usageBytes: number; revenueTotal: number; rows: ImportRow[] };

const monthNumbers: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pastedDate(value: string) {
  const match = /^(\w+)\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(value.trim());
  const month = match ? monthNumbers[match[1].toLowerCase()] : undefined;
  if (!match || !month) return null;
  const day = Number(match[2]); const year = Number(match[3]);
  const hour = Number(match[4]); const minute = Number(match[5]);
  if (day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** Parse tab-separated expense rows copied from a table, including notes that wrap onto their own lines. */
export function parsePlainTextExpenses(text: string, defaultAccount: "cash" | "mobile_money" = "cash"): ImportRow[] {
  const records: Array<{ cells: string[]; line: number }> = [];
  let current: { cells: string[]; line: number } | undefined;
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const firstCell = (line: string) => line.split("\t", 1)[0]?.trim() ?? "";
  const isDateShaped = (line: string) => /^[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4},\s*\d{1,2}:\d{2}\s*(?:AM|PM)$/i.test(firstCell(line));
  const finish = () => { if (current) records.push(current); current = undefined; };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (isDateShaped(line)) {
      if (!pastedDate(firstCell(line))) throw new Error(`Line ${index + 1}: the date and time are not recognized.`);
      finish();
      current = { cells: line.split("\t"), line: index + 1 };
      continue;
    }
    if (!current) throw new Error(`Line ${index + 1}: expected a date such as “Oct 27, 2026, 11:42 PM”.`);

    const continuation = line.split("\t");
    const accountName = continuation[0]?.trim().toLowerCase() ?? "";
    const amountText = continuation[1]?.trim() ?? "";
    const isPaymentContinuation = /^(cash|other|m[\s-]?pesa|mpesa|mobile money|airtel|centipid(?: wallet)?)$/i.test(accountName)
      && /^(?:ush|ugx|shs?\.?\s*)?\s*[\d,]+(?:\.\d+)?$/i.test(amountText);
    if (isPaymentContinuation && current.cells.length < 5) current.cells.push(...continuation);
    else if (current.cells.length < 5 && continuation.length >= 3
      && /^(cash|other|m[\s-]?pesa|mpesa|mobile money|airtel|centipid(?: wallet)?)$/i.test(continuation[1]?.trim() ?? "")
      && /^(?:ush|ugx|shs?\.?\s*)?\s*[\d,]+(?:\.\d+)?$/i.test(continuation[2]?.trim() ?? "")) {
      current.cells[2] = `${current.cells[2] ?? ""}${current.cells[2] ? "\n" : ""}${continuation[0]}`;
      current.cells.push(...continuation.slice(1));
    }
    else {
      current.cells[2] = `${current.cells[2] ?? ""}${current.cells[2] ? "\n" : ""}${line}`;
    }
  }
  finish();
  if (!records.length) throw new Error("Paste at least one dated expense row.");
  if (records.length > 10_000) throw new Error("Paste no more than 10,000 expense rows at a time.");

  return records.map(({ cells, line }, index) => {
    const occurredOn = pastedDate(cells[0] ?? "");
    if (!occurredOn) throw new Error(`Line ${line}: the date and time are not recognized.`);
    const category = (cells[1] ?? "").trim();
    const note = (cells[2] ?? "").trim();
    const rawAccount = (cells[3] ?? "").trim().toLowerCase();
    const account: "cash" | "mobile_money" = rawAccount === "cash"
      ? "cash"
      : !rawAccount || rawAccount === "other" ? defaultAccount
        : /m[\s-]?pesa|mpesa|mobile|airtel|centipid/.test(rawAccount) ? "mobile_money"
        : (() => { throw new Error(`Line ${line}: account “${cells[3]}” is not recognized. Use Cash, M-Pesa, or Other.`); })();
    const amountText = (cells[4] ?? "").trim().replace(/^(?:ush|ugx|shs?\.?)\s*/i, "");
    let amountUgx: number;
    try { amountUgx = parseAmount(amountText, 1); }
    catch { throw new Error(`Line ${line}: amount “${cells[4] ?? ""}” is not a whole-shilling amount.`); }
    if (!category || category.length > 80) throw new Error(`Line ${line}: category must be 1 to 80 characters.`);
    if (note.length > 300) throw new Error(`Line ${line}: description and receipt must be 300 characters or fewer.`);
    return { rowNumber: index + 1, kind: "expense" as const, amountUgx, occurredOn, account, category, note };
  });
}

export function parseCentipid(rows: CsvRow[]): CentipidReport | null {
  if (rows[0]?.[0]?.trim() !== "Centipid Analytics Report") return null;
  const summaryAt = sectionIndex(rows, "Summary");
  const paymentAt = sectionIndex(rows, "Payment methods");
  const revenueAt = sectionIndex(rows, "Daily revenue");
  const usageAt = sectionIndex(rows, "Daily data usage");
  const routerAt = sectionIndex(rows, "Router breakdown");
  if ([summaryAt, paymentAt, revenueAt, usageAt, routerAt].some(i => i < 0)) throw new Error("Centipid report is missing one of the expected report sections.");
  const summary: Record<string, string | number> = {};
  for (const item of rows.slice(summaryAt + 1, paymentAt).filter(r => r.length >= 2)) {
    const key = item[0].replaceAll('"', "").trim();
    const raw = item[1].trim();
    summary[key] = raw === "" ? "" : Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  if (rows[paymentAt + 1]?.map(x => x.toLowerCase()).join(",") !== "method,amount,count") throw new Error("Payment methods section has an unexpected header.");
  const paymentMethods = rows.slice(paymentAt + 2, revenueAt).filter(r => r.length >= 3).map(r => ({ method: r[0].trim(), amount: amount(r[1]), count: amount(r[2]) }));
  if (rows[revenueAt + 1]?.map(x => x.toLowerCase()).join(",") !== "date,amount") throw new Error("Daily revenue section has an unexpected header.");
  const revenueRows = rows.slice(revenueAt + 2, usageAt).filter(r => r.length >= 2);
  const dailyRevenue: Array<{ date: string; amount: number }> = [];
  const reportRows: ImportRow[] = revenueRows.map((r, index) => {
    const occurredOn = r[0].trim();
    if (!isIsoDay(occurredOn)) throw new Error(`Invalid date in daily revenue row ${index + 1}.`);
    const value = amount(r[1]);
    dailyRevenue.push({ date: occurredOn, amount: value });
    return { rowNumber: index + 1, kind: "sale" as const, amountUgx: value, occurredOn, account: "unallocated" as const, category: "Centipid revenue", note: "Imported daily total; payment account not specified" };
  }).filter(r => r.amountUgx > 0);
  if (rows[usageAt + 1]?.map(x => x.toLowerCase()).join(",") !== "date,bytes") throw new Error("Daily data usage section has an unexpected header.");
  const usageRows = rows.slice(usageAt + 2, routerAt).filter(r => r.length >= 2);
  let usageBytes = 0;
  const dailyUsage = usageRows.map(r => { if (!isIsoDay(r[0].trim())) throw new Error("Invalid date in data usage section."); const bytes = amount(r[1]); usageBytes += bytes; return { date: r[0].trim(), bytes }; });
  if (rows[routerAt + 1]?.map(x => x.toLowerCase()).join(",") !== "router,online,revenue,sessions,bytes,subscribers") throw new Error("Router breakdown section has an unexpected header.");
  const routers = rows.slice(routerAt + 2).filter(r => r.length >= 6).map(r => ({ router: r[0].trim(), online: r[1].trim(), revenue: amount(r[2]), sessions: amount(r[3]), bytes: amount(r[4]), subscribers: amount(r[5]) }));
  const revenueTotal = reportRows.reduce((sum, r) => sum + r.amountUgx, 0);
  if (summary.Revenue === undefined || String(summary.Revenue).trim() === "") throw new Error("The report summary is missing Revenue.");
  const summaryRevenue = amount(String(summary.Revenue));
  const methodRevenue = paymentMethods.reduce((sum, method) => sum + method.amount, 0);
  if (summaryRevenue !== revenueTotal) throw new Error(`Daily revenue total (${revenueTotal.toLocaleString()}) does not match the report summary (${summaryRevenue.toLocaleString()}).`);
  if (methodRevenue !== revenueTotal) throw new Error(`Payment-method total (${methodRevenue.toLocaleString()}) does not match daily revenue (${revenueTotal.toLocaleString()}).`);
  return { summary, paymentMethods, dailyRevenue, dailyUsage, routers, usageBytes, revenueTotal, rows: reportRows };
}

export function toIsoDay(value: string): string {
  const input = value.trim();
  if (isIsoDay(input)) return input;
  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(input);
  if (match) {
    const day = match[1].padStart(2, "0"); const month = match[2].padStart(2, "0"); const iso = `${match[3]}-${month}-${day}`;
    if (isIsoDay(iso)) return iso;
  }
  throw new Error(`Unsupported date: ${input}. Use YYYY-MM-DD or DD/MM/YYYY.`);
}

export function parseAmount(value: string, scale: number) {
  const number = Number(value.replaceAll(",", "").trim());
  const minor = Math.round(number * scale);
  if (!Number.isFinite(number) || number <= 0 || !Number.isSafeInteger(minor) || Math.abs(minor / scale - number) > 0.000001) throw new Error(`Invalid amount: ${value}`);
  return minor;
}
