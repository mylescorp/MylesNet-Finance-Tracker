"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

export type SplitAllocationInput = { amountUgx: number; category: string; account: "cash" | "mobile_money" | "unallocated" };

export function SplitCorrectionDrawer({
  entry, currency, scale, busy, onClose, onSave,
}: {
  entry: { _id: string; amountUgx: number; category: string; note: string; occurredOn: string; account: "cash" | "mobile_money" | "unallocated"; splitAllocations: SplitAllocationInput[] } | null;
  currency: string;
  scale: number;
  busy: boolean;
  onClose: () => void;
  onSave: (allocations: SplitAllocationInput[], reason: string) => Promise<void>;
}) {
  const [rows, setRows] = useState<Array<{ amount: string; category: string; account: "cash" | "mobile_money" | "unallocated" }>>(() => {
    if (!entry) return [];
    return entry.splitAllocations.length ? entry.splitAllocations.map(item => ({ amount: String(item.amountUgx / scale), category: item.category, account: item.account })) : [
      { amount: String(Math.floor(entry.amountUgx / 2) / scale), category: entry.category, account: entry.account },
      { amount: String(Math.ceil(entry.amountUgx / 2) / scale), category: "Other", account: entry.account },
    ];
  });
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const isOpen = entry !== null;
  useEffect(() => {
    if (!isOpen) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      if (!focusable?.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("input")?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };
  }, [isOpen, busy, onClose]);
  if (!entry || typeof document === "undefined") return null;
  const updateRow = (index: number, key: "amount" | "category" | "account", value: string) => setRows(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const allocations = rows.map(row => {
      const scaled = Number(row.amount) * scale;
      const amountUgx = Math.round(scaled);
      return { amountUgx, category: row.category.trim(), account: row.account, valid: Number.isFinite(scaled) && Number.isSafeInteger(amountUgx) && amountUgx > 0 && Math.abs(scaled - amountUgx) < 1e-7 };
    });
    if (allocations.some(item => !item.valid || !item.category || item.category.length > 80)) { setError("Each allocation needs a valid positive amount and category."); return; }
    if (reason.trim().length < 5) { setError("Add a reason of at least 5 characters."); return; }
    await onSave(allocations.map(({ amountUgx, category, account }) => ({ amountUgx, category, account })), reason.trim());
  }
  return createPortal(<div className="record-drawer-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="split-correction-title" aria-describedby="split-correction-description">
      <header className="record-drawer-header"><div><span className="eyebrow">AUDITED CORRECTION</span><h2 id="split-correction-title">Estimate a category split</h2><p id="split-correction-description">This saves a review estimate only. It does not change the cashbook, balances, or reports until you confirm it.</p></div><button className="icon-button" type="button" aria-label="Close split estimate" disabled={busy} onClick={onClose}>×</button></header>
      <div className="record-drawer-content"><div className="settings-facts"><div><span>Original entry</span><strong>{entry.note || entry.category} · {entry.occurredOn}</strong></div><div><span>Amount that must be allocated</span><strong>{new Intl.NumberFormat("en-UG", { maximumFractionDigits: Math.round(Math.log10(scale)) }).format(entry.amountUgx / scale)} {currency}</strong></div></div>
        <form className="split-correction-form" onSubmit={event => void submit(event)}><p className="muted-note">Use two to twenty allocations. Amounts must add up exactly to the original entry. The date stays the same; choose an account for each allocation.</p>
          {rows.map((row, index) => <div className="split-correction-row" key={index}><label>Amount ({currency})<input type="number" min="0" step={1 / scale} value={row.amount} onChange={event => updateRow(index, "amount", event.target.value)} required /></label><label>Category<input value={row.category} maxLength={80} onChange={event => updateRow(index, "category", event.target.value)} required /></label><label>Account<select value={row.account} onChange={event => updateRow(index, "account", event.target.value)}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="unallocated">Unallocated</option></select></label>{rows.length > 2 && <button className="button" type="button" aria-label={`Remove allocation ${index + 1}`} onClick={() => setRows(current => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</button>}</div>)}
          {rows.length < 20 && <button className="button" type="button" onClick={() => setRows(current => [...current, { amount: "", category: "", account: entry.account }])}>Add category</button>}
          <label>Correction reason<textarea minLength={5} maxLength={300} value={reason} onChange={event => setReason(event.target.value)} required /></label>
          {error && <p className="form-feedback" role="alert">{error}</p>}
          <div className="form-actions"><button className="button button-accent" type="submit" disabled={busy}>{busy ? "Saving…" : "Save estimate for review"}</button><button className="button" type="button" disabled={busy} onClick={onClose}>Cancel</button></div>
        </form>
      </div>
    </section>
  </div>, document.body);
}
