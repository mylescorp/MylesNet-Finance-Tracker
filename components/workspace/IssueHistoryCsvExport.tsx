"use client";

import { useConvex } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type ReviewStatus = "all" | "open" | "acknowledged" | "resolved";

export function IssueHistoryCsvExport({ businessId, status, currency, scale }: { businessId: Id<"businesses">; status: ReviewStatus; currency: string; scale: number }) {
  const convex = useConvex();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function download() {
    setBusy(true);
    setMessage("");
    try {
      let cursor: string | null = null;
      let done = false;
      const rows: Array<{ issueKey: string; issueId: string; title: string; periodFrom: string; toExclusive: string; amountUgx: number; status: "open" | "acknowledged" | "resolved"; note?: string; assignee?: string; updatedBy: string; updatedAt: number }> = [];
      while (!done) {
        const page: { page: typeof rows; isDone: boolean; continueCursor: string } = await convex.query(api.analytics.reviewQueue, {
          businessId,
          ...(status === "all" ? {} : { status }),
          paginationOpts: { numItems: 50, cursor },
        });
        if (rows.length + page.page.length > 10_000 || (rows.length + page.page.length === 10_000 && !page.isDone)) {
          setMessage("This history exceeds 10,000 records. Filter by status and try again.");
          return;
        }
        rows.push(...page.page);
        cursor = page.continueCursor;
        done = page.isDone;
      }

      const headers = ["Issue ID", "Issue", "Period from", "Period to exclusive", "Value", "Unit", "Status", "Assignee", "Review note", "Updated by", "Updated at (UTC)", "Issue key"];
      const encodeCell = (value: string) => {
        const safe = /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      const csvRows = rows.map(row => {
        const value = row.issueId === "missing-sales-days" ? String(row.amountUgx)
          : row.issueId === "ownership-incomplete" ? String(row.amountUgx / 100)
            : String(row.amountUgx / scale);
        const unit = row.issueId === "missing-sales-days" ? "days"
          : row.issueId === "ownership-incomplete" ? "%"
            : currency;
        return [row.issueId, row.title, row.periodFrom, row.toExclusive, value, unit, row.status, row.assignee ?? "", row.note ?? "", row.updatedBy, new Date(row.updatedAt).toISOString(), row.issueKey];
      });
      const csv = [headers, ...csvRows].map(row => row.map(encodeCell).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mylesnet-issue-history-${status}.csv`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`${rows.length.toLocaleString()} issue reviews exported.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not export the issue history.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="form-actions"><button className="button" type="button" disabled={busy} onClick={() => void download()}>{busy ? "Preparing CSV…" : "Export CSV"}</button>{message && <span className="muted-note" role="status">{message}</span>}</div>;
}
