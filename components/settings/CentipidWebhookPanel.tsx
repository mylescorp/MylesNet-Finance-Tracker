"use client";

import { useState } from "react";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

function siteBase() {
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!cloud) return "";
  try { const url = new URL(cloud); url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site"); return url.origin; } catch { return ""; }
}

export function CentipidWebhookPanel() {
  const convex = useConvex();
  const settings = useQuery(api.settings.overview, {});
  const status = useQuery(api.centipid.status, settings?.access === "ready" ? { businessId: settings.businessId } : "skip");
  const { results: history, status: historyStatus, loadMore } = usePaginatedQuery(api.centipid.history, settings?.access === "ready" ? { businessId: settings.businessId } : "skip", { initialNumItems: 20 });
  const create = useMutation(api.centipid.createToken);
  const revoke = useMutation(api.centipid.revokeToken);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  function currentBusinessId() { if (settings?.access !== "ready") throw new Error("Workspace is still loading."); return settings.businessId; }
  async function downloadReceiptHistory() {
    setExporting(true); setMessage("");
    try {
      const receiptCsv = await convex.query(api.centipid.exportHistory, { businessId: currentBusinessId() });
      const url = URL.createObjectURL(new Blob([receiptCsv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "centipid-webhook-receipts.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setMessage(error instanceof Error ? `Could not export receipt history: ${error.message}` : "Could not export receipt history."); }
    finally { setExporting(false); }
  }
  async function rotate() {
    setBusy(true); setMessage("");
    try {
      const base = siteBase();
      if (!base) throw new Error("Convex site URL is unavailable. Check NEXT_PUBLIC_CONVEX_URL in the deployment environment.");
      const token = await create({ businessId: currentBusinessId() });
      setWebhookUrl(`${base}/centipid?token=${encodeURIComponent(token)}`);
      setMessage("Token created. Copy this URL into Centipid now; the token is only shown once. The current Apps Script URL stays active until you replace it.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the token."); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setMessage("");
    try { await revoke({ businessId: currentBusinessId() }); setWebhookUrl(""); setMessage("The app’s Centipid token has been revoked. The existing Apps Script webhook remains active until separately disabled there."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke the token."); }
    finally { setBusy(false); }
  }
  return <section className="card settings-card">
    <div className="card-heading"><div><h2 className="card-title">Centipid webhook</h2><p className="card-subtitle">Compatible with the current Apps Script event format for payments, voucher redemptions, and expenses.</p></div></div>
    <p className="muted-note">Status: {status === undefined ? "Loading…" : status.enabled ? "Connected token active" : "Not configured"}. The existing Apps Script URL is not changed. This integration accepts the same <code>?token=</code> and event payload patterns, and returns the same JSON status fields. Test it in Centipid before switching its URL.</p>
    <ul className="settings-bullet-list"><li><strong>payment.received / payment.*:</strong> posts a sale to mobile money and updates the live collection balance.</li><li><strong>voucher.redeemed:</strong> posts a sale to cash and updates the live Centipid voucher total.</li><li><strong>expense.*:</strong> posts an expense using the supplied paid-from hint.</li><li>Balance and daily reconciliation views update automatically. Failed, refund, cancel, expiry, reversal, decline, and pending events are ignored. Duplicate references are idempotent; customer contact details are masked before saving.</li></ul>
    <p className="muted-note">Recent webhook receipts show the event outcome and retry count. A failed event can be retried by the source using the same transaction reference; rejected payloads are not retained, and the public webhook response stays generic.</p>
    <p className="muted-note">Download includes up to 5,000 recent receipts. Raw payloads, transaction references, and customer details are not included.</p>
    <div className="card-heading"><h3 className="card-title">Webhook receipt history</h3><button className="button" type="button" disabled={exporting || settings?.access !== "ready"} onClick={() => void downloadReceiptHistory()}>{exporting ? "Preparing CSV…" : "Download receipt CSV"}</button></div>
    {history.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Event</th><th>Status</th><th>Route</th><th>Attempts</th><th>Last attempt</th><th>Details</th></tr></thead><tbody>{history.map(row => <tr key={row._id}><td>{row.event}</td><td>{row.status === "success" ? "Posted" : row.status === "ignored" ? "Ignored" : "Failed"}</td><td>{row.routed ?? "—"}</td><td>{row.attemptCount ?? 1}</td><td>{new Date(row.lastAttemptAt ?? row.createdAt).toLocaleString()}</td><td>{row.errorMessage ?? (row.status === "ignored" ? "Event type is not posted to the cashbook." : row.entryId ? "Linked cashbook entry" : "Duplicate event reference")}</td></tr>)}</tbody></table>{historyStatus === "CanLoadMore" && <button className="button" type="button" onClick={() => loadMore(20)}>Load older receipts</button>}</div> : <p className="muted-note">{historyStatus === "LoadingFirstPage" ? "Loading webhook receipts…" : "No Centipid events have reached this app yet."}</p>}
    {webhookUrl && <div className="field field-full"><label htmlFor="centipid-hook-url">New Centipid webhook URL · copy before leaving this page</label><div className="copy-row"><input id="centipid-hook-url" readOnly value={webhookUrl} onFocus={e => e.target.select()} /><button className="button" type="button" onClick={() => void navigator.clipboard.writeText(webhookUrl).then(() => setMessage("Webhook URL copied."))}>Copy URL</button></div></div>}
    {message && <p className="muted-note" role="status">{message}</p>}
    <div className="form-actions"><button className="button button-accent" type="button" disabled={busy} onClick={() => void rotate()}>{busy ? "Working…" : status?.enabled ? "Rotate token" : "Create secure webhook URL"}</button>{status?.enabled && <button className="button" type="button" disabled={busy} onClick={() => void disable()}>Revoke app token</button>}</div>
  </section>;
}
