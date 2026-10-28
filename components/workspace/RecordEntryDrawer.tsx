"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";

type FormItem = { id: string; title: string; description?: string };
type DrawerContextValue = {
  forms: FormItem[];
  selectedId: string | null;
  selectionVersion: number;
  busy: boolean;
  register: (item: FormItem) => () => void;
  setBusy: (busy: boolean) => void;
  select: (id: string) => void;
  close: () => void;
  saved: (message?: string) => void;
  dismissSaved: () => void;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function RecordEntryDrawerProvider({ children }: { children: ReactNode }) {
  const [registry, setRegistry] = useState<Record<string, FormItem>>({});
  const [selection, setSelection] = useState<{ selectedId: string | null; selectionVersion: number }>({ selectedId: null, selectionVersion: 0 });
  const { selectedId, selectionVersion } = selection;
  const [busy, setBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const register = useCallback((item: FormItem) => {
    setRegistry(current => current[item.id]?.title === item.title && current[item.id]?.description === item.description ? current : { ...current, [item.id]: item });
    return () => setRegistry(current => {
      if (!current[item.id]) return current;
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }, []);
  const close = useCallback(() => {
    setSelection(current => current.selectedId === null ? current : { selectedId: null, selectionVersion: current.selectionVersion + 1 });
  }, []);
  const select = useCallback((id: string) => {
    setSelection(current => current.selectedId === id ? current : { selectedId: id, selectionVersion: current.selectionVersion + 1 });
  }, []);
  const saved = useCallback((message?: string) => {
    close();
    setSuccessMessage(message ?? "Record saved successfully.");
  }, [close]);
  const dismissSaved = useCallback(() => setSuccessMessage(""), []);
  const forms = useMemo(() => Object.values(registry), [registry]);
  const value = useMemo(() => ({ forms, selectedId, selectionVersion, busy, register, setBusy, select, close, saved, dismissSaved }), [forms, selectedId, selectionVersion, busy, register, setBusy, select, close, saved, dismissSaved]);
  return <DrawerContext.Provider value={value}>{children}{successMessage && <div className="record-save-toast" role="status"><span>{successMessage}</span><button className="icon-button" type="button" aria-label="Dismiss save confirmation" onClick={dismissSaved}><X size={14} /></button></div>}</DrawerContext.Provider>;
}

export function useRecordEntryDrawer() {
  const value = useContext(DrawerContext);
  if (!value) throw new Error("Record entry controls must be inside RecordEntryDrawerProvider.");
  return value;
}

export function useOptionalRecordEntryDrawer() {
  return useContext(DrawerContext);
}

export function useRecordEntrySaved() {
  const value = useContext(DrawerContext);
  const noopSave: (message?: string) => void = () => {};
  return value?.saved ?? noopSave;
}

export function useRecordEntryBusy() {
  const drawer = useOptionalRecordEntryDrawer();
  return drawer?.setBusy ?? (() => {});
}

export function AddRecordButton({ label = "Add entry" }: { label?: string }) {
  const { forms, select } = useRecordEntryDrawer();
  return <button className="button button-accent" type="button" disabled={forms.length === 0} onClick={() => select(forms[0].id)}><Plus size={14} />{label}</button>;
}

export function RegisteredRecordForm({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  const drawer = useRecordEntryDrawer();
  const { forms, selectedId, busy, register, select, close } = drawer;
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const active = selectedId === id;

  useEffect(() => register({ id, title, description }), [register, id, title, description]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    if (!active) return;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');
      if (!focusable?.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => drawerRef.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (triggerRef.current?.isConnected) triggerRef.current.focus();
    };
  }, [active, close]);

  if (!active || typeof document === "undefined") return null;
  return createPortal(<div className="record-drawer-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section ref={drawerRef} className="record-drawer" role="dialog" aria-modal="true" aria-labelledby="record-drawer-title" aria-describedby={description ? "record-drawer-description" : undefined}>
      <header className="record-drawer-header">
        <div><span className="eyebrow">NEW RECORD</span><h2 id="record-drawer-title">{title}</h2>{description && <p id="record-drawer-description">{description}</p>}</div>
        <button className="icon-button" type="button" aria-label="Close record drawer" disabled={busy} onClick={close}><X size={17} /></button>
      </header>
      {forms.length > 1 && <nav className="record-drawer-actions" aria-label="Record type">{forms.map(item => <button key={item.id} className={`button${item.id === id ? " button-accent" : ""}`} type="button" disabled={busy} aria-current={item.id === id ? "page" : undefined} onClick={() => select(item.id)}>{item.title}</button>)}</nav>}
      <div className="record-drawer-content">{children}</div>
    </section>
  </div>, document.body);
}
