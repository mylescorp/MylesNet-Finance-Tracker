"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function VoucherBatchPanel({ businessId, timezone }: { businessId: Id<"businesses">; timezone: string }) {
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  useEffect(() => {
    const refresh = () => setCurrentTime(Date.now());
    const dayKey = (timestamp: number) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
    const delayToNextDay = (now: number) => {
      let low = now;
      let high = now + 48 * 60 * 60 * 1000;
      const today = dayKey(now);
      while (dayKey(high) === today) high += 24 * 60 * 60 * 1000;
      while (high - low > 1_000) {
        const middle = Math.floor((low + high) / 2);
        if (dayKey(middle) === today) low = middle;
        else high = middle;
      }
      return Math.max(1_000, high - now);
    };
    let timer = 0;
    const scheduleNextDay = () => {
      const now = Date.now();
      timer = window.setTimeout(() => { refresh(); scheduleNextDay(); }, delayToNextDay(now));
    };
    const initial = window.setTimeout(() => { refresh(); scheduleNextDay(); }, 0);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { window.clearTimeout(initial); window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibilityChange); };
  }, [timezone]);
  const { results: batches, status, loadMore } = usePaginatedQuery(api.vouchers.list, { businessId }, { initialNumItems: 30 });
  const businessDay = useQuery(api.vouchers.businessDay, currentTime === null ? "skip" : { businessId, currentTime });
  const createBatch = useMutation(api.vouchers.createBatch);
  const recordEvent = useMutation(api.vouchers.recordEvent);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [faceValue, setFaceValue] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiry, setExpiry] = useState("");
  const [selected, setSelected] = useState<{ batchId: Id<"voucherBatches">; eventType: "redemption" | "void_stock" } | null>(null);
  const [sourceReference, setSourceReference] = useState("");
  const [reason, setReason] = useState("");
  const [eventQuantity, setEventQuantity] = useState("1");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setFeedback("");
    try {
      await createBatch({ businessId, name, description, faceValueUgx: Number(faceValue), issuedQuantity: Number(quantity), expiresOn: expiry || null });
      setName(""); setDescription(""); setFaceValue(""); setQuantity(""); setExpiry("");
      setFeedback("Voucher batch created and added to the audit trail.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not create voucher batch."); }
    finally { setBusy(false); }
  }

  async function submitEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setFeedback("");
    try {
      const result = await recordEvent({ businessId, batchId: selected.batchId, eventType: selected.eventType, sourceReference, quantity: Number(eventQuantity), reason });
      setSelected(null); setSourceReference(""); setReason(""); setEventQuantity("1");
      setFeedback(result.duplicate ? "That source reference was already recorded; no duplicate was added." : "Voucher activity recorded and audited.");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not record voucher activity."); }
    finally { setBusy(false); }
  }

  const selectedBatch = selected ? batches.find(batch => batch._id === selected.batchId) : undefined;
  const selectedBatchExpired = Boolean(selectedBatch?.expiresOn && businessDay && selectedBatch.expiresOn < businessDay);
  const selectedMaximum = selected && selectedBatch ? selected.eventType === "redemption" ? selectedBatchExpired ? 0 : selectedBatch.unredeemedQuantity : selectedBatch.unredeemedQuantity : 0;
  return <section className="card settings-card">
    <div className="card-heading"><div><h2 className="card-title">Voucher batches</h2><p className="card-subtitle">Track issued vouchers, redemptions, stock removals, and expiry. This inventory does not create or change cashbook entries.</p></div></div>
    <form className="form-layout" onSubmit={e => void create(e)}>
      <label className="field"><span>Batch name</span><input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={100} /></label>
      <label className="field"><span>Description (optional)</span><input value={description} onChange={e => setDescription(e.target.value)} maxLength={500} /></label>
      <label className="field"><span>Face value (UGX)</span><input type="number" min="1" step="1" value={faceValue} onChange={e => setFaceValue(e.target.value)} required /></label>
      <label className="field"><span>Vouchers issued</span><input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label>
      <label className="field"><span>Expiry date (optional)</span><input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label>
      <div className="form-actions"><button className="button button-accent" disabled={busy}>Create batch</button></div>
    </form>
    {selected && selectedBatch && <form className="form-layout" onSubmit={e => void submitEvent(e)}>
      <h3 className="card-title">{selected.eventType === "redemption" ? "Record redemption" : "Remove vouchers from stock"} · {selectedBatch.name}</h3>
      <label className="field"><span>Stable transaction or adjustment reference</span><input value={sourceReference} onChange={e => setSourceReference(e.target.value)} required maxLength={120} /></label>
      <label className="field"><span>Quantity</span><input type="number" min="1" step="1" max={selectedMaximum} value={eventQuantity} onChange={e => setEventQuantity(e.target.value)} required /></label>
      <label className="field"><span>Reason or note</span><input value={reason} onChange={e => setReason(e.target.value)} minLength={3} maxLength={300} required /></label>
      <div className="form-actions"><button className="button button-accent" disabled={busy || selectedMaximum === 0 || Number(eventQuantity) > selectedMaximum}>Record activity</button><button className="button" type="button" disabled={busy} onClick={() => setSelected(null)}>Cancel</button></div>
    </form>}
    {status === "LoadingFirstPage" ? <p className="muted-note">Loading voucher batches…</p> : batches.length === 0 ? <p className="muted-note">No voucher batches have been recorded.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Batch</th><th>Unit value</th><th>Issued</th><th>Redeemed</th><th>Voided</th><th>Unredeemed value</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{batches.map(batch => {
      const expired = Boolean(batch.expiresOn && businessDay && batch.expiresOn < businessDay);
      const remainingQuantity = expired ? 0 : batch.unredeemedQuantity;
      return <tr key={batch._id}>
      <td>{batch.name}{batch.description && <small className="balance-adjustment-reason">{batch.description}</small>}</td><td>UGX {batch.faceValueUgx.toLocaleString()}</td><td>{batch.issuedQuantity}</td><td>{batch.redeemedQuantity}</td><td>{batch.voidedQuantity}</td><td>{expired ? `${batch.unredeemedQuantity} expired · UGX ${batch.unredeemedValueUgx.toLocaleString()}` : `${batch.unredeemedQuantity} · UGX ${batch.unredeemedValueUgx.toLocaleString()}`}</td><td>{batch.expiresOn ?? "—"}</td>
      <td><div className="balance-adjustment-actions"><button type="button" className="button button-small" disabled={busy || expired || remainingQuantity === 0} onClick={() => { setFeedback(""); setSelected({ batchId: batch._id, eventType: "redemption" }); }}>Redeem</button><button type="button" className="button button-small button-danger-quiet" disabled={busy || batch.unredeemedQuantity === 0} onClick={() => { setFeedback(""); setSelected({ batchId: batch._id, eventType: "void_stock" }); }}>Void stock</button></div></td>
    </tr>; })}</tbody></table></div>}
    {status === "CanLoadMore" && <button type="button" className="button" disabled={busy} onClick={() => loadMore(30)}>Load older batches</button>}
    {status === "LoadingMore" && <p className="muted-note" role="status">Loading older batches…</p>}
    {feedback && <p className="form-feedback" role="status">{feedback}</p>}
  </section>;
}
