"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

function nextDay(value: string) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function changedFields(details?: string) {
  if (!details) return "—";
  try {
    const value = JSON.parse(details) as Record<string, unknown>;
    const before = value.before && typeof value.before === "object" ? Object.keys(value.before) : [];
    const after = value.after && typeof value.after === "object" ? Object.keys(value.after) : [];
    const fields = [...new Set([...before, ...after])];
    return fields.length ? fields.join(", ") : "Details available";
  } catch {
    return "Details available";
  }
}

export function AuditLog() {
  const [fromDraft, setFromDraft] = useState("");
  const [toDraft, setToDraft] = useState("");
  const [actionDraft, setActionDraft] = useState("");
  const [actorDraft, setActorDraft] = useState("");
  const [filters, setFilters] = useState({ from: "", to: "", action: "", actor: "" });
  const [filterError, setFilterError] = useState("");
  const options = useQuery(api.audits.filterOptions, {});
  const args = useMemo(() => ({
    from: filters.from || undefined,
    toExclusive: nextDay(filters.to) || undefined,
    action: filters.action || undefined,
    actorId: filters.actor ? filters.actor as Id<"users"> : undefined,
  }), [filters]);
  const { results, status, loadMore } = usePaginatedQuery(api.audits.list, options?.access === "restricted" ? "skip" : args, { initialNumItems: 50 });

  if (options?.access === "restricted") return <div className="notice-banner notice-info" role="status">Your role does not include audit log access.</div>;

  return <div className="audit-page-content">
    <form className="audit-filters" onSubmit={event => {
      event.preventDefault();
      if (fromDraft && toDraft && fromDraft > toDraft) {
        setFilterError("The start date must be on or before the end date.");
        return;
      }
      setFilterError("");
      setFilters({ from: fromDraft, to: toDraft, action: actionDraft, actor: actorDraft });
    }}>
      <label><span>From</span><input type="date" value={fromDraft} onChange={event => setFromDraft(event.target.value)} /></label>
      <label><span>To</span><input type="date" value={toDraft} onChange={event => setToDraft(event.target.value)} /></label>
      <label><span>Event</span><select value={actionDraft} onChange={event => setActionDraft(event.target.value)}><option value="">All events</option>{options?.access === "ready" && options.actions.map(action => <option key={action} value={action}>{action}</option>)}</select></label>
      <label><span>Actor</span><select value={actorDraft} onChange={event => setActorDraft(event.target.value)}><option value="">All staff</option>{options?.access === "ready" && options.actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
      <div className="audit-filter-actions"><button className="button button-accent" type="submit">Apply filters</button><button className="button" type="button" onClick={() => { setFromDraft(""); setToDraft(""); setActionDraft(""); setActorDraft(""); setFilterError(""); setFilters({ from: "", to: "", action: "", actor: "" }); }}>Clear</button></div>
    </form>
    {filterError && <p className="form-feedback form-error" role="alert">{filterError}</p>}
    <section className="card audit-table-card">
      <div className="audit-table-heading"><div><strong>Workspace activity</strong><span>Newest events appear first.</span></div><span>{results.length} loaded</span></div>
      {results.length ? <div className="table-scroll"><table className="data-table audit-table"><thead><tr><th>Event</th><th>Target</th><th>Changes</th><th>Actor</th><th>When</th></tr></thead><tbody>{results.map(event => <tr key={event.id}>
        <td><span className="audit-event-badge">{event.action.replaceAll(".", " ")}</span><small>{event.summary}</small></td>
        <td>{event.entityType}<small>…{event.entityId.slice(-8)}</small></td>
        <td>{changedFields(event.details)}</td>
        <td>{event.actorName}</td>
        <td><time dateTime={new Date(event.occurredAt).toISOString()}>{new Date(event.occurredAt).toLocaleString()}</time></td>
      </tr>)}</tbody></table></div> : <p className="muted-note audit-empty">{status === "LoadingFirstPage" ? "Loading audit history…" : "No audit events match these filters."}</p>}
      {status === "CanLoadMore" && <div className="audit-load-more"><button className="button" type="button" onClick={() => loadMore(50)}>Load more events</button></div>}
      {status === "LoadingMore" && <p className="muted-note audit-empty" role="status">Loading more events…</p>}
    </section>
  </div>;
}
