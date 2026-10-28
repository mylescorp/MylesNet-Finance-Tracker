"use client";

import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";

function money(amountMinor: number, scale: number, locale: string) {
  const digits = Math.round(Math.log10(scale));
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amountMinor / scale);
}

export function GlobalSearch() {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const settings = useQuery(api.settings.runtimeContext, {});
  const results = useQuery(api.workspace.searchEntries, term.trim().length >= 2 ? { term: term.trim(), limit: 8 } : "skip");
  const showResults = open && term.trim().length >= 2;

  return <div className="global-search-wrap">
    <label className="search-box" role="search">
      <Search size={16} aria-hidden="true" />
      <input
        aria-label="Search entries and categories"
        placeholder="Search entries, partners and bills"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      <kbd>/</kbd>
    </label>
    {showResults && <div className="global-search-results" role="listbox" aria-label="Search results">
      {results === undefined ? <div className="search-result-empty">Searching saved entries…</div>
        : results.length === 0 ? <div className="search-result-empty">No matching saved entries.</div>
          : results.map((entry) => <Link className="search-result" href={entry.kind === "sale" ? "/sales" : "/expenses"} key={entry._id} onClick={() => { setOpen(false); setTerm(""); }}>
            <span className={`search-result-icon ${entry.kind === "sale" ? "search-result-sale" : "search-result-expense"}`}>{entry.kind === "sale" ? "+" : "−"}</span>
            <span className="search-result-main"><strong>{entry.note || entry.category}</strong><small>{entry.occurredOn} · {entry.category}</small></span>
            <span className="search-result-amount">{money(entry.amountUgx, 10 ** (settings?.access === "ready" ? settings.currencyMinorDigits : 0), settings?.access === "ready" ? settings.locale : "en-UG")} {settings?.access === "ready" ? settings.currency : "UGX"}</span>
          </Link>)}
      <div className="search-result-footnote">Search is limited to this workspace and saved records.</div>
    </div>}
  </div>;
}
