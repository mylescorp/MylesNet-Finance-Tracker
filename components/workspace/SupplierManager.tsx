"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function SupplierManager({ currency, scale, locale }: { currency: string; scale: number; locale: string }) {
  const [search, setSearch] = useState("");
  const directory = useQuery(api.suppliers.directory, { search: search.trim() || undefined });
  const saveSupplier = useMutation(api.suppliers.save);
  const [editingId, setEditingId] = useState<Id<"suppliers"> | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<Id<"suppliers"> | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const history = useQuery(api.suppliers.expenseHistory, selectedHistoryId ? { supplierId: selectedHistoryId } : "skip");
  const formatter = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: Math.round(Math.log10(scale)) });

  function edit(id?: Id<"suppliers">) {
    const row = directory?.access === "ready" ? directory.suppliers.find(item => item._id === id) : undefined;
    setEditingId(row?._id ?? null); setName(row?.name ?? ""); setPhone(row?.phone ?? ""); setEmail(row?.email ?? ""); setNote(row?.note ?? ""); setFeedback("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setFeedback("");
    try {
      const wasEdit = Boolean(editingId);
      await saveSupplier({ action: editingId ? "edit" : "create", ...(editingId ? { supplierId: editingId } : {}), name, phone, email, note });
      setEditingId(null); setName(""); setPhone(""); setEmail(""); setNote("");
      setFeedback(wasEdit ? "Supplier details updated." : "Supplier added.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not save the supplier."); }
    finally { setBusy(false); }
  }

  async function changeState(id: Id<"suppliers">, active: boolean) {
    const row = directory?.access === "ready" ? directory.suppliers.find(item => item._id === id) : undefined;
    if (!row || !window.confirm(`${active ? "Restore" : "Archive"} ${row.name}? Existing expenses will keep their supplier history.`)) return;
    setBusy(true); setFeedback("");
    try { await saveSupplier({ action: active ? "restore" : "archive", supplierId: id, name: row.name }); setFeedback(`Supplier ${active ? "restored" : "archived"}.`); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Could not update the supplier."); }
    finally { setBusy(false); }
  }

  if (directory === undefined) return <div className="empty-state compact-empty" role="status"><strong>Loading suppliers…</strong><span>Supplier records are scoped to this workspace.</span></div>;
  if (directory.access !== "ready") return <div className="empty-state compact-empty"><strong>Supplier access is restricted.</strong><span>Your role needs Expenses view access to review suppliers.</span></div>;

  return <div className="supplier-manager">
    <p className="muted-note">Expense-linked history reports posted spend only. The cashbook does not capture line items or quantities, so these totals are not per-item prices.</p>
    {feedback && <p className="form-feedback" role="status">{feedback}</p>}
    {(directory.canCreate || (directory.canManage && Boolean(editingId))) && <form className="form-layout supplier-editor" onSubmit={event => void submit(event)}>
      <div className="field"><label htmlFor="supplier-name">Supplier name</label><input id="supplier-name" value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={100} required /></div>
      <div className="field"><label htmlFor="supplier-phone">Phone <span className="muted-note">(optional)</span></label><input id="supplier-phone" value={phone} onChange={event => setPhone(event.target.value)} maxLength={40} /></div>
      <div className="field"><label htmlFor="supplier-email">Email <span className="muted-note">(optional)</span></label><input id="supplier-email" type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={120} /></div>
      <div className="field field-full"><label htmlFor="supplier-note">Note <span className="muted-note">(optional)</span></label><textarea id="supplier-note" value={note} onChange={event => setNote(event.target.value)} maxLength={300} rows={2} /></div>
      <div className="form-actions"><button className="button button-accent" disabled={busy}>{busy ? "Saving…" : editingId ? "Save supplier" : "Add supplier"}</button>{editingId && <button className="button" type="button" disabled={busy} onClick={() => edit()}>Cancel</button>}</div>
    </form>}
    <div className="field supplier-search-field"><label htmlFor="supplier-search">Find supplier</label><input id="supplier-search" type="search" maxLength={100} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search supplier names" /></div>
    {!directory.complete && <p className="notice-banner notice-info" role="status">Showing the first 500 suppliers. Contact an owner before relying on a truncated directory.</p>}
    {directory.suppliers.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Supplier</th><th>Contact</th><th>State</th><th>History</th><th>Actions</th></tr></thead><tbody>{directory.suppliers.map(row => <tr key={row._id}>
      <td>{row.name}{row.note && <small className="muted-note">{row.note}</small>}</td><td>{[row.phone, row.email].filter(Boolean).join(" · ") || "—"}</td><td>{row.active ? "Active" : "Archived"}</td><td><button className="button" type="button" onClick={() => setSelectedHistoryId(row._id)} aria-expanded={selectedHistoryId === row._id}>Review spend</button></td><td><div className="form-actions">{row.active && directory.canManage && <button className="button" type="button" onClick={() => edit(row._id)}>Edit</button>}{directory.canManage && <button className="button" type="button" disabled={busy} onClick={() => void changeState(row._id, !row.active)}>{row.active ? "Archive" : "Restore"}</button>}</div></td>
    </tr>)}</tbody></table></div> : <div className="empty-state compact-empty"><strong>No suppliers recorded.</strong><span>Add a supplier here or record an expense without one.</span></div>}
    {selectedHistoryId && <section className="supplier-history" aria-live="polite"><div className="card-heading"><div><h3 className="card-title">Posted expense history · {directory.suppliers.find(row => row._id === selectedHistoryId)?.name}</h3><p className="card-subtitle">Linked records are limited to the latest 500 and do not include unpaid obligations.</p></div><button className="button" type="button" onClick={() => setSelectedHistoryId(null)}>Close</button></div>{history === undefined ? <p className="muted-note">Loading supplier-linked expenses…</p> : history.access !== "ready" ? <p className="muted-note">Supplier history is restricted.</p> : <><p className="muted-note">Recorded posted spend: {formatter.format(history.totalUgx / scale)}{!history.complete && " · partial history; more than 500 linked records"}</p>{history.expenses.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Category</th><th>Amount</th><th>Supplier reference</th></tr></thead><tbody>{history.expenses.map(row => <tr key={row.entryId}><td>{row.occurredOn}</td><td>{row.category}</td><td>{formatter.format(row.amountUgx / scale)}</td><td>{row.reference ?? "—"}</td></tr>)}</tbody></table></div> : <p className="muted-note">No posted expense is linked to this supplier yet.</p>}</>}</section>}
  </div>;
}
