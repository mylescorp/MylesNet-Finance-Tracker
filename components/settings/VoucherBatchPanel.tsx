"use client";

import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function VoucherBatchPanel({ businessId }: { businessId: Id<"businesses"> }) {
  const batches = useQuery(api.vouchers.list, { businessId });
  const createBatch = useMutation(api.vouchers.createBatch);
  const recordEvent = useMutation(api.vouchers.recordEvent);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [faceValue, setFaceValue] = useState("");
  const [quantity, setQuantity] = useState("");
  const [expiry, setExpiry] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback("");
    try { await createBatch({ businessId, name, description, faceValueUgx: Number(faceValue), issuedQuantity: Number(quantity), expiresOn: expiry || null }); setName(""); setDescription(""); setFaceValue(""); setQuantity(""); setExpiry(""); setFeedback("Voucher batch created and added to the audit trail."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Could not create voucher batch."); }
    finally { setBusy(false); }
  }
  async function eventFor(batchId: Id<"voucherBatches">, eventType: "redemption" | "void_stock") {
    const sourceReference = window.prompt("Enter a stable transaction or adjustment reference:");
    if (!sourceReference) return;
    const reason = window.prompt(eventType === "redemption" ? "Add a short redemption note:" : "Why are these vouchers being removed from stock:");
    if (!reason) return;
    const amount = window.prompt("How many vouchers?");
    const eventQuantity = Number(amount);
    if (!Number.isSafeInteger(eventQuantity) || eventQuantity <= 0) { setFeedback("Quantity must be a positive whole number."); return; }
    setBusy(true); setFeedback("");
    try { const result = await recordEvent({ businessId, batchId, eventType, sourceReference, quantity: eventQuantity, reason }); setFeedback(result.duplicate ? "That source reference was already recorded; no duplicate was added." : "Voucher activity recorded and audited."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Could not record voucher activity."); }
    finally { setBusy(false); }
  }
  return <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Voucher batches</h2><p className="card-subtitle">Track issued vouchers, redemptions, stock removals, and expiry. This inventory does not create or change cashbook entries.</p></div></div>
    <form className="form-layout" onSubmit={e => void create(e)}><label className="field"><span>Batch name</span><input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={100} /></label><label className="field"><span>Description (optional)</span><input value={description} onChange={e => setDescription(e.target.value)} maxLength={500} /></label><label className="field"><span>Face value (UGX)</span><input type="number" min="1" step="1" value={faceValue} onChange={e => setFaceValue(e.target.value)} required /></label><label className="field"><span>Vouchers issued</span><input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required /></label><label className="field"><span>Expiry date (optional)</span><input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></label><div className="form-actions"><button className="button button-accent" disabled={busy}>Create batch</button></div></form>
    {batches === undefined ? <p className="muted-note">Loading voucher batches…</p> : batches.length === 0 ? <p className="muted-note">No voucher batches have been recorded.</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Batch</th><th>Value</th><th>Issued</th><th>Redeemed</th><th>Voided</th><th>Available</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{batches.map(batch => { const expired = Boolean(batch.expiresOn && batch.expiresOn < new Date().toISOString().slice(0, 10)); const unredeemed = batch.issuedQuantity - batch.redeemedQuantity - batch.voidedQuantity; const available = expired ? 0 : unredeemed; return <tr key={batch._id}><td>{batch.name}{batch.description && <small className="balance-adjustment-reason">{batch.description}</small>}</td><td>UGX {batch.faceValueUgx.toLocaleString()}</td><td>{batch.issuedQuantity}</td><td>{batch.redeemedQuantity}</td><td>{batch.voidedQuantity}</td><td>{expired ? `${unredeemed} expired` : `${available} · UGX ${(available * batch.faceValueUgx).toLocaleString()}`}</td><td>{batch.expiresOn ?? "—"}</td><td><div className="balance-adjustment-actions"><button type="button" className="button button-small" disabled={busy || expired || available === 0} onClick={() => void eventFor(batch._id, "redemption")}>Redeem</button><button type="button" className="button button-small button-danger-quiet" disabled={busy || available === 0} onClick={() => void eventFor(batch._id, "void_stock")}>Void stock</button></div></td></tr>; })}</tbody></table></div>}
    {feedback && <p className="form-feedback" role="status">{feedback}</p>}
  </section>;
}
