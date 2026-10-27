"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { parseAmount, parseCentipid, parseCsv, toIsoDay, type CsvRow, type ImportRow } from "@/lib/import-csv";

type Mapping = { date: number; amount: number; category: number; note: number; account: number; kind: number };
const emptyMapping: Mapping = { date: -1, amount: -1, category: -1, note: -1, account: -1, kind: -1 };

export function CsvImportPanel() {
  const settings = useQuery(api.settings.overview, {});
  const history = useQuery(api.imports.history, {});
  const importRows = useMutation(api.imports.importRows);
  const beginBatch = useMutation(api.imports.beginBatch);
  const completeBatch = useMutation(api.imports.completeBatch);
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [kind, setKind] = useState<"sale" | "expense">("expense");
  const [defaultAccount, setDefaultAccount] = useState<"cash" | "mobile_money">("cash");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reportBatchId, setReportBatchId] = useState<Id<"importBatches"> | null>(null);
  const reportDetails = useQuery(api.imports.reportDetails, reportBatchId ? { batchId: reportBatchId } : "skip");
  const report = useMemo(() => { try { return csvRows.length ? parseCentipid(csvRows) : null; } catch { return null; } }, [csvRows]);
  const looksCentipid = csvRows[0]?.[0]?.trim() === "Centipid Analytics Report";
  const headers = csvRows[0] ?? [];

  async function chooseFile(file?: File) {
    setError(""); setMessage(""); setCsvRows([]); setFileText(""); setFileName("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 5 * 1024 * 1024) { setError("Choose a CSV file up to 5 MB."); return; }
    try {
      const text = await file.text();
      const rows = parseCsv(text.replace(/^\uFEFF/, ""));
      if (!rows.length || rows.length > 10_001) throw new Error("Use a CSV with a header and no more than 10,000 data rows.");
      setFileName(file.name); setFileText(text); setCsvRows(rows);
      if (rows[0]?.[0]?.trim() !== "Centipid Analytics Report") {
        const h = rows[0].map(x => x.trim().toLowerCase());
        const pick = (names: string[]) => h.findIndex(x => names.includes(x));
        setMapping({ date: pick(["date", "occurred_on", "transaction date"]), amount: pick(["amount", "amount_ugx", "value"]), category: pick(["category", "expense_category", "description"]), note: pick(["note", "memo", "details"]), account: pick(["account", "payment method"]), kind: pick(["kind", "entry_type", "transaction_type"]) });
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read the CSV."); }
  }

  function flatRows(): ImportRow[] {
    if (!settings || settings.access !== "ready") throw new Error("Workspace settings are not ready.");
    const dataRows = csvRows.slice(1).filter(row => row.some(cell => cell.trim()));
    if (mapping.date < 0 || mapping.amount < 0 || mapping.category < 0) throw new Error("Map a date, amount, and category column first.");
    return dataRows.map((row, index) => {
      const value = (col: number) => col >= 0 ? row[col] ?? "" : "";
      let rowKind: "sale" | "expense" = kind;
      if (mapping.kind >= 0) {
        const rawKind = value(mapping.kind).trim().toLowerCase();
        if (["sale", "sales", "income", "revenue"].includes(rawKind)) rowKind = "sale";
        else if (["expense", "expenses", "outflow"].includes(rawKind)) rowKind = "expense";
        else throw new Error(`Row ${index + 2}: unsupported entry kind “${value(mapping.kind)}”. Use sale or expense.`);
      }
      const rawAccount = value(mapping.account).trim().toLowerCase().replaceAll(" ", "_");
      const rowAccount = mapping.account < 0 || !rawAccount ? defaultAccount : /cash/.test(rawAccount) ? "cash" : /mobile|momo|mobilemoney|mpesa|airtel|centipid/.test(rawAccount) ? "mobile_money" : null;
      if (!rowAccount) throw new Error(`Row ${index + 2}: account must be cash or mobile_money.`);
      const amountUgx = parseAmount(value(mapping.amount), 10 ** settings.currencyMinorDigits);
      const category = value(mapping.category).trim();
      const note = value(mapping.note).trim();
      if (!category || category.length > 80) throw new Error(`Row ${index + 2}: category must be 1 to 80 characters.`);
      if (note.length > 300) throw new Error(`Row ${index + 2}: note must be 300 characters or fewer.`);
      return { rowNumber: index + 2, kind: rowKind, amountUgx, occurredOn: toIsoDay(value(mapping.date)), account: rowAccount, category, note };
    });
  }

  async function runImport() {
    setBusy(true); setError(""); setMessage("");
    try {
      if (!settings || settings.access !== "ready") throw new Error("Workspace settings are not ready.");
      const isReport = looksCentipid;
      const parsedReport = isReport ? parseCentipid(csvRows) : null;
      if (parsedReport && settings.currency !== "UGX") throw new Error("This Centipid report contains UGX totals. Change the workspace currency to UGX before importing; currency conversion is not supported.");
      const entries = parsedReport?.rows ?? flatRows();
      if (!entries.length && !parsedReport) throw new Error("There are no importable rows in this file.");
      let reportSummary: string | undefined;
      if (parsedReport) {
        reportSummary = JSON.stringify({ summary: parsedReport.summary, paymentMethods: parsedReport.paymentMethods, dailyRevenue: parsedReport.dailyRevenue, dailyUsage: parsedReport.dailyUsage, routers: parsedReport.routers });
        if (reportSummary.length > 60_000) throw new Error("Centipid report metadata is too large to archive; no rows were imported.");
      }
      const importIdentity: Record<string, unknown> = isReport ? { type: "centipid_analytics" } : { type: "cashbook", mapping, currency: settings?.access === "ready" ? settings.currency : "" };
      if (!isReport && mapping.kind < 0) importIdentity.kind = kind;
      const hasBlankMappedAccount = mapping.account < 0 || csvRows.slice(1).filter(row => row.some(cell => cell.trim())).some(row => !(row[mapping.account]?.trim()));
      if (!isReport && hasBlankMappedAccount) importIdentity.defaultAccount = defaultAccount;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${fileText}\0${JSON.stringify(importIdentity)}`));
      const sourceHash = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
      const batch = await beginBatch({ sourceHash, fileName, importType: isReport ? "centipid_analytics" : "cashbook", currency: settings.currency, totalRows: entries.length, ...(reportSummary ? { reportSummary } : {}) });
      if (batch.status === "completed") {
        setMessage(`This file was already imported: ${batch.importedCount} entries recorded, ${batch.skippedCount} duplicates skipped.`);
        return;
      }
      for (let i = batch.progressRows; i < entries.length; i += 25) {
        const result = await importRows({ batchId: batch.batchId, startRow: i, rows: entries.slice(i, i + 25) });
        setMessage(`Importing ${Math.min(i + 25, entries.length)} of ${entries.length} rows… (${result.imported} new, ${result.skipped} duplicates in this chunk)`);
      }
      await completeBatch({ batchId: batch.batchId });
      setMessage(`Import complete. ${entries.length} ledger rows processed. ${parsedReport ? `Full Centipid report retained: ${parsedReport.paymentMethods.length} payment methods, ${parsedReport.routers.length} routers and ${parsedReport.dailyUsage.length} daily usage values.` : ""}`);
    } catch (e) { setError(e instanceof Error ? e.message : "The import failed."); }
    finally { setBusy(false); }
  }

  function select(label: string, field: keyof Mapping, optional = false) {
    return <label className="field" key={field}><span>{label}</span><select value={mapping[field]} onChange={e => setMapping(current => ({ ...current, [field]: Number(e.target.value) }))}><option value={-1}>{optional ? "Not mapped" : "Choose a column"}</option>{headers.map((header, index) => <option value={index} key={`${header}-${index}`}>{header || `Column ${index + 1}`}</option>)}</select></label>;
  }

  function downloadTemplate() {
    const content = "date,kind,category,account,amount,note\r\n";
    const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "mylesnet-cashbook-import-template.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  return <section className="card settings-card">
    <div className="card-heading"><div><h2 className="card-title">Import CSV data</h2><p className="card-subtitle">Preview, reconcile, then import entries with duplicate protection and an audit record.</p></div></div>
    <div className="form-actions"><label className="field"><span>CSV file · up to 5 MB and 10,000 rows</span><input type="file" accept=".csv,text/csv" onChange={e => void chooseFile(e.target.files?.[0])} /></label><button type="button" className="button" onClick={downloadTemplate}>Download cashbook CSV template</button></div>
    {fileName && <p className="muted-note">Selected: {fileName}</p>}
    {looksCentipid && report && <div className="notice-banner notice-info"><strong>Centipid analytics report detected.</strong> {report.dailyRevenue.length} dated revenue rows totaling {report.revenueTotal.toLocaleString()} UGX; payment-method total {report.paymentMethods.reduce((sum, item) => sum + item.amount, 0).toLocaleString()} UGX; {report.usageBytes.toLocaleString()} bytes across {report.dailyUsage.length} days; {report.routers.length} router rows. Full revenue, payment, usage, router and summary sections are retained as report metadata. Revenue is imported as unallocated, so it does not increase cash or mobile-money balances.</div>}
    {looksCentipid && csvRows.length > 0 && !report && <p className="form-feedback form-error" role="alert">The Centipid report is malformed or its revenue totals do not reconcile. No entries were imported.</p>}
    {fileName && !looksCentipid && <>
      <p className="muted-note">Map the CSV columns. Rows must contain a date, amount and category. Amounts use the workspace currency ({settings?.access === "ready" ? settings.currency : "…"}).</p>
      <div className="form-layout">{select("Date column", "date")}{select("Amount column", "amount")}{select("Category column", "category")}{select("Note column", "note", true)}{select("Account column", "account", true)}{select("Entry kind column", "kind", true)}</div>
      <div className="form-layout">{mapping.kind < 0 && <label className="field"><span>Entry type for all rows</span><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="expense">Expenses</option><option value="sale">Sales</option></select></label>}<label className="field"><span>Default account for blank or unmapped values</span><select value={defaultAccount} onChange={e => setDefaultAccount(e.target.value as typeof defaultAccount)}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label></div>
      <p className="muted-note">Preview: {csvRows.slice(1, 4).map((row, i) => `row ${i + 2}: ${row.slice(0, 4).join(" · ")}`).join(" | ")}</p>
    </>}
    {error && <p className="form-feedback form-error" role="alert">{error}</p>}{message && <p className="form-feedback form-success" role="status">{message}</p>}
    <div className="form-actions"><button type="button" className="button button-accent" disabled={busy || !fileName || !settings || settings.access !== "ready" || (looksCentipid && !report)} onClick={() => void runImport()}>{busy ? "Importing…" : "Import rows"}</button>{settings?.access === "ready" && <span className="muted-note">All amounts are stored as safe integers in {settings.currency}.</span>}</div>
    <div className="card-heading" style={{ marginTop: 18 }}><div><h3 className="card-title">Recent imports</h3><p className="card-subtitle">Up to 20 owner-visible import batches.</p></div></div>
    {!history?.length ? <p className="muted-note">No imports yet.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>File</th><th>Type</th><th>Progress</th><th>Imported</th><th>Skipped</th><th>When</th><th>Report data</th></tr></thead><tbody>{history.map(item => <tr key={item._id}><td>{item.fileName}</td><td>{item.importType === "centipid_analytics" ? "Centipid analytics" : "Cashbook"}</td><td>{item.status === "completed" ? "Completed" : `${item.progressRows} / ${item.totalRows}`}</td><td>{item.importedCount}</td><td>{item.skippedCount}</td><td>{new Date(item.createdAt).toLocaleString()}</td><td>{item.importType === "centipid_analytics" ? <button type="button" className="button" onClick={() => setReportBatchId(current => current === item._id ? null : item._id)}>{reportBatchId === item._id ? "Hide report" : "View report"}</button> : "—"}</td></tr>)}</tbody></table></div>}
    {reportBatchId && <div className="notice-banner notice-info"><strong>Retained Centipid report</strong>{reportDetails === undefined ? <p>Loading report data…</p> : reportDetails ? <pre style={{ maxHeight: 360, overflow: "auto", whiteSpace: "pre-wrap" }}>{JSON.stringify(JSON.parse(reportDetails), null, 2)}</pre> : <p>Report details are not available.</p>}</div>}
  </section>;
}
