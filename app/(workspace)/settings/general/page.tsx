import { Card, WorkspaceTitle } from "@/components/AppShell";
import { GeneralSettingsForm } from "@/components/settings/GeneralSettingsForm";
import { SettingsNav } from "@/components/settings/SettingsNav";

export default function GeneralSettingsPage() {
  return <>
    <WorkspaceTitle eyebrow="Settings" title="General settings" description="Set the workspace identity and business calendar." />
    <SettingsNav current="/settings/general" />
    <GeneralSettingsForm />
    <Card className="settings-note-card">
      <h2 className="card-title">Other settings are coming next</h2>
      <p className="muted-note">Finance accounts and categories, cashbook rules, imports, backups, user access, and release controls are not configurable here yet.</p>
    </Card>
  </>;
}
