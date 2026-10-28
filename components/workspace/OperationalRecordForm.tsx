"use client";

import { useMutation, useQuery } from "convex/react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";
import { RecordFormDisclosure } from "@/components/workspace/RecordFormDisclosure";
import { useRecordEntryBusy, useRecordEntrySaved } from "@/components/workspace/RecordEntryDrawer";

type RecordKind = "movement" | "holding" | "loan" | "bill";

export function OperationalRecordForm({ kind, currency, scale = 1, businessDay }: { kind: RecordKind; currency: string; scale?: number; businessDay: string }) {
  const recordSaved = useRecordEntrySaved();
  const setDrawerBusy = useRecordEntryBusy();
  const save = useMutation(api.workspace.createOperationalRecord);
  const access = useQuery(api.workspace.currentAccess, {});
  const records = useQuery(api.workspace.operationalRecords, { kind });
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [dateEdited, setDateEdited] = useState(false);
  const businessDate = dateEdited ? occurredOn : businessDay;
  const [account, setAccount] = useState<"cash" | "mobile_money">("cash");
  const [destinationAccount, setDestinationAccount] = useState<"cash" | "mobile_money">("mobile_money");
  const [movementType, setMovementType] = useState<"transfer" | "withdrawal">("transfer");
  const [cadence, setCadence] = useState<"weekly" | "monthly" | "quarterly" | "annually">("monthly");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const requestKey = useRef<string | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const titleFor = { movement: "Record movement", holding: "Add holding", loan: "Add loan", bill: "Add bill" }[kind];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setFeedback(null);
    setDrawerBusy(true);
    try {
      const scaledAmount = Number(amount) * scale;
      const roundedAmount = Math.round(scaledAmount);
      if (!Number.isSafeInteger(roundedAmount) || roundedAmount <= 0 || Math.abs(scaledAmount - roundedAmount) > 1e-7) throw new Error("Enter an amount using the selected currency’s supported decimal places.");
      requestKey.current ??= crypto.randomUUID();
      if (access?.access !== "ready") throw new Error("Workspace is still loading.");
      await save({ businessId: access.businessId, kind, title, amountUgx: roundedAmount, occurredOn: businessDate, account: kind === "movement" ? account : undefined, destinationAccount: kind === "movement" && movementType === "transfer" ? destinationAccount : undefined, movementType: kind === "movement" ? movementType : undefined, cadence: kind === "bill" ? cadence : undefined, note, idempotencyKey: requestKey.current });
      requestKey.current = null;
      setTitle(""); setAmount(""); setNote(""); setDateEdited(false); setOccurredOn("");
      setFeedback({ message: `${titleFor} saved.`, error: false });
      recordSaved(`${titleFor} saved.`);
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "Could not save this record.", error: true });
    } finally { setBusy(false); setDrawerBusy(false); }
  }

  return <div className="settings-stack">
    <RecordFormDisclosure title={titleFor} description="Open this form to add a record.">
    <form className="form-layout" onSubmit={event => void submit(event)}>
      <label className="field"><span>{kind === "holding" ? "Holding name" : kind === "loan" ? "Lender or loan name" : kind === "bill" ? "Bill name" : "Movement description"}</span><input value={title} onChange={event => { requestKey.current = null; setTitle(event.target.value); }} minLength={2} maxLength={100} required /></label>
      <label className="field"><span>{kind === "holding" ? "Current value" : kind === "loan" ? "Principal amount" : "Amount"} ({currency})</span><input type="number" min="0" step={1 / scale} value={amount} onChange={event => { requestKey.current = null; setAmount(event.target.value); }} required /></label>
      <label className="field"><span>{kind === "bill" ? "Next due date" : "Business date"}</span><input type="date" value={businessDate} onChange={event => { requestKey.current = null; setDateEdited(true); setOccurredOn(event.target.value); }} required /></label>
      {kind === "movement" && <>
        <label className="field"><span>Movement type</span><select value={movementType} onChange={event => { requestKey.current = null; setMovementType(event.target.value as typeof movementType); }}><option value="transfer">Transfer between accounts</option><option value="withdrawal">Withdrawal from account</option></select></label>
        <label className="field"><span>{movementType === "transfer" ? "From account" : "Account"}</span><select value={account} onChange={event => { requestKey.current = null; setAccount(event.target.value as typeof account); }}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label>
        {movementType === "transfer" && <label className="field"><span>To account</span><select value={destinationAccount} onChange={event => { requestKey.current = null; setDestinationAccount(event.target.value as typeof destinationAccount); }}><option value="cash">Cash</option><option value="mobile_money">Mobile money</option></select></label>}
      </>}
      {kind === "bill" && <label className="field"><span>Recurrence</span><select value={cadence} onChange={event => { requestKey.current = null; setCadence(event.target.value as typeof cadence); }}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annually">Annually</option></select></label>}
      <label className="field field-full"><span>Note (optional)</span><textarea rows={2} maxLength={300} value={note} onChange={event => { requestKey.current = null; setNote(event.target.value); }} /></label>
      <div className="form-actions"><button className="button button-accent" disabled={busy}>{busy ? "Saving…" : titleFor}</button>{feedback && <span className={`form-feedback ${feedback.error ? "form-error" : "form-success"}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</span>}</div>
    </form>
    </RecordFormDisclosure>
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Details</th></tr></thead><tbody>{records?.map(record => <tr key={record._id}><td>{record.occurredOn}</td><td>{record.title}</td><td>{new Intl.NumberFormat("en", { maximumFractionDigits: Math.round(Math.log10(scale)) }).format(record.amountUgx / scale)} {currency}</td><td>{kind === "movement" ? `${record.movementType} · ${record.account === "cash" ? "Cash" : "Mobile money"}${record.destinationAccount ? ` → ${record.destinationAccount === "cash" ? "Cash" : "Mobile money"}` : ""}` : kind === "bill" ? `${record.cadence} · next due` : record.note || kind}</td></tr>)}</tbody></table>{records?.length === 0 && <p className="muted-note">No {kind} records yet.</p>}{records === undefined && <p className="muted-note">Loading records…</p>}</div>
    {kind === "movement" && <p className="muted-note">Transfers and withdrawals update account balances, but do not count as sales or expenses.</p>}
    {kind !== "movement" && <p className="muted-note">This operational record is tracked separately and does not post income, expense, or cashbook balance changes.</p>}
  </div>;
}
