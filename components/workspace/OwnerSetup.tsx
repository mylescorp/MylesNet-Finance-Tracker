"use client";

import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";

export function OwnerSetup() {
  const claimFirstOwner = useMutation(api.workspace.claimFirstOwner);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(null);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await claimFirstOwner({ businessName: String(values.get("businessName")), setupCode: String(values.get("setupCode")) });
      form.reset();
      setMessage({ text: "Workspace created. Your owner access is ready.", error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Workspace setup failed.", error: true });
    } finally { setBusy(false); }
  }
  return <form className="form-layout" onSubmit={submit}>
    <div className="field field-full"><label htmlFor="owner-business-name">Business or workspace name</label><input id="owner-business-name" name="businessName" minLength={2} maxLength={100} autoComplete="organization" required /></div>
    <div className="field field-full"><label htmlFor="owner-setup-code">One-time owner setup code</label><input id="owner-setup-code" name="setupCode" type="password" minLength={32} autoComplete="off" required /><span className="muted-note">An administrator must set OWNER_SETUP_CODE in the Convex deployment environment before the first owner can claim the workspace.</span></div>
    <div className="form-actions"><button className="button button-accent" type="submit" disabled={busy}>{busy ? "Setting up…" : "Set up workspace"}</button>{message && <span className={`form-feedback ${message.error ? "form-error" : "form-success"}`} role="status">{message.text}</span>}</div>
  </form>;
}
