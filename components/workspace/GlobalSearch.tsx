"use client";

import { useQuery } from "convex/react";
import { Clock3, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";

const recentSearchesKeyPrefix = "mylesnet-recent-searches-v1";
const maxRecentSearches = 5;

function readRecentSearches(key: string | null) {
  if (!key) return [];
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string").slice(0, maxRecentSearches) : [];
  } catch {
    return [];
  }
}

function hashSearchScope(scope: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < scope.length; index += 1) {
    const code = scope.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ (code + index), 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

function money(amountMinor: number, scale: number, locale: string) {
  const digits = Math.round(Math.log10(scale));
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amountMinor / scale);
}

export function GlobalSearch({ searchScope }: { searchScope: string | null }) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [recentSearchState, setRecentSearchState] = useState<{ key: string | null; values: string[] }>({ key: null, values: [] });
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const settings = useQuery(api.settings.runtimeContext, {});
  const normalizedTerm = term.trim();
  const results = useQuery(api.workspace.searchEntries, normalizedTerm.length >= 2 ? { term: normalizedTerm, limit: 8 } : "skip");
  const showRecent = normalizedTerm.length === 0;
  const recentSearchesKey = searchScope ? `${recentSearchesKeyPrefix}:${hashSearchScope(searchScope)}` : null;
  const recentSearches = recentSearchState.key === recentSearchesKey ? recentSearchState.values : [];
  const resultCount = normalizedTerm.length >= 2 ? results?.length ?? 0 : 0;
  const itemCount = showRecent ? recentSearches.length : resultCount;
  const selectedIndex = itemCount === 0 ? 0 : Math.min(activeIndex, itemCount - 1);

  useEffect(() => {
    if (!open || itemCount === 0) return;
    document.getElementById(`global-search-option-${selectedIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [itemCount, open, selectedIndex]);

  const openSearch = useCallback(() => {
    setRecentSearchState({ key: recentSearchesKey, values: readRecentSearches(recentSearchesKey) });
    setTerm("");
    setActiveIndex(0);
    window.dispatchEvent(new Event("mylesnet:workspace-search-open"));
    setOpen(true);
  }, [recentSearchesKey]);

  const closeSearch = useCallback(() => {
    window.dispatchEvent(new Event("mylesnet:workspace-search-close"));
    setOpen(false);
    setTerm("");
    setActiveIndex(0);
  }, []);

  const rememberSearch = useCallback((value: string) => {
    const query = value.trim();
    if (!query || !recentSearchesKey) return;
    const current = recentSearchState.key === recentSearchesKey ? recentSearchState.values : [];
    const next = [query, ...current.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, maxRecentSearches);
    try { window.localStorage.setItem(recentSearchesKey, JSON.stringify(next)); }
    catch { /* Search still works if browser storage is unavailable. */ }
    setRecentSearchState({ key: recentSearchesKey, values: next });
  }, [recentSearchesKey, recentSearchState]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) closeSearch();
        else openSearch();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [closeSearch, open, openSearch]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) {
        const sidebar = document.getElementById("workspace-sidebar");
        const mobileMenuButton = document.querySelector<HTMLElement>(".mobile-menu-button");
        if (window.matchMedia("(max-width: 760px)").matches && sidebar?.contains(previousFocus) && mobileMenuButton) mobileMenuButton.focus();
        else previousFocus.focus();
      }
    };
  }, [open]);

  function selectResult(entry: NonNullable<typeof results>[number]) {
    rememberSearch(normalizedTerm);
    closeSearch();
    router.push(entry.kind === "sale" ? "/sales" : "/expenses");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (event.key === "ArrowDown" && itemCount > 0) {
      event.preventDefault();
      setActiveIndex((selectedIndex + 1) % itemCount);
    } else if (event.key === "ArrowUp" && itemCount > 0) {
      event.preventDefault();
      setActiveIndex((selectedIndex - 1 + itemCount) % itemCount);
    } else if (event.key === "Enter" && itemCount > 0) {
      event.preventDefault();
      if (showRecent) {
        setTerm(recentSearches[selectedIndex] ?? "");
        setActiveIndex(0);
      } else if (results?.[selectedIndex]) {
        selectResult(results[selectedIndex]);
      }
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="global-search-wrap">
    <button ref={triggerRef} className="search-box search-trigger" type="button" aria-label="Search entries and categories" aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K" onClick={openSearch}>
      <Search size={16} aria-hidden="true" />
      <span className="search-trigger-label">Search entries, partners and bills</span>
      <kbd>Ctrl+K</kbd>
    </button>
    {open && createPortal(<div className="global-search-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSearch(); }}>
      <section ref={dialogRef} className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Search workspace" onKeyDown={handleDialogKeyDown}>
        <div className="global-search-input-row">
          <Search size={19} aria-hidden="true" />
          <input
            ref={inputRef}
            aria-label="Search anything in this workspace"
            aria-controls="global-search-options"
            aria-activedescendant={itemCount ? `global-search-option-${selectedIndex}` : undefined}
            placeholder="Search anything…"
            value={term}
            onChange={(event) => { setTerm(event.target.value); setActiveIndex(0); }}
            onKeyDown={handleKeyDown}
          />
          {term && <button className="global-search-clear-input" type="button" aria-label="Clear search" onClick={() => { setTerm(""); setActiveIndex(0); inputRef.current?.focus(); }}><X size={17} /></button>}
          <button className="global-search-close" type="button" aria-label="Close search" onClick={closeSearch}><X size={18} /></button>
        </div>
        <div className="global-search-body" id="global-search-options" role="listbox" aria-label={showRecent ? "Recent searches" : "Matching records"}>
          {showRecent ? <>
            <div className="global-search-section-heading"><span>Recent</span>{recentSearches.length > 0 && <button type="button" onClick={() => { setRecentSearchState({ key: recentSearchesKey, values: [] }); try { if (recentSearchesKey) window.localStorage.removeItem(recentSearchesKey); } catch { /* Ignore unavailable storage. */ } }}>Clear</button>}</div>
            {recentSearches.length === 0 ? <p className="global-search-empty">Search saved sales and expenses in this workspace.</p> : recentSearches.map((recent, index) => <button className={`global-search-recent${selectedIndex === index ? " is-active" : ""}`} id={`global-search-option-${index}`} role="option" aria-selected={selectedIndex === index} type="button" key={recent} onMouseEnter={() => setActiveIndex(index)} onClick={() => { setTerm(recent); setActiveIndex(0); inputRef.current?.focus(); }}><Clock3 size={16} aria-hidden="true" /><span>{recent}</span></button>)}
          </> : normalizedTerm.length < 2 ? <p className="global-search-empty">Type at least 2 characters to search saved records.</p>
            : results === undefined ? <p className="global-search-empty">Searching this workspace…</p>
              : results.length === 0 ? <p className="global-search-empty">No matching saved records.</p>
                : results.map((entry, index) => <button className={`global-search-result${selectedIndex === index ? " is-active" : ""}`} id={`global-search-option-${index}`} role="option" aria-selected={selectedIndex === index} type="button" key={entry._id} onMouseEnter={() => setActiveIndex(index)} onClick={() => selectResult(entry)}>
                  <span className={`search-result-icon ${entry.kind === "sale" ? "search-result-sale" : "search-result-expense"}`}>{entry.kind === "sale" ? "+" : "−"}</span>
                  <span className="search-result-main"><strong>{entry.note || entry.category}</strong><small>{entry.occurredOn} · {entry.category} · {entry.kind === "sale" ? "Sale" : "Expense"}</small></span>
                  <span className="search-result-amount">{money(entry.amountUgx, 10 ** (settings?.access === "ready" ? settings.currencyMinorDigits : 0), settings?.access === "ready" ? settings.locale : "en-UG")} {settings?.access === "ready" ? settings.currency : "UGX"}</span>
                </button>)}
        </div>
        <footer className="global-search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span><span className="global-search-shortcut"><kbd>⌘</kbd><kbd>K</kbd> Toggle</span></footer>
      </section>
    </div>, document.body)}
  </div>;
}
