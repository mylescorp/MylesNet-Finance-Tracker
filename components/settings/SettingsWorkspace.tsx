"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Banknote, CircleAlert, Radio, Smartphone } from "lucide-react";
import { Children, cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { countries, getEmojiFlag } from "countries-list";
import { currencies } from "countries-list/currencies";
import timezoneData from "countries-and-timezones";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CsvImportPanel } from "./CsvImportPanel";
import { CentipidWebhookPanel } from "./CentipidWebhookPanel";
import { GoogleFormsPanel } from "./GoogleFormsPanel";

type Tab = "general" | "finance" | "rules" | "data" | "access" | "releases";
const localeOptions = ["en-UG", "sw-UG", "en-KE", "sw-KE", "en-TZ", "sw-TZ", "en-GB", "en-US", "fr-FR", "ar-SA", "hi-IN", "zh-CN", "pt-BR", "es-ES"];
const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, i, 1))));
function businessDayKey(timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export function SettingsWorkspace({ tab }: { tab: Tab }) {
  const overview = useQuery(api.settings.overview, {});
  if (overview === undefined) return <p className="muted-note" role="status">Loading workspace settings…</p>;
  if (overview.access === "restricted") return <p className="muted-note">Workspace settings are visible to owners only. Ask an owner if you need to change these details.</p>;
  if (overview.access !== "ready") return <p className="muted-note">Your account needs workspace access before settings can be loaded.</p>;
  if (tab === "data") return <DataSettings />;
  if (tab === "access") return <AccessSettings />;
  if (tab === "releases") return <ReleaseSettings />;
  if (tab === "rules") return <><EditableSettings tab={tab} settings={overview} /><RulesReview /></>;
  if (tab === "finance") return <><EditableSettings tab={tab} settings={overview} />{overview.role === "owner" ? <BalanceAdjustmentManager settings={overview} /> : <p className="muted-note settings-readonly-note">Only a workspace owner can record or manage counted balance adjustments.</p>}</>;
  return <EditableSettings tab={tab} settings={overview} />;
}

function EditableSettings({ tab, settings }: { tab: "general" | "finance" | "rules"; settings: SettingsOverview }) {
  const save = useMutation(api.settings.update);
  const isOwner = settings.role === "owner";
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
    try { settingsVersion.current = await save({ ...form, businessId: settings.businessId, expectedSettingsUpdatedAt: settingsVersion.current }); setFeedback({ message: `${thisTab} settings saved and added to the audit trail.`, error: false }); }
    catch (error) { setFeedback({ message: error instanceof Error ? error.message : "Could not save settings.", error: true }); }
    finally { setBusy(false); }
  }

  return <form className="settings-stack" onSubmit={e => void submit(e)}>
    {tab === "general" && <>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Workspace identity and region</h2><p className="card-subtitle">Regional defaults are used for business dates, reports, and new cashbook entries.</p></div></div>
        <div className="form-layout">
          <Field label="Business or workspace name"><input value={form.businessName} onChange={e => update("businessName", e.target.value)} minLength={2} maxLength={100} disabled={!isOwner} required /></Field>
          <Field label="Country or territory"><select value={form.countryCode} disabled={!isOwner} onChange={e => { const c = countryList.find(x => x.code === e.target.value); update("countryCode", e.target.value); const code = c?.currency.find(code => !currencies[code as keyof typeof currencies]?.withdrawn); if (code && !settings.currencyLocked) update("currency", code); const zones = timezoneData.getTimezonesForCountry(e.target.value); if (zones?.[0]) update("timezone", zones[0].name); const language = c?.languages[0]; const locale = language ? `${language}-${e.target.value}` : ""; if (localeOptions.includes(locale)) update("locale", locale); }}><option value="">Choose a country</option>{countryList.map(c => <option key={c.code} value={c.code}>{getEmojiFlag(c.code as keyof typeof countries)} {c.name}</option>)}</select></Field>
          <Field label="Business timezone"><select value={form.timezone} disabled={!isOwner} onChange={e => update("timezone", e.target.value)}>{(countryTimezones.includes(form.timezone) ? countryTimezones : [...countryTimezones, form.timezone]).map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")} · {offsetLabel(zone)}</option>)}<optgroup label="All global timezones">{allTimezones.filter(z => !countryTimezones.includes(z)).map(zone => <option key={zone} value={zone}>{zone.replaceAll("_", " ")} · {offsetLabel(zone)}</option>)}</optgroup></select><span className="muted-note">Time zones observe daylight saving changes when applicable.</span></Field>
          <Field label="Cashbook currency"><select value={form.currency} disabled={!isOwner || settings.currencyLocked} onChange={e => update("currency", e.target.value)}>{currencyCodes.map(code => <option key={code} value={code}>{code} · {currencyName(code)}</option>)}</select><span className="muted-note">{settings.currencyLocked ? "Currency is locked after an opening balance, cashbook entry, or operational record so saved amounts are never relabelled. A reviewed migration is required to change it." : "Currency can be changed until an opening balance or financial record is recorded."}</span></Field>
          <Field label="Display language and number format"><select value={form.locale} disabled={!isOwner} onChange={e => update("locale", e.target.value)}>{localeOptions.map(locale => <option key={locale}>{locale}</option>)}</select></Field>
          <Field label="Date format"><select value={form.dateFormat} disabled={!isOwner} onChange={e => update("dateFormat", e.target.value as typeof form.dateFormat)}><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option><option>YYYY-MM-DD</option></select></Field>
          <Field label="Week starts on"><select value={form.weekStartsOn} disabled={!isOwner} onChange={e => update("weekStartsOn", e.target.value as "monday" | "sunday")}><option value="monday">Monday</option><option value="sunday">Sunday</option></select></Field>
          <Field label="Financial year starts in"><select value={form.fiscalYearStartMonth} disabled={!isOwner} onChange={e => update("fiscalYearStartMonth", Number(e.target.value))}>{monthNames.map((month, i) => <option key={month} value={i + 1}>{month}</option>)}</select></Field>
        </div>
      </section>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Regional preview</h2><p className="card-subtitle">A quick check of the settings that affect saved records.</p></div></div><div className="settings-facts"><div><span>Business date</span><strong>{new Intl.DateTimeFormat(form.locale, { dateStyle: "full", timeZone: form.timezone }).format(new Date())}</strong></div><div><span>Time zone</span><strong>{form.timezone} · {offsetLabel(form.timezone)}</strong></div><div><span>Currency preview</span><strong>{moneyPreview(form.currency, form.locale)}</strong></div><div><span>Financial year</span><strong>{monthNames[form.fiscalYearStartMonth - 1]}–{monthNames[(form.fiscalYearStartMonth + 10) % 12]}</strong></div></div></section>
    </>}
    {tab === "finance" && <>
      <LiveBalancePanel settings={settings} />
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Cashbook categories</h2><p className="card-subtitle">One category per line. Categories are available to everyone who can record entries.</p></div></div><div className="form-layout"><Field label="Income categories"><textarea rows={7} value={form.incomeCategories.join("\n")} disabled={!isOwner} onChange={e => update("incomeCategories", e.target.value.split("\n"))} /></Field><Field label="Expense categories"><textarea rows={7} value={form.expenseCategories.join("\n")} disabled={!isOwner} onChange={e => update("expenseCategories", e.target.value.split("\n"))} /></Field></div></section>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Accounts and opening balances</h2><p className="card-subtitle">Set the starting cash and mobile money amounts before recording transactions.</p></div></div><div className="form-layout"><NumberField label="Opening cash balance" value={form.cashOpeningBalance} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!isOwner || settings.openingBalancesLocked} onChange={v => update("cashOpeningBalance", v)} /><NumberField label="Opening mobile money balance" value={form.mobileOpeningBalance} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!isOwner || settings.openingBalancesLocked} onChange={v => update("mobileOpeningBalance", v)} /></div>{settings.openingBalancesLocked && <p className="muted-note">Opening balances are locked after the first sale, expense, or account movement. Correct later differences with an auditable adjustment.</p>}</section>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Operating targets and cash alerts</h2><p className="card-subtitle">Targets help reports highlight exceptions. They do not create or change ledger entries. Set the cash alert to zero to turn it off.</p></div></div><div className="form-layout"><NumberField label="Monthly sales target" value={form.monthlySalesTargetUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!isOwner} onChange={v => update("monthlySalesTargetUgx", v)} /><NumberField label="Monthly expense warning" value={form.monthlyExpenseWarningUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!isOwner} onChange={v => update("monthlyExpenseWarningUgx", v)} /><NumberField label="Low cash alert threshold" value={form.lowCashAlertUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!isOwner} onChange={v => update("lowCashAlertUgx", v)} /></div></section>
    </>}
    {tab === "rules" && <>
      <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Review and quality rules</h2><p className="card-subtitle">Rules flag records for review. They never silently post, reject, or remove a transaction.</p></div></div><div className="form-layout"><NumberField label="Flag expenses at or above" value={form.highExpenseReviewUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!isOwner} onChange={v => update("highExpenseReviewUgx", v)} /><NumberField label="Flag days with sales below" value={form.weakDaySalesUgx} currency={settings.currency} scale={10 ** (settings.currencyMinorDigits ?? 0)} disabled={!isOwner} onChange={v => update("weakDaySalesUgx", v)} /><Field label="Duplicate review window (days)"><input type="number" min="0" max="30" step="1" value={form.duplicateWindowDays} disabled={!isOwner} onChange={e => update("duplicateWindowDays", Number(e.target.value))} /></Field><label className="settings-toggle"><input type="checkbox" checked={form.requireEntryNote} disabled={!isOwner} onChange={e => update("requireEntryNote", e.target.checked)} /><span><strong>Require a note on every entry</strong><small>Entries without a note are blocked by the server.</small></span></label><label className="settings-toggle"><input type="checkbox" checked={form.negativeBalanceWarning} disabled={!isOwner} onChange={e => update("negativeBalanceWarning", e.target.checked)} /><span><strong>Warn when a balance goes below zero</strong><small>Warnings do not block a correction or withdrawal.</small></span></label></div></section>
    </>}
    {isOwner && <div className="form-actions"><button className="button button-accent" disabled={busy}>{busy ? "Saving…" : `Save ${thisTab.toLowerCase()} settings`}</button>{feedback && <span className={`form-feedback ${feedback.error ? "form-error" : "form-success"}`} role="status">{feedback.message}</span>}</div>}
    {!isOwner && <p className="muted-note settings-readonly-note">Only a workspace owner can change these settings.</p>}
  </form>;
}

type SettingsOverview = Extract<NonNullable<ReturnType<typeof useQuery<typeof api.settings.overview>>>, { access: "ready" }>;
type AccessMember = { id: Id<"memberships">; role: string; partnerId?: Id<"partners">; partnerName?: string; active: boolean; email: string; emailVerified: boolean; createdAt: number };
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
    <div className="card-heading"><div><h2 className="card-title" id="live-balances-heading">Live balances and daily close</h2><p className="card-subtitle">Convex keeps these figures current as cashbook entries and Centipid events arrive.</p></div><span className="live-balance-indicator"><Radio size={14} aria-hidden="true" /> Live</span></div>
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
  return <div className="settings-stack"><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Export cashbook data</h2><p className="card-subtitle">Download up to 5,000 records as UTF-8 CSV for audit, backup, or analysis.</p></div></div><p className="muted-note">Exports include transaction date, category, account, amount, currency, note, source, state, and creation time. Voided records remain included for audit history.</p><div className="form-actions"><button className="button button-accent" type="button" onClick={download} disabled={!data || data.access !== "ready"}>Download CSV</button>{data?.access === "ready" && <span className="muted-note">{data.rows.length} records ready · {data.currency}</span>}{data?.access === "restricted" && <span className="muted-note">Only workspace owners can export cashbook data.</span>}</div>{notice && <p className="form-feedback form-success" role="status">{notice}</p>}</section>{data?.access === "ready" ? <><CsvImportPanel /><CentipidWebhookPanel /><GoogleFormsPanel /></> : <section className="card settings-card"><p className="muted-note">CSV imports and integration management are available to workspace owners only.</p></section>}<section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Backups</h2><p className="card-subtitle">Off-platform archives and one-click restore have not been configured.</p></div></div><p className="muted-note">Imports and exports are restricted to workspace owners and recorded in the audit trail.</p></section></div>;
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

function AccessSettings() {
  const state = useQuery(api.settings.accessOverview, {});
  const memberRows = usePaginatedQuery(api.settings.accessMembers, state?.access === "ready" ? {} : "skip", { initialNumItems: 20 });
  const invitationRows = usePaginatedQuery(api.settings.accessInvitations, state?.access === "ready" ? {} : "skip", { initialNumItems: 20 });
  const auditRows = usePaginatedQuery(api.settings.accessAudit, state?.access === "ready" ? {} : "skip", { initialNumItems: 20 });
  const makeInvite = useMutation(api.settings.invite);
  const revoke = useMutation(api.settings.revokeInvite);
  const updateMember = useMutation(api.settings.updateMember);
  const transferOwnership = useMutation(api.settings.transferOwnership);
  const [email, setEmail] = useState(""); const [role, setRole] = useState<"partner" | "cashier" | "finance_approver">("cashier"); const [partnerId, setPartnerId] = useState("");
  const [partnerSelections, setPartnerSelections] = useState<Record<string, string>>({});
  const [roleSelections, setRoleSelections] = useState<Record<string, "partner" | "cashier" | "finance_approver">>({});
  const [inviteUrl, setInviteUrl] = useState(""); const [feedback, setFeedback] = useState(""); const [busy, setBusy] = useState(false); const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); setFeedback(""); try { if (state?.access !== "ready") throw new Error("Workspace is still loading."); const token = await makeInvite({ businessId: state.businessId, email, role, partnerId: role === "partner" && partnerId ? partnerId as Id<"partners"> : undefined }); const url = new URL(`/invite?token=${encodeURIComponent(token)}`, window.location.origin).toString(); setInviteUrl(url); setFeedback("Invitation created. Copy and send this link to the invited email address; no email has been sent automatically."); setEmail(""); setPartnerId(""); } catch (error) { setFeedback(error instanceof Error ? error.message : "Could not create invitation."); } finally { setBusy(false); } }
  if (!state || state.access !== "ready") return <p className="muted-note">Access management is available to workspace owners.</p>;
  const businessId = state.businessId;
  async function changeMember(m: AccessMember, nextRole: "partner" | "cashier" | "finance_approver", nextActive: boolean, nextPartner?: string) {
    const previousSelection = partnerSelections[m.id];
    const linkedPartner = nextPartner ?? m.partnerId ?? "";
    if (nextRole === "partner" && nextActive && !linkedPartner) { setFeedback(`Choose a partner record for ${m.email} before enabling partner access.`); return; }
    setMemberBusyId(m.id); setFeedback("");
    try {
      await updateMember({ businessId, membershipId: m.id, role: nextRole, partnerId: nextRole === "partner" && linkedPartner ? linkedPartner as Id<"partners"> : undefined, active: nextActive });
      setPartnerSelections(current => ({ ...current, [m.id]: linkedPartner }));
    } catch (error) {
      setRoleSelections(current => ({ ...current, [m.id]: m.role as "partner" | "cashier" | "finance_approver" }));
      setPartnerSelections(current => { const next = { ...current }; if (previousSelection === undefined) delete next[m.id]; else next[m.id] = previousSelection; return next; });
      setFeedback(error instanceof Error ? error.message : `Could not update access for ${m.email}.`);
    } finally { setMemberBusyId(null); }
  }
  async function handoffOwnership(m: AccessMember) {
    const expectedEmail = window.prompt(`Type the verified member email to confirm ownership transfer to ${m.email}:`);
    if (expectedEmail === null) return;
    const reason = window.prompt("Reason for transferring workspace ownership (5 to 300 characters):");
    if (reason === null) return;
    setMemberBusyId(m.id); setFeedback("");
    try {
      await transferOwnership({ businessId, membershipId: m.id, expectedEmail, reason });
      setFeedback(`Ownership transferred to ${m.email}. Your access is now cashier.`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : `Could not transfer ownership to ${m.email}.`);
    } finally { setMemberBusyId(null); }
  }
  return <div className="settings-stack"><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Invite a teammate</h2><p className="card-subtitle">Invitations expire after seven days and can only be accepted by the invited Google account.</p></div></div><form className="form-layout" onSubmit={e => void submit(e)}><Field label="Google account email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></Field><Field label="Role"><select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="cashier">Cashier · record entries</option><option value="finance_approver">Finance approver · review and approve partner distributions</option><option value="partner">Partner · their own capital and payout statement</option></select></Field>{role === "partner" && <Field label="Partner record"><select value={partnerId} onChange={e => setPartnerId(e.target.value)} required><option value="">Choose a partner</option>{state.partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}<div className="form-actions"><button className="button button-accent" disabled={busy}>{busy ? "Creating…" : "Create invitation link"}</button></div></form>{role === "partner" && <p className="notice-banner notice-info">The linked account sees only its own ownership, capital, and distribution history.</p>}{role === "finance_approver" && <p className="notice-banner notice-warning">This role can review financial records and approve or reject distributions created by another person. It cannot prepare distributions, record payouts, or change workspace settings.</p>}{inviteUrl && <div className="field field-full"><label htmlFor="invite-link">Private invitation link</label><div className="copy-row"><input id="invite-link" readOnly value={inviteUrl} onFocus={e => e.target.select()} /><button className="button" type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl)}>Copy link</button></div></div>}{feedback && <p className="muted-note" role="status">{feedback}</p>}</section>
    <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Workspace members</h2><p className="card-subtitle">Roles are enforced by Convex on every business-data request. Ownership transfer requires a verified active member, typed email confirmation, and audit reason.</p></div></div>{feedback && <p className="form-feedback form-error" role="alert">{feedback}</p>}{memberRows.results.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Account</th><th>Role / partner</th><th>Status</th><th>Since</th><th>Access control</th></tr></thead><tbody>{memberRows.results.map(m => { const selectedPartner = partnerSelections[m.id] ?? m.partnerId ?? ""; const selectedRole = roleSelections[m.id] ?? m.role; const memberBusy = memberBusyId === m.id; return <tr key={m.id}><td>{m.email}{m.emailVerified ? " · verified" : " · unverified"}</td><td>{m.role}{m.partnerName ? ` · ${m.partnerName}` : ""}</td><td>{m.active ? "Active" : "Inactive"}</td><td>{new Date(m.createdAt).toLocaleDateString()}</td><td>{m.role === "owner" ? "Owner" : <div className="member-controls">{selectedRole === "partner" && <select aria-label={`Partner account for ${m.email}`} value={selectedPartner} disabled={memberBusy} onChange={e => { const value = e.target.value; setPartnerSelections(current => ({ ...current, [m.id]: value })); if (selectedRole === "partner" && m.active && value) void changeMember(m, "partner", true, value); }}><option value="">Choose partner</option>{state.partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}<select aria-label={`Role for ${m.email}`} value={selectedRole} disabled={memberBusy} onChange={e => { const nextRole = e.target.value as "partner" | "cashier" | "finance_approver"; setRoleSelections(current => ({ ...current, [m.id]: nextRole })); if (nextRole === "partner" && !selectedPartner && m.active) { setFeedback(`Choose a partner record for ${m.email} to complete this role change.`); return; } void changeMember(m, nextRole, m.active, nextRole === "partner" ? selectedPartner : undefined); }}><option value="partner">Partner</option><option value="cashier">Cashier</option><option value="finance_approver">Finance approver</option></select><button className="button" type="button" disabled={memberBusy} onClick={() => void changeMember(m, selectedRole, !m.active, selectedRole === "partner" ? selectedPartner : undefined)}>{memberBusy ? "Saving…" : m.active ? "Deactivate" : "Reactivate"}</button>{m.active && m.emailVerified && m.role !== "partner" && <button className="button" type="button" disabled={memberBusy} onClick={() => void handoffOwnership(m)}>{memberBusy ? "Saving…" : "Transfer ownership…"}</button>}</div>}</td></tr>; })}</tbody></table></div> : <p className="muted-note">No workspace members were returned.</p>}{memberRows.status === "CanLoadMore" && <button type="button" className="button" onClick={() => memberRows.loadMore(20)}>Load older members</button>}</section>
    <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Invitation history</h2><p className="card-subtitle">Pending, accepted, expired, and revoked invitations remain visible in this access history.</p></div></div>{invitationRows.results.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Email</th><th>Role / partner</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>{invitationRows.results.map(i => <tr key={i.id}><td>{i.email}</td><td>{i.role}{i.partnerName ? ` · ${i.partnerName}` : ""}</td><td>{new Date(i.expiresAt).toLocaleString()}</td><td>{i.status}</td><td>{i.active && !i.acceptedAt && <button type="button" className="button" onClick={() => void revoke({ businessId, invitationId: i.id })}>Revoke</button>}</td></tr>)}</tbody></table></div> : <p className="muted-note">No invitations have been recorded.</p>}{invitationRows.status === "CanLoadMore" && <button type="button" className="button" onClick={() => invitationRows.loadMore(20)}>Load older invitations</button>}</section>
    <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Recent access audit</h2><p className="card-subtitle">Latest role, invitation, and settings changes.</p></div></div>{auditRows.results.length ? <ul className="settings-audit-list">{auditRows.results.map(a => <li key={a.id}><time>{new Date(a.occurredAt).toLocaleString()}</time><strong>{a.summary}</strong><span>{a.action}</span></li>)}</ul> : <p className="muted-note">No audit events yet.</p>}{auditRows.status === "CanLoadMore" && <button type="button" className="button" onClick={() => auditRows.loadMore(20)}>Load older audit events</button>}</section></div>;
}

function ReleaseSettings() {
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";
  const commit = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return <div className="settings-stack"><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Current application release</h2><p className="card-subtitle">Deployment status is read from the environment where this app is running.</p></div></div><div className="settings-facts"><div><span>Application version</span><strong>{version}</strong></div><div><span>Build commit</span><strong>{commit ?? "Local or unavailable"}</strong></div><div><span>Release channel</span><strong>{process.env.NODE_ENV === "production" ? "Production" : "Preview / development"}</strong></div><div><span>Deployment management</span><strong>Vercel project dashboard</strong></div></div></section><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Release notes</h2><p className="card-subtitle">Changes in this release train.</p></div></div><ul className="settings-bullet-list"><li><strong>Workspace settings:</strong> regional defaults, full timezone picker, country and currency selection, audit-backed business rules.</li><li><strong>Finance controls:</strong> configurable income and expense categories with sales and expense targets.</li><li><strong>Data:</strong> owner-only cashbook CSV export with audit history preserved.</li><li><strong>Access:</strong> expiring email-bound invite links, role-aware membership, and access audit history.</li></ul></section><section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Production change controls</h2><p className="card-subtitle">A reviewed release is deployed through the connected Vercel project.</p></div></div><p className="muted-note">This screen is read-only by design. Rollback, database restore, feature flags, and automated backup verification require release infrastructure and recovery credentials; no in-app action will claim to perform them until configured.</p></section></div>;
}
