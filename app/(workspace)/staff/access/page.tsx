import { WorkspaceTitle } from "@/components/AppShell";
import { AccessSettings } from "@/components/settings/SettingsWorkspace";

export default function StaffAccessPage() {
  return <><WorkspaceTitle eyebrow="Workspace" title="Staff & access" description="Manage team members, invitations, and the roles that control workspace access." /><AccessSettings /></>;
}
