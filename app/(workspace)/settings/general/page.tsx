import { WorkspaceTitle } from "@/components/AppShell";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

export default function GeneralSettingsPage() {
  return <><WorkspaceTitle eyebrow="Settings" title="General settings" description="Set the workspace identity, country, timezone, currency, and reporting calendar." /><SettingsNav current="/settings/general" /><SettingsWorkspace tab="general" /></>;
}
