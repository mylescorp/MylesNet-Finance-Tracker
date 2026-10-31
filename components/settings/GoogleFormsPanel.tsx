"use client";

import { useState } from "react";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function siteBase() {
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!cloud) return "";
  try { const url = new URL(cloud); url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site"); return url.origin; } catch { return ""; }
}

export function GoogleFormsPanel() {
  const convex = useConvex();
  const settings = useQuery(api.settings.overview, {});
  const status = useQuery(api.googleForms.status, settings?.access === "ready" ? { businessId: settings.businessId } : "skip");
  const { results: history, status: historyStatus, loadMore } = usePaginatedQuery(api.googleForms.history, settings?.access === "ready" ? { businessId: settings.businessId } : "skip", { initialNumItems: 20 });
  const create = useMutation(api.googleForms.createToken);
  const revoke = useMutation(api.googleForms.revokeToken);
  const reprocess = useMutation(api.googleForms.reprocessNeedsReview);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [reviewId, setReviewId] = useState<Id<"googleFormReceipts"> | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const reviewDetails = useQuery(api.googleForms.reviewDetails, reviewId && settings?.access === "ready" ? { businessId: settings.businessId, receiptId: reviewId } : "skip");
  const [message, setMessage] = useState("");
  function currentBusinessId() { if (settings?.access !== "ready") throw new Error("Workspace is still loading."); return settings.businessId; }

  async function downloadReceiptHistory() {
    setExporting(true); setMessage("");
    try {
      const receiptCsv = await convex.query(api.googleForms.exportHistory, { businessId: currentBusinessId() });
      const url = URL.createObjectURL(new Blob([receiptCsv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "google-form-submissions.csv"; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setMessage(error instanceof Error ? `Could not export submissions: ${error.message}` : "Could not export submissions."); }
    finally { setExporting(false); }
  }

  async function rotate() {
    setBusy(true); setMessage("");
    try {
      const base = siteBase();
      if (!base) throw new Error("Convex site URL is unavailable. Check the deployment environment.");
      const token = await create({ businessId: currentBusinessId() });
      setEndpoint(`${base}/google-form?token=${encodeURIComponent(token)}`);
      setMessage("Connection key created. It is shown only in this URL; keep the URL private. This connection is separate from Centipid.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the Google Forms connection."); }
    finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMessage("");
    try { await revoke({ businessId: currentBusinessId() }); setEndpoint(""); setMessage("Google Forms submissions can no longer enter this app using the previous connection key."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke the connection."); }
    finally { setBusy(false); }
  }

  async function reprocessSelected() {
    if (!reviewId) return;
    setReprocessing(true); setMessage("");
    try {
      const result = await reprocess({ businessId: currentBusinessId(), receiptId: reviewId, reason: reviewReason });
      setReviewId(null); setReviewReason("");
      setMessage(result.status === "posted" ? "Submission posted after your review." : `Submission still needs review: ${result.summary}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not reprocess this submission."); }
    finally { setReprocessing(false); }
  }

  function formatSavedFields(detailsJson: string) {
    try { return JSON.stringify(JSON.parse(detailsJson), null, 2); }
    catch { return "Saved submission fields could not be read."; }
  }

  return <section className="card settings-card">
    <div className="card-heading"><div><h2 className="card-title">Google Form submissions</h2><p className="card-subtitle">Connect the existing accountant form without changing the Centipid webhook.</p></div></div>
    <p className="muted-note">Receipt downloads include up to 500 recent submissions and the visible summary, not raw form fields or source keys. Saved form fields are fetched only when you open a submission for review.</p>
    <p className="muted-note">Status: {status === undefined ? "Loading…" : status.enabled ? "Connection key active" : "Not connected"}. After the Apps Script bridge is installed, eligible sales and expenses post to the cashbook. Other or incomplete form types are held for review rather than guessed.</p>
    {endpoint && <div className="field field-full"><label htmlFor="google-form-endpoint">Google Form connection URL · copy before leaving this page</label><div className="copy-row"><input id="google-form-endpoint" readOnly value={endpoint} onFocus={event => event.target.select()} /><button className="button" type="button" onClick={() => void navigator.clipboard.writeText(endpoint).then(() => setMessage("Connection URL copied."))}>Copy URL</button></div></div>}
    {message && <p className="muted-note" role="status">{message}</p>}
    <div className="form-actions"><button className="button button-accent" type="button" disabled={busy} onClick={() => void rotate()}>{busy ? "Working…" : status?.enabled ? "Rotate connection key" : "Create connection URL"}</button>{status?.enabled && <button className="button" type="button" disabled={busy} onClick={() => void disable()}>Revoke key</button>}</div>
    <div className="card-heading"><h3 className="card-title">Recent submissions</h3><button className="button" type="button" disabled={exporting || settings?.access !== "ready"} onClick={() => void downloadReceiptHistory()}>{exporting ? "Preparing CSV…" : "Download receipt CSV"}</button></div>
    {history.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Type</th><th>Date</th><th>Amount</th><th>Status</th><th>Attempts</th><th>Details</th><th>Review</th></tr></thead><tbody>{history.map(row => { const amount = row.amountUgx === undefined ? "—" : new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 }).format(row.amountUgx); return <tr key={row._id}><td>{row.submissionKind.replaceAll("_", " ")}</td><td>{row.occurredOn ?? "Needs date"}</td><td>{amount}</td><td>{row.status === "posted" ? "Posted" : "Needs review"}</td><td>{row.attemptCount}</td><td>{row.summary}</td><td>{row.status === "needs_review" && row.canReprocess ? <button className="button" type="button" onClick={() => { setReviewId(current => current === row._id ? null : row._id); setReviewReason(""); }}>Review</button> : "—"}</td></tr>; })}</tbody></table>{historyStatus === "CanLoadMore" && <button className="button" type="button" onClick={() => loadMore(20)}>Load older submissions</button>}</div> : <p className="muted-note">{historyStatus === "LoadingFirstPage" ? "Loading submissions…" : "No Google Form submissions have reached the app yet."}</p>}
    {reviewId && history.find(row => row._id === reviewId) && <div className="notice-banner notice-info"><strong>Review saved submission details</strong>{reviewDetails === undefined ? <p>Loading saved fields…</p> : reviewDetails === null ? <p>You no longer have permission to review this submission.</p> : <><pre style={{ maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap" }}>{formatSavedFields(reviewDetails)}</pre><label className="field field-full"><span>Why are you approving a retry? This is saved in the audit history.</span><textarea rows={3} minLength={5} maxLength={500} value={reviewReason} onChange={event => setReviewReason(event.target.value)} /></label><div className="form-actions"><button className="button button-accent" type="button" disabled={reprocessing || reviewReason.trim().length < 5} onClick={() => void reprocessSelected()}>{reprocessing ? "Reviewing…" : "Reprocess with my approval"}</button><button className="button" type="button" disabled={reprocessing} onClick={() => { setReviewId(null); setReviewReason(""); }}>Cancel</button></div><p className="muted-note">The retry uses the original source key and normal workspace checks. It can post only a sale or expense that your role is allowed to create; otherwise it remains in review.</p></>}</div>}
    <p className="muted-note">A submission held for review can be corrected in the source form and safely retried with the same source key. Posted submissions remain idempotent.</p>
    <p className="muted-note">Creating the URL does not install or deploy the Apps Script bridge. Keep the current Sheet handler active until a staging parity check has passed.</p>
  </section>;
}
