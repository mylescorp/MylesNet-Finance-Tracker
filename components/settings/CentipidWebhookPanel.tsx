"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

function siteBase() {
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!cloud) return "";
  try { const url = new URL(cloud); url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site"); return url.origin; } catch { return ""; }
}

export function CentipidWebhookPanel() {
  const status = useQuery(api.centipid.status, {});
  const create = useMutation(api.centipid.createToken);
  const revoke = useMutation(api.centipid.revokeToken);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function rotate() {
    setBusy(true); setMessage("");
    try {
      const base = siteBase();
      if (!base) throw new Error("Convex site URL is unavailable. Check NEXT_PUBLIC_CONVEX_URL in the deployment environment.");
      const token = await create({});
      setWebhookUrl(`${base}/centipid?token=${encodeURIComponent(token)}`);
      setMessage("Token created. Copy this URL into Centipid now; the token is only shown once. The current Apps Script URL stays active until you replace it.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the token."); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setMessage("");
    try { await revoke({}); setWebhookUrl(""); setMessage("The app’s Centipid token has been revoked. The existing Apps Script webhook remains active until separately disabled there."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke the token."); }
    finally { setBusy(false); }
  }
  return <section className="card settings-card">
    <div className="card-heading"><div><h2 className="card-title">Centipid webhook</h2><p className="card-subtitle">Compatible with the current Apps Script event format for payments, voucher redemptions, and expenses.</p></div></div>
    <p className="muted-note">Status: {status === undefined ? "Loading…" : status.enabled ? "Connected token active" : "Not configured"}. The existing Apps Script URL is not changed. This integration accepts the same <code>?token=</code> and event payload patterns, and returns the same JSON status fields. Test it in Centipid before switching its URL.</p>
    <ul className="settings-bullet-list"><li><strong>payment.*:</strong> posts a sale to mobile money.</li><li><strong>voucher.redeemed:</strong> posts a sale to cash.</li><li><strong>expense.*:</strong> posts an expense using the supplied paid-from hint.</li><li>Failed, refund, cancel, expiry, reversal, decline, and pending events are ignored. Duplicate references are idempotent; customer contact details are masked before saving.</li></ul>
    {webhookUrl && <div className="field field-full"><label htmlFor="centipid-hook-url">New Centipid webhook URL · copy before leaving this page</label><div className="copy-row"><input id="centipid-hook-url" readOnly value={webhookUrl} onFocus={e => e.target.select()} /><button className="button" type="button" onClick={() => void navigator.clipboard.writeText(webhookUrl).then(() => setMessage("Webhook URL copied."))}>Copy URL</button></div></div>}
    {message && <p className="muted-note" role="status">{message}</p>}
    <div className="form-actions"><button className="button button-accent" type="button" disabled={busy} onClick={() => void rotate()}>{busy ? "Working…" : status?.enabled ? "Rotate token" : "Create secure webhook URL"}</button>{status?.enabled && <button className="button" type="button" disabled={busy} onClick={() => void disable()}>Revoke app token</button>}</div>
  </section>;
}
