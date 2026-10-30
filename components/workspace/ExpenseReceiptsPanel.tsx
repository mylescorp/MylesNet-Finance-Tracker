"use client";

import { useAuthToken } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { downloadExpenseReceipt } from "@/lib/upload-expense-receipt";

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExpenseReceiptsPanel({ currency, locale, scale }: { currency: string; locale: string; scale: number }) {
  const result = useQuery(api.expenseReceipts.listRecent, {});
  const removeReceipt = useMutation(api.expenseReceipts.removeReceipt);
  const token = useAuthToken();
  const [selected, setSelected] = useState<Id<"expenseReceipts"> | null>(null);
  const [content, setContent] = useState<{ access: "restricted" } | { access: "ready"; fileName: string; contentType: string } | null>(null);
  const [objectUrl, setObjectUrl] = useState("");
  const [busyId, setBusyId] = useState<Id<"expenseReceipts"> | null>(null);
  const [feedback, setFeedback] = useState("");
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Math.round(Math.log10(scale)) });

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  async function remove(id: Id<"expenseReceipts">, fileName: string) {
    if (!window.confirm(`Remove receipt ${fileName}? The expense record and its audit history will remain.`)) return;
    setBusyId(id);
    setFeedback("");
    try {
      await removeReceipt({ receiptId: id });
      if (selected === id) { setSelected(null); setObjectUrl(""); }
      setFeedback("Receipt removed. The expense entry was not changed.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not remove this receipt.");
    } finally { setBusyId(null); }
  }

  async function loadReceipt(id: Id<"expenseReceipts">) {
    setSelected(id);
    setObjectUrl("");
    setContent(null);
    try {
      const receipt = await downloadExpenseReceipt({ receiptId: id, token });
      setContent({ access: "ready", fileName: receipt.fileName, contentType: receipt.contentType });
      setObjectUrl(URL.createObjectURL(receipt.blob));
    }
    catch (error) { setContent({ access: "restricted" }); setFeedback(error instanceof Error ? error.message : "Could not open this receipt."); }
  }

  if (result === undefined) return <div className="empty-state compact-empty" role="status"><strong>Loading expense receipts…</strong><span>Receipt links are checked against your workspace access.</span></div>;
  if (result.access !== "ready") return <div className="empty-state compact-empty"><strong>Receipt access is restricted.</strong><span>Your role needs Expenses view access to see attached files.</span></div>;

  return <div className="expense-receipts-panel">
    <p className="muted-note">Files are stored privately and returned only after workspace and Expenses access checks. Each receipt is linked to a saved expense.</p>
    {feedback && <p className="form-feedback" role="status">{feedback}</p>}
    {result.receipts.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Category</th><th>Expense</th><th>Expense state</th><th>Receipt</th><th>Size</th><th>Actions</th></tr></thead><tbody>{result.receipts.map(row => <tr key={row._id}>
      <td>{row.occurredOn}</td><td>{row.category}</td><td>{money.format(row.amountUgx / scale)}</td><td>{row.entryState === "void" ? "Voided · source receipt retained" : "Posted"}</td><td>{row.fileName}</td><td>{formatSize(row.sizeBytes)}</td><td><div className="form-actions"><button className="button" type="button" onClick={() => void loadReceipt(row._id)} aria-expanded={selected === row._id}>{selected === row._id ? content === null ? "Opening…" : "Selected" : "Preview / download"}</button>{row.canRemove && <button className="button" type="button" disabled={busyId === row._id} onClick={() => void remove(row._id, row.fileName)}>{busyId === row._id ? "Removing…" : "Remove"}</button>}</div></td>
    </tr>)}</tbody></table></div> : <div className="empty-state compact-empty"><strong>No receipts attached yet.</strong><span>Add a PDF or image receipt when recording an expense.</span></div>}
    {!result.complete && <p className="notice-banner notice-info" role="status">Showing the latest 100 receipt files. Narrow the list by reviewing newer expenses first.</p>}
    {selected && <div className="expense-receipt-preview" aria-live="polite"><div className="card-heading"><div><h3 className="card-title">Receipt preview</h3><p className="card-subtitle">{result.receipts.find(row => row._id === selected)?.fileName}</p></div><button className="button" type="button" onClick={() => { setSelected(null); setContent(null); setObjectUrl(""); }}>Close</button></div>{content === null ? <p className="muted-note">Opening the file securely…</p> : content.access !== "ready" ? <p className="form-feedback form-error" role="alert">This file is no longer available to your account.</p> : objectUrl ? <div className="form-actions"><a className="button button-accent" href={objectUrl} target="_blank" rel="noreferrer">Open preview</a><a className="button" href={objectUrl} download={content.fileName}>Download receipt</a></div> : <p className="muted-note">Preparing file…</p>}</div>}
  </div>;
}
