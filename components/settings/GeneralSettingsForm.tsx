"use client";

import { useMutation, useQuery } from "convex/react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/convex/_generated/api";

export function GeneralSettingsForm() {
  const settings = useQuery(api.workspace.businessSettings, {});
  const updateSettings = useMutation(api.workspace.updateBusinessSettings);
  const [businessName, setBusinessName] = useState("");
  const [timezone, setTimezone] = useState("Africa/Kampala");
  const [weekStartsOn, setWeekStartsOn] = useState<"monday" | "sunday">("monday");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    if (settings?.access !== "ready") return;
    setBusinessName(settings.businessName);
    setTimezone(settings.timezone);
    setWeekStartsOn(settings.weekStartsOn);
  }, [settings]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      await updateSettings({ businessName, timezone, weekStartsOn });
      setFeedback({ message: "General settings saved.", error: false });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Could not save settings. Try again.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  if (settings === undefined) return <p className="muted-note" role="status">Loading workspace settings…</p>;
  if (settings.access === "setup") return <p className="muted-note">Set up the workspace owner before changing settings.</p>;
  if (settings.access === "pending") return <p className="muted-note">Your account needs an owner invitation before you can view workspace settings.</p>;

  const isOwner = settings.role === "owner";
  return (
    <div className="settings-stack">
      <section className="card settings-card" aria-labelledby="workspace-details-title">
        <div className="card-heading">
          <div>
            <h2 id="workspace-details-title" className="card-title">Workspace details</h2>
            <p className="card-subtitle">These details identify the business in the finance workspace.</p>
          </div>
        </div>
        <form className="form-layout" onSubmit={(event) => void submit(event)}>
          <div className="field field-full">
            <label htmlFor="settings-business-name">Business or workspace name</label>
            <input
              id="settings-business-name"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              minLength={2}
              maxLength={100}
              disabled={!isOwner || busy}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="settings-timezone">Reporting timezone</label>
            <input
              id="settings-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Africa/Kampala"
              maxLength={100}
              disabled={!isOwner || busy}
              required
            />
            <span className="muted-note">Use an IANA timezone, such as Africa/Kampala or Africa/Nairobi.</span>
          </div>
          <div className="field">
            <label htmlFor="settings-week-start">Week starts on</label>
            <select
              id="settings-week-start"
              value={weekStartsOn}
              onChange={(event) => setWeekStartsOn(event.target.value as "monday" | "sunday")}
              disabled={!isOwner || busy}
            >
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="settings-currency">Currency</label>
            <input id="settings-currency" value="UGX" readOnly aria-describedby="settings-currency-note" />
            <span id="settings-currency-note" className="muted-note">This cashbook currently stores whole Uganda shillings.</span>
          </div>
          {isOwner && <div className="form-actions">
            <button className="button button-accent" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save general settings"}
            </button>
            {feedback && <span className={`form-feedback ${feedback.error ? "form-error" : "form-success"}`} role="status">{feedback.message}</span>}
          </div>}
        </form>
        {!isOwner && <p className="muted-note settings-readonly-note">Only a workspace owner can change these settings.</p>}
      </section>

      <section className="card settings-card" aria-labelledby="reporting-period-title">
        <div className="card-heading">
          <div>
            <h2 id="reporting-period-title" className="card-title">Reporting period behavior</h2>
            <p className="card-subtitle">Reports use the selected timezone and week start when calculating business dates.</p>
          </div>
        </div>
        <p className="muted-note">Date ranges include the starting date and stop before the next period. This keeps adjacent reports from counting the same transaction twice.</p>
      </section>
    </div>
  );
}
