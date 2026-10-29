"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Banknote, CircleAlert, Radio, Smartphone } from "lucide-react";
import { Children, cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { countries, getEmojiFlag } from "countries-list";
import { currencies } from "countries-list/currencies";
import timezoneData from "countries-and-timezones";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { ChevronDown, ClipboardList, ShieldCheck, UsersRound } from "lucide-react";
import { CsvImportPanel } from "./CsvImportPanel";
import { CentipidWebhookPanel } from "./CentipidWebhookPanel";
import { GoogleFormsPanel } from "./GoogleFormsPanel";

type Tab = "general" | "finance" | "rules" | "data" | "access" | "releases";
const localeOptions = ["en-UG", "sw-UG", "en-KE", "sw-KE", "en-TZ", "sw-TZ", "en-GB", "en-US", "fr-FR", "ar-SA", "hi-IN", "zh-CN", "pt-BR", "es-ES"];
const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, i, 1))));
function businessDayKey(timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export function SettingsWorkspace({ tab }: { tab: Tab }) {
  const overview = useQuery(api.settings.overview, {});
  if (tab === "access") return <AccessSettings />;
  if (tab === "data") return <DataSettings />;
  if (tab === "releases") return <ReleaseSettings />;
  if (overview === undefined) return <p className="muted-note" role="status">Loading workspace settings…</p>;
  if (overview.access === "restricted") return <p className="muted-note">Your role does not include workspace settings access. Ask an administrator to review your permissions.</p>;
  if (overview.access !== "ready") return <p className="muted-note">Your account needs workspace access before settings can be loaded.</p>;
  if (tab === "rules") return <><EditableSettings tab={tab} settings={overview} /><RulesReview /></>;
  if (tab === "finance") return <><EditableSettings tab={tab} settings={overview} />{overview.canManageBalanceAdjustments ? <BalanceAdjustmentManager settings={overview} /> : <p className="muted-note settings-readonly-note">Only a workspace owner can record or manage counted balance adjustments.</p>}</>;
  return <EditableSettings tab={tab} settings={overview} />;
}

function EditableSettings({ tab, settings }: { tab: "general" | "finance" | "rules"; settings: SettingsOverview }) {
  const save = useMutation(api.settings.update);
  const canUpdate = settings.canUpdate;
  const [form, setForm] = useState({
    businessName: settings.businessName, countryCode: settings.countryCode, currency: settings.currency,
    timezone: settings.timezone, weekStartsOn: settings.weekStartsOn, locale: settings.locale,
    dateFormat: settings.dateFormat, fiscalYearStartMonth: settings.fiscalYearStartMonth,
    incomeCategories: settings.incomeCategories, expenseCategories: settings.expenseCategories,
    highExpenseReviewUgx: settings.highExpenseReviewUgx, weakDaySalesUgx: settings.weakDaySalesUgx,
    monthlySalesTargetUgx: settings.monthlySalesTargetUgx, monthlyExpenseWarningUgx: settings.monthlyExpenseWarningUgx,
    lowCashAlertUgx: settings.lowCashAlertUgx,
    cashOpeningBalance: settings.cashOpeningBalance, mobileOpeningBalance: settings.mobileOpeningBalance,
    duplicateWindowDays: settings.duplicateWindowDays, requireEntryNote: settings.requireEntryNote,
    negativeBalanceWarning: settings.negativeBalanceWarning,
  });
  const [busy, setBusy] = useState(false);
  const settingsVersion = useRef(settings.settingsUpdatedAt);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const countryList = useMemo(() => Object.entries(countries).map(([code, country]) => ({ code, ...country })).sort((a, b) => a.name.localeCompare(b.name)), []);
  const currencyCodes = useMemo(() => Object.keys(currencies).filter(code => !currencies[code as keyof typeof currencies].withdrawn).sort(), []);
  const countryTimezones = useMemo<string[]>(() => timezoneData.getTimezonesForCountry(form.countryCode)?.map(t => t.name) ?? [], [form.countryCode]);
  const allTimezones = useMemo<string[]>(() => Object.keys(timezoneData.getAllTimezones()).sort(), []);
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(old => ({ ...old, [key]: value }));
  const thisTab = tab === "general" ? "General" : tab === "finance" ? "Finance" : "Rules";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(null);
    try { settingsVersion.current = await save({ ...form, expectedSettingsUpdatedAt: settingsVersion.current }); setFeedback({ message: `${thisTab} settings saved and added to the audit trail.`, error: false }); }
    catch (error) { setFeedback({ message: error instanceof Error ? error.message : "Could not save settings.", error: true }); }
    finally { setBusy(false); }
  }

  return <form className="settings-stack" onSubmit={e => void submit(e)}>
    {tab === "general" && <>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Workspace identity and region</h2><p className="card-subtitle">Regional defaults are used for business dates, reports, and new cashbook entries.</p></div></div>
        <div className="form-layout">
          <Field label="Business or workspace name"><input value={form.businessName} onChange={e => update("businessName", e.target.value)} minLength={2} maxLength={100} disabled={!canUpdate} required /></Field>
          <Field label="Country or territory"><select value={form.countryCode} disabled={!canUpdate} onChange={e => { const c = countryList.find(x => x.code === e.target.value); update("countryCode", e.target.value); const code = c?.currency.find(code => !currencies[code as keyof typeof currencies]?.withdrawn); if (code && !settings.currencyLocked) update("currency", code); const zones = timezoneData.getTimezonesForCountry(e.target.value); if (zones?.[0]) update("timezone", zones[0].name); const language = c?.languages[0]; const locale = language ? `${language}-${e.target.value}` : ""; if (localeOptions.includes(locale)) update("locale", locale); }}><option value="">Choose a country</option>{countryList.map(c => <option key={c.code} value={c.code}>{getEmojiFlag(c.code as keyof typeof countries)} {c.name}</option>)}</select></Field>
          <Field label="Business timezone"><select value={form.timezone} disabled={!canUpdate} onChange={e => update("timezone", e.target.value)}>{(countryTimezones.includes(form.timezone) ? countryTimezones : [...countryTimezones, form.timezone]).map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")} · {offsetLabel(zone)}</option>)}<optgroup label="All global timezones">{allTimezones.filter(z => !countryTimezones.includes(z)).map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")} · {offsetLabel(zone)}</option>)}</optgroup></select><span className="muted-note">Time zones observe daylight saving changes when applicable.</span></Field>
          <Field label="Cashbook currency"><select value={form.currency} disabled={!canUpdate || settings.currencyLocked} onChange={e => update("currency", e.target.value)}>{currencyCodes.map(code => <option key={code} value={code}>{code} · {currencyName(code)}</option>)}</select><span className="muted-note">{settings.currencyLocked ? "Currency is locked after an opening balance, cashbook entry, or operational record so saved amounts are never relabelled. A reviewed migration is required to change it." : "Currency can be changed until an opening balance or financial record is recorded."}</span></Field>
          <Field label="Display language and number format"><select value={form.locale} disabled={!canUpdate} onChange={e => update("locale", e.target.value)}>{localeOptions.map(locale => <option key={locale}>{locale}</option>)}</select></Field>
          <Field label="Date format"><select value={form.dateFormat} disabled={!canUpdate} onChange={e => update("dateFormat", e.target.value as typeof form.dateFormat)}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></Field>
          <Field label="Week starts on"><select value={form.weekStartsOn} disabled={!canUpdate} onChange={e => update("weekStartsOn", e.target.value as "monday" | "sunday")}><option value="monday">Monday</option><option value="sunday">Sunday</option></select></Field>
          <Field label="Financial year starts in"><select value={form.fiscalYearStartMonth} disabled={!canUpdate} onChange={e => update("fiscalYearStartMonth", Number(e.target.value))}>{monthNames.map((month, i) => <option key={month} value={i + 1}>{month}</option>)}</select></Field>
        </div>
      </section>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Regional preview</h2><p className="card-subtitle">A quick check of the settings that affect saved records.</p></div></div><div className="settings-facts"><div><span>Business date</span><strong>{new Intl.DateTimeFormat(form.locale, { dateStyle: "full", timeZone: form.timezone }).format(new Date())}</strong></div><div><span>Time zone</span><strong>{form.timezone} · {offsetLabel(form.timezone)}</strong></div><div><span>Currency preview</span><strong>{moneyPreview(form.currency, form.locale)}</strong></div><div><span>Financial year</span><strong>{monthNames[form.fiscalYearStartMonth - 1]}–{monthNames[(form.fiscalYearStartMonth + 10) % 12]}</strong></div></div></section>
    </>}
    {tab === "finance" && <>
      <LiveBalancePanel settings={settings} />
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Cashbook categories</h2><p className="card-subtitle">One category per line. Categories are available to everyone who can record entries.</p></div></div><div className="form-layout"><Field label="Income categories"><textarea rows={7} value={form.incomeCategories.join("\n")} disabled={!canUpdate} onChange={e => update("incomeCategories", e.target.value.split("\n"))} /></Field><Field label="Expense categories"><textarea rows={7} value={form.expenseCategories.join("\n")} disabled={!canUpdate} onChange={e => update("expenseCategories", e.target.value.split("\n"))} /></Field></div></section>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Accounts and opening balances</h2><p className="card-subtitle">Set the starting cash and mobile money amounts before recording transactions.</p></div></div><div className="form-layout"><NumberField label="Opening cash balance" value={form.cashOpeningBalance} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!settings.canManageBalanceAdjustments || settings.openingBalancesLocked} onChange={v => update("cashOpeningBalance", v)} /><NumberField label="Opening mobile money balance" value={form.mobileOpeningBalance} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!settings.canManageBalanceAdjustments || settings.openingBalancesLocked} onChange={v => update("mobileOpeningBalance", v)} /></div>{settings.openingBalancesLocked && <p className="muted-note">Opening balances are locked after the first sale, expense, or account movement. Correct later differences with an auditable adjustment.</p>}</section>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Operating targets and cash alerts</h2><p className="card-subtitle">Targets help reports highlight exceptions. They do not create or change ledger entries. Set the cash alert to zero to turn it off.</p></div></div><div className="form-layout"><NumberField label="Monthly sales target" value={form.monthlySalesTargetUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!canUpdate} onChange={v => update("monthlySalesTargetUgx", v)} /><NumberField label="Monthly expense warning" value={form.monthlyExpenseWarningUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!canUpdate} onChange={v => update("monthlyExpenseWarningUgx", v)} /><NumberField label="Low cash alert threshold" value={form.lowCashAlertUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!canUpdate} onChange={v => update("lowCashAlertUgx", v)} /></div></section>
    </>}
    {tab === "rules" && <>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Review and quality rules</h2><p className="card-subtitle">Rules flag records for review. They never silently post, reject, or remove a transaction.</p></div></div><div className="form-layout"><NumberField label="Flag expenses at or above" value={form.highExpenseReviewUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!canUpdate} onChange={v => update("highExpenseReviewUgx", v)} /><NumberField label="Flag days with sales below" value={form.weakDaySalesUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!canUpdate} onChange={v => update("weakDaySalesUgx", v)} /><Field label="Duplicate review window (days)"><input type="number" min="0" max="30" step="1" value={form.duplicateWindowDays} disabled={!canUpdate} onChange={e => update("duplicateWindowDays", Number(e.target.value))} /></Field><label className="settings-toggle"><input type="checkbox" checked={form.requireEntryNote} disabled={!canUpdate} onChange={e => update("requireEntryNote", e.target.checked)} /><span><strong>Require a note on every entry</strong><small>Entries without a note are blocked by the server.</small></span></label><label className="settings-toggle"><input type="checkbox" checked={form.negativeBalanceWarning} disabled={!canUpdate} onChange={e => update("negativeBalanceWarning", e.target.checked)} /><span><strong>Warn when a balance goes below zero</strong><small>Warnings do not block a correction or withdrawal.</small></span></label></div></section>
    </>}
    {canUpdate && <div className="form-actions"><button className="button button-accent" disabled={busy}>{busy ? "Saving…" : `Save ${thisTab.toLowerCase()} settings`}</button>{feedback && <span className={`form-feedback ${feedback.error ? "form-error" : "form-success"}`} role="status">{feedback.message}</span>}</div>}
    {!canUpdate && <p className="muted-note settings-readonly-note">Your role does not have permission to edit these settings.</p>}
  </form>;
}

type SettingsOverview = Extract<NonNullable<ReturnType<typeof useQuery<typeof api.settings.overview>>>, { access: "ready" }>;
function Field({ label, children }: { label: string; children: ReactNode }) { const id = useId().replaceAll(":", ""); const childList = Children.toArray(children); const controlIndex = childList.findIndex(child => isValidElement(child) && typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type)); return <div className="field"><label htmlFor={id}>{label}</label>{childList.map((child, index) => index === controlIndex && isValidElement(child) ? cloneElement(child as React.ReactElement<{ id?: string }>, { id }) : child)}</div>; }
function NumberField({ label, value, currency, scale = 1, disabled, onChange }: { label: string; value: number; currency: string; scale?: number; disabled: boolean; onChange: (value: number) => void }) { return <Field label={`${label} (${currency})`}><input type="number" step={1 / scale} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /></Field>; }
function LiveBalancePanel({ settings }: { settings: SettingsOverview }) {
  const [day, setDay] = useState(() => businessDayKey(settings.timezone));
  useEffect(() => {
    const refreshDay = () => setDay(businessDayKey(settings.timezone));
    refreshDay();
    const timer = window.setInterval(refreshDay, 30_000);
    window.addEventListener("focus", refreshDay);
    document.addEventListener("visibilitychange", refreshDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshDay);
      document.removeEventListener("visibilitychange", refreshDay);
    };
  }, [settings.timezone]);
  const live = useQuery(api.workspace.balanceOverview, { day });
  const scale = 10 ** (settings.currencyMinorDigits ?? 0);
  const money = (amount: number) => {
    try { return new Intl.NumberFormat(settings.locale, { style: "currency", currency: settings.currency }).format(amount / scale); }
    catch { return `${(amount / scale).toLocaleString(settings.locale)} ${settings.currency}`; }
  };
  return <section className="card settings-card live-balance-card" aria-labelledby="live-balances-heading">
    <div className="card-heading"><div><h2 className="card-title" id="live-balances-heading">Live balances and daily close</h2><p className="card-subtitle">Balances update as cashbook entries and collection events arrive.</p></div><span className="live-balance-indicator"><Radio size={14} aria-hidden="true" /> Live</span></div>
    {live === undefined ? <p className="muted-note" role="status">Loading live balances…</p> : live.access !== "ready" ? <p className="muted-note">{live.access === "restricted" ? "Business balances are not available to partner accounts." : "Workspace access is required to view live balances."}</p> : <>
      <div className="live-balance-grid">
        <div className="live-balance-tile"><div><Banknote size={17} aria-hidden="true" /><span>Cash at hand</span></div><strong>{money(live.cashBalanceUgx)}</strong><small>Current cash account balance</small></div>
        <div className="live-balance-tile"><div><Smartphone size={17} aria-hidden="true" /><span>Mobile collection balance</span></div><strong>{money(live.mobileMoneyBalanceUgx)}</strong><small>Current mobile money account balance</small></div>
        <div className="live-balance-tile live-balance-estimate"><div><Banknote size={17} aria-hidden="true" /><span>Estimated cash sales today</span></div><strong>{money(live.estimatedCashSalesUgx)}</strong><small>Daily sales minus mobile money sales</small></div>
      </div>
      <div className="settings-facts live-balance-facts">
        <div><span>Total sales · {day}</span><strong>{money(live.salesUgx)}</strong></div>
        <div><span>Mobile sales · {day}</span><strong>{money(live.mobileSalesUgx)}</strong></div>
        <div><span>Centipid payments received</span><strong>{money(live.centipidMobileUgx)}</strong></div>
        <div><span>Centipid vouchers redeemed</span><strong>{money(live.centipidVoucherUgx)}</strong></div>
      </div>
      <p className="muted-note live-balance-note">Cash at hand is the actual ledger balance. Estimated cash sales are a daily reconciliation figure; expenses, opening balances, and transfers affect the actual cash balance separately.</p>
      {!live.cashEstimateComplete && <p className="live-balance-warning" role="status"><CircleAlert size={16} aria-hidden="true" /> More than 1,000 entries were recorded today, so the mobile sales and Centipid breakdowns may be incomplete.</p>}
    </>}
  </section>;
}
type BalanceAdjustmentRow = {
  _id: Id<"balanceAdjustments">;
  account: "cash" | "mobile_money";
  countedBalanceUgx: number;
  deltaUgx: number;
  occurredOn: string;
  note: string;
  state: "posted" | "void";
  voidReason?: string;
};
function parseBalanceMinorUnits(value: string, decimalPlaces: number): number | null {
  const match = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const exponent = Number(match[3] ?? 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;
  const digits = `${match[1]}${match[2] ?? ""}`;
  const decimalPoint = match[1].length + exponent;
  const whole = decimalPoint <= 0 ? "0" : decimalPoint >= digits.length ? `${digits}${"0".repeat(decimalPoint - digits.length)}` : digits.slice(0, decimalPoint);
  const fraction = decimalPoint <= 0 ? `${"0".repeat(-decimalPoint)}${digits}` : decimalPoint >= digits.length ? "" : digits.slice(decimalPoint);
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  if (normalizedWhole.length > 16 || (fraction.length > decimalPlaces && /[1-9]/.test(fraction.slice(decimalPlaces)))) return null;
  const fractionalMinor = fraction.slice(0, decimalPlaces).padEnd(decimalPlaces, "0");
  const amount = Number(`${normalizedWhole}${fractionalMinor}`);
  return Number.isSafeInteger(amount) ? amount : null;
}
function BalanceAdjustmentManager({ settings }: { settings: SettingsOverview }) {
  const { results: adjustmentRows, status: adjustmentStatus, loadMore } = usePaginatedQuery(api.workspace.balanceAdjustments, {}, { initialNumItems: 30 });
  const create = useMutation(api.workspace.createBalanceAdjustment);
  const updateAdjustment = useMutation(api.workspace.updateBalanceAdjustment);
  const voidAdjustment = useMutation(api.workspace.voidBalanceAdjustment);
  const [editing, setEditing] = useState<BalanceAdjustmentRow | null>(null);
  const [account, setAccount] = useState<"cash" | "mobile_money">("cash");
  const [countedBalance, setCountedBalance] = useState("");
  const [occurredOn, setOccurredOn] = useState(() => businessDayKey(settings.timezone));
  const [note, setNote] = useState("");
  const [voidId, setVoidId] = useState<Id<"balanceAdjustments"> | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const scale = 10 ** (settings.currencyMinorDigits ?? 0);
  const money = (amount: number) => new Intl.NumberFormat(settings.locale, { style: "currency", currency: settings.currency, minimumFractionDigits: Math.round(Math.log10(scale)), maximumFractionDigits: Math.round(Math.log10(scale)) }).format(amount / scale);

  function startEdit(row: BalanceAdjustmentRow) {
    setEditing(row); setAccount(row.account); setCountedBalance(String(row.countedBalanceUgx / scale)); setOccurredOn(row.occurredOn); setNote(row.note); setFeedback(null);
  }
  function resetForm() {
    setEditing(null); setAccount("cash"); setCountedBalance(""); setOccurredOn(businessDayKey(settings.timezone)); setNote("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setFeedback(null);
    try {
      const amount = parseBalanceMinorUnits(countedBalance, settings.currencyMinorDigits ?? 0);
      if (amount === null) throw new Error(`Enter a non-negative balance using ${settings.currency}'s supported decimal places.`);
      if (editing) await updateAdjustment({ businessId: settings.businessId, adjustmentId: editing._id, account, countedBalanceUgx: amount, occurredOn, note });
      else await create({ businessId: settings.businessId, account, countedBalanceUgx: amount, occurredOn, note });
      resetForm(); setFeedback({ message: editing ? "Balance record updated; the difference was applied to the live account balance." : "Balance recorded; the live account balance has been adjusted.", error: false });
    } catch (error) { setFeedback({ message: error instanceof Error ? error.message : "Could not save the balance record.", error: true }); }
    finally { setBusy(false); }
  }
  async function remove(row: BalanceAdjustmentRow) {
    if (voidId !== row._id) { setVoidId(row._id); setVoidReason(""); return; }
    setBusy(true); setFeedback(null);
    try { await voidAdjustment({ businessId: settings.businessId, adjustmentId: row._id, reason: voidReason }); setVoidId(null); setVoidReason(""); setFeedback({ message: "Balance record reversed and retained in the audit history.", error: false }); }
    catch (error) { setFeedback({ message: error instanceof Error ? error.message : "Could not reverse this balance record.", error: true }); }
    finally { setBusy(false); }
  }

  return <section className="card settings-card balance-adjustment-card">
    <div className="card-heading"><div><h2 className="card-title">Record a counted balance</h2><p className="card-subtitle">Enter the cash physically counted or the verified Centipid mobile collection balance. We’ll apply only the difference and keep an audit record.</p></div></div>
    <form className="form-layout" onSubmit={event => void submit(event)}>
      <label className="field"><span>Account</span><select value={account} disabled={Boolean(editing)} onChange={event => setAccount(event.target.value as "cash" | "mobile_money")}><option value="cash">Cash at hand</option><option value="mobile_money">Centipid mobile collection</option></select>{editing && <small className="muted-note">To move a count to another account, record a new count and remove this one.</small>}</label>
      <label className="field"><span>Counted balance ({settings.currency})</span><input type="number" min="0" step={1 / scale} value={countedBalance} onChange={event => setCountedBalance(event.target.value)} placeholder="Enter the balance you counted" required /></label>
      <label className="field"><span>Count date</span><input type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} required /></label>
      <label className="field field-full"><span>Reason or reference</span><textarea rows={2} maxLength={300} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. Opening count, Centipid settlement statement, or cash count correction" minLength={3} required /></label>
      <div className="form-actions field-full"><button className="button button-accent" disabled={busy}>{busy ? "Saving…" : editing ? "Save balance changes" : "Record balance"}</button>{editing && <button className="button" type="button" disabled={busy} onClick={resetForm}>Cancel edit</button>}{feedback && <span className={`form-feedback ${feedback.error ? "form-error" : "form-success"}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</span>}</div>
    </form>
    <div className="balance-adjustment-history"><div className="card-heading"><div><h3 className="card-title">Balance record history</h3><p className="card-subtitle">Counts and corrections, newest first. Removed records remain visible as reversed.</p></div></div>
      {adjustmentStatus === "LoadingFirstPage" ? <p className="muted-note">Loading balance records…</p> : adjustmentRows.length === 0 ? <p className="muted-note">No counted balances recorded yet.</p> : <><div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th><th>Account</th><th>Counted balance</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead><tbody>{adjustmentRows.map(row => <tr key={row._id} className={row.state === "void" ? "balance-adjustment-void" : undefined}><td>{row.occurredOn}</td><td>{row.account === "cash" ? "Cash at hand" : "Centipid mobile collection"}</td><td>{money(row.countedBalanceUgx)}</td><td>{row.note}{row.voidReason && <small className="balance-adjustment-reason">Reversal: {row.voidReason}</small>}</td><td>{row.state === "posted" ? "Active" : "Reversed"}</td><td>{row.state === "posted" ? <div className="balance-adjustment-actions"><button type="button" className="button button-small" onClick={() => startEdit(row)}>Edit</button><button type="button" className="button button-small button-danger-quiet" onClick={() => { setVoidId(row._id); setVoidReason(""); }}>Remove</button></div> : "—"}{voidId === row._id && row.state === "posted" && <div className="balance-adjustment-void-form"><label>Reason for removal<textarea rows={2} maxLength={300} value={voidReason} onChange={event => setVoidReason(event.target.value)} /></label><div className="form-actions"><button type="button" className="button button-danger" disabled={busy} onClick={() => void remove(row)}>Confirm removal</button><button type="button" className="button" disabled={busy} onClick={() => setVoidId(null)}>Cancel</button></div></div>}</td></tr>)}</tbody></table></div>{adjustmentStatus === "CanLoadMore" && <button type="button" className="button" onClick={() => loadMore(30)}>Load older balance records</button>}{adjustmentStatus === "LoadingMore" && <p className="muted-note" role="status">Loading older balance records…</p>}</>}
    </div>
  </section>;
}
function offsetLabel(zone: string) { try { return new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value ?? "UTC"; } catch { return "UTC"; } }
function currencyName(code: string) { return currencies[code as keyof typeof currencies]?.name ?? code; }
function moneyPreview(code: string, locale: string) { try { return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(123456.78); } catch { return `123,456.78 ${code}`; } }

function DataSettings() {
  const data = useQuery(api.settings.exportEntries, {});
  const access = useQuery(api.workspace.currentAccess, {});
  const [notice, setNotice] = useState("");
  function download() {
    if (!data || data.access !== "ready") return;
    const columns = ["date", "kind", "category", "account", "amount", "currency", "note", "source", "status", "created_at"] as const;
    const quote = (value: string | number) => { const text = String(value); const safe = /^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; };
    const csv = [columns.join(","), ...data.rows.map(r => [r.occurredOn, r.kind, r.category, r.account, r.amount.toFixed(data.currencyMinorDigits), r.currency, r.note, r.source, r.state, new Date(r.createdAt).toISOString()].map(quote).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `mylesnet-cashbook-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
    setNotice(`Exported ${data.rows.length} entries${data.rows.length === 5000 ? " (maximum export size reached; contact support for a full archive)" : ""}.`);
  }
  return <div className="settings-stack"><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Export cashbook data</h2><p className="card-subtitle">Download up to 5,000 records as UTF-8 CSV for audit, backup, or analysis.</p></div></div><p className="muted-note">Exports include transaction date, category, account, amount, currency, note, source, state, and creation time. Voided records remain included for audit history.</p><div className="form-actions"><button className="button button-accent" type="button" onClick={download} disabled={!data || data.access !== "ready"}>Download CSV</button>{data?.access === "ready" && <span className="muted-note">{data.rows.length} records ready · {data.currency}</span>}{data?.access === "restricted" && <span className="muted-note">Your role does not have permission to export cashbook data.</span>}</div>{notice && <p className="form-feedback form-success" role="status">{notice}</p>}</section>{access?.access === "ready" && access.permissions.includes("imports.manage") && <CsvImportPanel />}{access?.access === "ready" && access.permissions.includes("integrations.manage") && <><CentipidWebhookPanel /><GoogleFormsPanel /></>}<WorkspaceDataReset /><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Backups</h2><p className="card-subtitle">Off-platform archives and one-click restore have not been configured.</p></div></div><p className="muted-note">Imports and integrations are limited by your assigned role; exported and imported records keep their audit trail.</p></section></div>;
}

function WorkspaceDataReset() {
  const state = useQuery(api.dataReset.status, {});
  const start = useMutation(api.dataReset.start);
  const resume = useMutation(api.dataReset.resume);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState("");
  if (state?.access !== "ready") return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state || state.resetting || confirmation !== state.businessName || busy) return;
    setBusy(true); setError("");
    try { await start({ confirmation }); setConfirmation(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The workspace could not be reset."); }
    finally { setBusy(false); }
  }
  async function continueReset() {
    setResuming(true); setError("");
    try { await resume({}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The reset could not be resumed."); }
    finally { setResuming(false); }
  }
  return <section className="card settings-card data-reset-card" aria-labelledby="data-reset-title">
    <div className="card-heading"><div><h2 className="card-title" id="data-reset-title">Reset workspace data</h2><p className="card-subtitle">Clear saved finance records and start with an empty cashbook.</p></div><span className="status-chip status-danger">Permanent</span></div>
    <p className="data-reset-warning">This removes entries, balances and adjustments, movements, savings and loans, bills and payments, reconciliations, partner distributions, import history, and review flags. It also clears opening balances. This action cannot be undone.</p>
    <p className="muted-note">Your sign-in, workspace, memberships, roles, preferences, partner profiles, integration connections, duplicate-protection receipts, and audit history stay. Receipt links to deleted transactions are cleared, and failed webhook retries are suppressed. Connected systems can add new records after the reset completes.</p>
    {state?.latest?.status === "completed" && <p className="form-feedback form-success" role="status">Last reset removed {state.latest.deletedRecords.toLocaleString()} records. The reset event remains in the audit log.</p>}
    {state?.resetting ? <div className="data-reset-progress"><p className="form-feedback" role="status">Reset in progress. Finance entry is temporarily paused; this page will update when it completes.</p><p className="muted-note">If progress stops, you can resume from the saved reset cursor. This is safe if a previous batch is still finishing.</p><button className="button" type="button" onClick={() => void continueReset()} disabled={resuming}>{resuming ? "Resuming…" : "Resume reset"}</button></div> : <form className="data-reset-form" onSubmit={submit}>
      <label className="field" htmlFor="data-reset-confirm"><span>Type <strong>{state?.businessName ?? "your workspace name"}</strong> to confirm</span><input id="data-reset-confirm" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={!state || busy} /></label>
      <button className="button data-reset-button" type="submit" disabled={!state || busy || confirmation !== state.businessName}>{busy ? "Starting reset…" : "Reset all finance data"}</button>
    </form>}
    {error && <p className="form-feedback form-error" role="alert">{error}</p>}
  </section>;
}

function RulesReview() {
  const review = useQuery(api.settings.ruleReview, {});
  const settings = useQuery(api.settings.overview, {});
  const today = settings?.access === "ready" ? new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) : "";
  const monthStart = today ? `${today.slice(0, 7)}-01` : "";
  const monthEnd = today ? new Date(Date.parse(`${today}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10) : "";
  const targets = useQuery(api.settings.monthlyTargets, monthStart ? { from: monthStart, toExclusive: monthEnd } : "skip");
  if (!review || review.access !== "ready") return null;
  return <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Monthly targets · {monthStart}</h2><p className="card-subtitle">Month-to-date progress based on saved ledger totals.</p></div></div>{targets?.access === "ready" ? <div className="settings-facts"><div><span>Sales target</span><strong>{targets.salesTarget ? `${(targets.sales / 10 ** (settings?.access === "ready" ? settings.currencyMinorDigits : 0)).toLocaleString()} / ${(targets.salesTarget / 10 ** (settings?.access === "ready" ? settings.currencyMinorDigits : 0)).toLocaleString()} ${targets.currency}` : "No target set"}</strong></div><div><span>Expense warning</span><strong>{targets.expenseWarning ? `${(targets.expenses / 10 ** (settings?.access === "ready" ? settings.currencyMinorDigits : 0)).toLocaleString()} / ${(targets.expenseWarning / 10 ** (settings?.access === "ready" ? settings.currencyMinorDigits : 0)).toLocaleString()} ${targets.currency}` : "No warning set"}</strong></div></div> : <p className="muted-note">Loading current month totals…</p>}<div className="card-heading" style={{ marginTop: 18 }}><div><h3 className="card-title">Recent rule flags</h3><p className="card-subtitle">Recent posted expenses and sales days matched against the configured thresholds.</p></div></div>{review.highExpenses.length === 0 && review.weakDays.length === 0 ? <p className="muted-note">No recent records crossed these review thresholds.</p> : <ul className="settings-bullet-list">{review.highExpenses.map(e => <li key={e.id}><strong>Expense review · {e.date} · {e.amount.toLocaleString()} {review.currency} · {e.category}</strong>{e.note ? ` — ${e.note}` : " — no note"}</li>)}{review.weakDays.map(d => <li key={d.day}><strong>Low-sales day · {d.day} · {d.sales.toLocaleString()} {review.currency}</strong></li>)}</ul>}<p className="muted-note">These flags prompt a human review; they do not change or reject entries.</p></section>;
}

export function AccessSettings() {
  const [accessTab, setAccessTab] = useState<"members" | "roles">("members");
  const [pendingUsersCursor, setPendingUsersCursor] = useState<string | null>(null);
  const [pendingUsersPrevious, setPendingUsersPrevious] = useState<(string | null)[]>([]);
  const state = useQuery(api.settings.accessOverview, { pendingUsersPagination: { numItems: 50, cursor: pendingUsersCursor } });
  const activeAccessTab = state?.access === "ready" && !state.canViewMembers ? "roles" : accessTab;
  const makeInvite = useMutation(api.settings.invite);
  const revoke = useMutation(api.settings.revokeInvite);
  const updateMember = useMutation(api.settings.updateMember);
  const grant = useMutation(api.settings.grantPendingUser);
  const createRole = useMutation(api.settings.createRole);
  const updateRole = useMutation(api.settings.updateRole);
  const initializeRoleTemplates = useMutation(api.settings.initializeRoleTemplates);
  const [email, setEmail] = useState(""); const [selectedRole, setSelectedRole] = useState(""); const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [inviteUrl, setInviteUrl] = useState(""); const [feedback, setFeedback] = useState(""); const [busy, setBusy] = useState(false);
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<Record<string, string>>({}); const [memberPartnerDrafts, setMemberPartnerDrafts] = useState<Record<string, string>>({});
  const [roleName, setRoleName] = useState(""); const [roleDescription, setRoleDescription] = useState(""); const [rolePermissions, setRolePermissions] = useState<string[]>([]);
  const permissionGroups = [
    ["Workspace", [["dashboard.view", "View dashboard"], ["reports.view", "View financial reports"]]],
    ["Analytics and statements", [["analytics.view", "View analytics"], ["dailyReport.view", "View daily reports"], ["monthlyPnl.view", "View monthly profit and loss"]]],
    ["Sales", [["sales.view", "View sales"], ["sales.create", "Create sales"], ["sales.update", "Edit sales"], ["sales.void", "Void sales"]]],
    ["Expenses", [["expenses.view", "View expenses"], ["expenses.create", "Create expenses"], ["expenses.update", "Edit expenses"], ["expenses.void", "Void expenses"]]],
    ["Movements", [["movements.view", "View movements"], ["movements.create", "Create movements"], ["movements.update", "Edit movements"], ["movements.void", "Void movements"]]],
    ["Savings and loans", [["savings.view", "View savings"], ["savings.create", "Create savings"], ["savings.update", "Edit savings"], ["savings.delete", "Remove savings records"], ["loans.view", "View loans"], ["loans.create", "Create loans"], ["loans.update", "Edit loans"], ["loans.approve", "Approve loans"], ["loans.repay", "Record repayments"], ["loans.void", "Void loans"]]],
    ["Partners", [["partners.view", "View partners"], ["partners.manage", "Manage partners"], ["partners.distributions.manage", "Prepare and pay partner distributions"], ["partners.distributions.approve", "Approve partner distributions"]]],
    ["Bills and reconciliation", [["bills.view", "View bills"], ["bills.create", "Create bills"], ["bills.update", "Edit bills"], ["bills.pay", "Record bill payments"], ["bills.void", "Void bills"], ["reconcile.view", "View reconciliation"], ["reconcile.create", "Start reconciliation"], ["reconcile.resolve", "Resolve reconciliation differences"]]],
    ["Settings and data", [["settings.view", "View settings"], ["settings.update", "Edit settings"], ["data.export", "Export data"], ["imports.manage", "Import finance records"], ["integrations.manage", "Manage finance integrations"], ["balanceAdjustments.manage", "Manage counted balance adjustments"]]],
    ["Access and audit", [["access.view", "View users and access history"], ["access.manage", "Approve users and manage memberships"], ["roles.manage", "Manage roles"], ["audit.view", "View audit history"]]],
  ] as const;
  useEffect(() => { if (state?.access === "ready" && state.canInitializeRoleTemplates && (!state.roles.some(role => role.builtIn === "member") || state.roles.length < 4 || state.members.some(m => !m.roleId && m.role !== "owner"))) void initializeRoleTemplates({}); }, [state, initializeRoleTemplates]);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setFeedback(""); try { const token = await makeInvite({ email, roleId: selectedRole as never, ...(selectedPartnerId ? { partnerId: selectedPartnerId as never } : {}) }); const url = new URL(`/invite?token=${encodeURIComponent(token)}`, window.location.origin).toString(); setInviteUrl(url); setFeedback("Invitation created. Copy and send this link to the invited email address; no email has been sent automatically."); setEmail(""); setSelectedPartnerId(""); } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not create invitation."); } finally { setBusy(false); } }
  async function createRoleNow(e: FormEvent) { e.preventDefault(); setBusy(true); try { await createRole({ name: roleName, description: roleDescription, permissions: rolePermissions }); setRoleName(""); setRoleDescription(""); setRolePermissions([]); setFeedback("Role created."); } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not create role."); } finally { setBusy(false); } }
  if (!state || state.access !== "ready") return <p className="muted-note">Your role does not allow viewing or managing staff access.</p>;
  const assignableRoles = state.roles.filter(r => r.active && r.builtIn !== "owner");
  const roleFor = (id: string) => assignableRoles.find(r => r.id === id);
  return <div className="settings-stack staff-access-page">
    <nav className="staff-access-tabs" aria-label="Staff access sections">
      <button type="button" className={activeAccessTab === "members" ? "staff-access-tab-active" : ""} aria-pressed={activeAccessTab === "members"} onClick={() => setAccessTab("members")}><UsersRound size={15} />Members <span>{state.members.length}</span></button>
      <button type="button" className={activeAccessTab === "roles" ? "staff-access-tab-active" : ""} aria-pressed={activeAccessTab === "roles"} onClick={() => setAccessTab("roles")}><ShieldCheck size={15} />Roles <span>{state.roles.length}</span></button>
      {state.canViewAudit && <Link href="/audits"><ClipboardList size={15} />Audit log</Link>}
    </nav>
    {state.canManage && activeAccessTab === "members" && <div className="staff-add-action"><span>Manage active access, pending requests, and invitations.</span><Link className="button button-accent" href="#add-staff"><UsersRound size={15} />Add staff</Link></div>}
    {state.canManage && activeAccessTab === "members" && <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Accounts awaiting access review</h2><p className="card-subtitle">Eligible accounts join the single workspace automatically as read-only Members. Accounts listed here need owner review because their membership is inactive or their account cannot be matched to an email invitation.</p></div></div>{state.pendingUsers.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Account</th><th>Signed in</th><th>Assign role</th><th></th></tr></thead><tbody>{state.pendingUsers.map(user => <tr key={user.id}><td>{user.email}</td><td>{new Date(user.createdAt).toLocaleDateString()}</td><td><select aria-label={`Role for ${user.email}`} value={selectedRole} onChange={e => { setSelectedRole(e.target.value); setSelectedPartnerId(""); }}><option value="">Choose role</option>{assignableRoles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select>{roleFor(selectedRole)?.permissions.includes("partners.view") && <select aria-label={`Partner record for ${user.email}`} value={selectedPartnerId} onChange={e => setSelectedPartnerId(e.target.value)}><option value="">{roleFor(selectedRole)?.builtIn === "partner" ? "Choose linked partner" : "No linked partner"}</option>{state.partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select>}</td><td><button className="button button-accent" type="button" disabled={!selectedRole || roleFor(selectedRole)?.builtIn === "partner" && !selectedPartnerId} onClick={() => void grant({ userId: user.id, roleId: selectedRole as never, ...(selectedPartnerId ? { partnerId: selectedPartnerId as never } : {}) }).then(() => setFeedback(`Access granted to ${user.email}.`)).catch(e => setFeedback(e instanceof Error ? e.message : "Could not grant access."))}>Approve</button></td></tr>)}</tbody></table></div> : <p className="muted-note">No accounts need manual access review.</p>}<div className="form-actions">{pendingUsersPrevious.length > 0 && <button className="button" type="button" onClick={() => { const previous = pendingUsersPrevious.at(-1) ?? null; setPendingUsersPrevious(cursors => cursors.slice(0, -1)); setPendingUsersCursor(previous); }}>Previous accounts</button>}{!state.pendingUsersIsDone && <button className="button" type="button" disabled={!state.pendingUsersContinueCursor} onClick={() => { setPendingUsersPrevious(cursors => [...cursors, pendingUsersCursor]); setPendingUsersCursor(state.pendingUsersContinueCursor); }}>More accounts</button>}</div></section>}
    {state.canManage && activeAccessTab === "members" && <section id="add-staff" className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Add staff</h2><p className="card-subtitle">Invitations expire after seven days and can only be accepted by the invited account.</p></div></div><form className="form-layout" onSubmit={e => void submit(e)}><Field label="Account email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field><Field label="Role"><select value={selectedRole} onChange={e => { setSelectedRole(e.target.value); setSelectedPartnerId(""); }} required><option value="">Choose a role</option>{assignableRoles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field>{roleFor(selectedRole)?.permissions.includes("partners.view") && <Field label={roleFor(selectedRole)?.builtIn === "partner" ? "Linked partner" : "Linked partner (optional)"}><select value={selectedPartnerId} onChange={e => setSelectedPartnerId(e.target.value)} required={roleFor(selectedRole)?.builtIn === "partner"}><option value="">{roleFor(selectedRole)?.builtIn === "partner" ? "Choose partner" : "No linked partner"}</option>{state.partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select></Field>}<div className="form-actions"><button className="button button-accent" disabled={busy || !selectedRole || roleFor(selectedRole)?.builtIn === "partner" && !selectedPartnerId}>{busy ? "Creating…" : "Create invitation link"}</button></div></form>{inviteUrl && <div className="field field-full"><label htmlFor="invite-link">Private invitation link</label><div className="copy-row"><input id="invite-link" readOnly value={inviteUrl} onFocus={e => e.target.select()} /><button className="button" type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl)}>Copy link</button></div></div>}{feedback && <p className="muted-note" role="status">{feedback}</p>}</section>}
    {activeAccessTab === "roles" && <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Roles and permissions</h2><p className="card-subtitle">Create roles from specific feature and action permissions. Owner and dashboard-only Member roles are protected.</p></div></div>{state.canManageRoles && <details className="role-create-disclosure"><summary><span>Create a role</span><ChevronDown size={16} /></summary><form className="form-layout" onSubmit={e => void createRoleNow(e)}><Field label="Role name"><input value={roleName} onChange={e => setRoleName(e.target.value)} minLength={2} maxLength={50} required /></Field><Field label="Description"><input value={roleDescription} onChange={e => setRoleDescription(e.target.value)} maxLength={240} /></Field><div className="field field-full"><span className="field-label">Permissions</span><div className="settings-facts">{permissionGroups.map(([group, permissions]) => <details key={group} className="role-permission-disclosure"><summary>{group}<ChevronDown size={14} /></summary><fieldset className="role-permission-group"><legend>{group} permissions</legend>{permissions.map(([permission, label]) => <label key={permission} className="settings-toggle"><input type="checkbox" checked={rolePermissions.includes(permission)} onChange={e => setRolePermissions(old => e.target.checked ? [...old, permission] : old.filter(x => x !== permission))} /><span>{label}</span></label>)}</fieldset></details>)}</div></div><div className="form-actions"><button className="button button-accent" disabled={busy || !roleName.trim()}>Create role</button></div></form></details>}{feedback && <p className="muted-note" role="status">{feedback}</p>}<div className="staff-role-grid">{state.roles.map(role => <RoleCard key={role.id} role={role} canEdit={state.canManageRoles} updateRole={updateRole} />)}</div></section>}
    {activeAccessTab === "members" && <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Workspace members</h2><p className="card-subtitle">Each team member’s assigned permissions are checked on every request.</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Since</th><th>Access control</th></tr></thead><tbody>{state.members.map(m => {
      const currentRoleId = m.roleId ?? "";
      const roleId = memberRoleDrafts[m.id] ?? currentRoleId;
      const role = roleFor(roleId);
      const partnerId = memberPartnerDrafts[m.id] ?? m.partnerId ?? "";
      const changed = roleId !== currentRoleId || partnerId !== (m.partnerId ?? "");
      return <tr key={m.id}><td>{m.email}</td><td>{m.role}</td><td>{m.active ? "Active" : "Inactive"}</td><td>{new Date(m.createdAt).toLocaleDateString()}</td><td>{m.role === "owner" || !state.canManage ? "Protected" : <div className="member-controls"><select aria-label={`Role for ${m.email}`} value={roleId} onChange={e => { setMemberRoleDrafts(old => ({ ...old, [m.id]: e.target.value })); setMemberPartnerDrafts(old => ({ ...old, [m.id]: "" })); }}><option value="" disabled>Choose role</option>{assignableRoles.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select>{role?.permissions.includes("partners.view") && <select aria-label={`Linked partner for ${m.email}`} value={partnerId} onChange={e => setMemberPartnerDrafts(old => ({ ...old, [m.id]: e.target.value }))}><option value="">{role.builtIn === "partner" ? "Choose partner" : "No linked partner"}</option>{state.partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select>}{changed && <button className="button button-accent" type="button" disabled={role?.builtIn === "partner" && !partnerId} onClick={() => { if (!role) return; void updateMember({ membershipId: m.id, roleId: role.id as never, partnerId: partnerId ? partnerId as never : undefined, active: m.active }).then(() => { setMemberRoleDrafts(old => { const next = { ...old }; delete next[m.id]; return next; }); setMemberPartnerDrafts(old => { const next = { ...old }; delete next[m.id]; return next; }); setFeedback(`Updated access for ${m.email}.`); }).catch(error => setFeedback(error instanceof Error ? error.message : "Could not update member access.")); }}>Save access</button>}<button className="button" type="button" onClick={() => { const assigned = roleFor(currentRoleId); if (assigned) void updateMember({ membershipId: m.id, roleId: assigned.id as never, partnerId: m.partnerId ?? undefined, active: !m.active }).catch(error => setFeedback(error instanceof Error ? error.message : "Could not update member access.")); }}>{m.active ? "Deactivate" : "Reactivate"}</button></div>}</td></tr>;
    })}</tbody></table></div></section>}
    {activeAccessTab === "members" && <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Pending invitations</h2><p className="card-subtitle">Invite links are shown only once when created. Revoke and issue a fresh link if it is lost.</p></div></div>{state.invitations.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Email</th><th>Role</th><th>Expires</th><th></th></tr></thead><tbody>{state.invitations.map(i => <tr key={i.id}><td>{i.email}</td><td>{i.role}{i.partnerName ? ` · ${i.partnerName}` : ""}</td><td>{new Date(i.expiresAt).toLocaleString()}</td><td>{state.canManage && <button type="button" className="button" onClick={() => void revoke({ invitationId: i.id })}>Revoke</button>}</td></tr>)}</tbody></table></div> : <p className="muted-note">No pending invitations.</p>}</section>}
    {state.canViewAudit && activeAccessTab === "members" && <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Recent access audit</h2><p className="card-subtitle">Latest role, invitation, and settings changes.</p></div></div>{state.audit.length ? <ul className="settings-audit-list">{state.audit.map(a => <li key={a.id}><time>{new Date(a.occurredAt).toLocaleString()}</time><strong>{a.summary}</strong><span>{a.action}</span></li>)}</ul> : <p className="muted-note">No audit events yet.</p>}</section>}
  </div>;
}

function RoleCard({ role, canEdit, updateRole }: { role: { id: string; name: string; description: string; permissions: string[]; builtIn: string | null; active: boolean; memberCount: number }; canEdit: boolean; updateRole: ReturnType<typeof useMutation<typeof api.settings.updateRole>> }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [permissions, setPermissions] = useState(role.permissions);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const permissionGroups = [
    ["Workspace", ["dashboard.view", "reports.view"]],
    ["Analytics and reports", ["analytics.view", "dailyReport.view", "monthlyPnl.view"]],
    ["Sales", ["sales.view", "sales.create", "sales.update", "sales.void"]],
    ["Expenses", ["expenses.view", "expenses.create", "expenses.update", "expenses.void"]],
    ["Movements", ["movements.view", "movements.create", "movements.update", "movements.void"]],
    ["Savings and loans", ["savings.view", "savings.create", "savings.update", "savings.delete", "loans.view", "loans.create", "loans.update", "loans.approve", "loans.repay", "loans.void"]],
    ["Partners", ["partners.view", "partners.manage", "partners.distributions.manage", "partners.distributions.approve"]],
    ["Bills and reconciliation", ["bills.view", "bills.create", "bills.update", "bills.pay", "bills.void", "reconcile.view", "reconcile.create", "reconcile.resolve"]],
    ["Settings and data", ["settings.view", "settings.update", "data.export", "imports.manage", "integrations.manage", "balanceAdjustments.manage"]],
    ["Access and audit", ["access.view", "access.manage", "roles.manage", "audit.view"]],
  ] as const;
  async function save(active: boolean) {
    setBusy(true); setFeedback("");
    try { await updateRole({ roleId: role.id as never, name, description, permissions, active }); setFeedback("Role updated."); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Could not update this role."); }
    finally { setBusy(false); }
  }
  return <details className="staff-role-card">
    <summary className="staff-role-summary"><span><strong>{role.name}{role.builtIn ? ` · ${role.builtIn} template` : ""}</strong><small>{role.description || "No description"}</small></span><span className="staff-role-meta">{role.memberCount} members · {role.permissions.length} permissions<ChevronDown size={15} /></span></summary>
    <div className="staff-role-body">
      {!canEdit ? <p className="muted-note">This role is view-only for your account.</p> : <>
        <div className="form-layout"><Field label="Role name"><input value={name} disabled={role.builtIn === "owner" || role.builtIn === "member"} onChange={event => setName(event.target.value)} /></Field><Field label="Description"><input value={description} disabled={role.builtIn === "owner" || role.builtIn === "member"} onChange={event => setDescription(event.target.value)} /></Field></div>
        {role.builtIn !== "owner" && role.builtIn !== "member" && <div className="staff-permission-groups"><span className="field-label">Assigned permissions</span>{permissionGroups.map(([group, groupPermissions]) => {
          const selected = groupPermissions.filter(permission => permissions.includes(permission));
          return <details key={group} className="role-permission-disclosure"><summary>{group}<span>{selected.length}/{groupPermissions.length} selected</span><ChevronDown size={14} /></summary><div className="staff-permission-grid">{groupPermissions.map(permission => <label key={permission} className="settings-toggle"><input type="checkbox" checked={permissions.includes(permission)} onChange={event => setPermissions(old => event.target.checked ? [...old, permission] : old.filter(item => item !== permission))} /><span>{permission}</span></label>)}</div></details>;
        })}</div>}
        <div className="form-actions"><button type="button" className="button button-accent" disabled={busy || role.builtIn === "owner" || role.builtIn === "member"} onClick={() => void save(role.active)}>{busy ? "Saving…" : "Save role"}</button>{!role.builtIn && <button type="button" className="button" disabled={busy} onClick={() => void save(!role.active)}>{role.active ? "Deactivate role" : "Reactivate role"}</button>}{(role.builtIn === "owner" || role.builtIn === "member") && <span className="muted-note">{role.builtIn === "owner" ? "Owner access is protected." : "Member is protected and has dashboard-only access."}</span>}</div>
        {feedback && <p className="muted-note" role="status">{feedback}</p>}
      </>}
    </div>
  </details>;
}

function ReleaseSettings() {
  return <div className="settings-stack"><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Product updates</h2><p className="card-subtitle">See the latest product changes, fixes, and improvements.</p></div></div><p className="muted-note">Release notes are kept in one place so the updates shown here stay current with the workspace changelog.</p><Link className="button button-accent" href="/changelog">View What&apos;s new →</Link></section><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Service continuity</h2><p className="card-subtitle">Recovery options are managed by your workspace administrator.</p></div></div><p className="muted-note">Off-platform backups and one-click restore are not configured. Contact your administrator for service or recovery questions.</p></section></div>;
}
