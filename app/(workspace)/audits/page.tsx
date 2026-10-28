import { WorkspaceTitle } from "@/components/AppShell";
import { AuditLog } from "@/components/audit/AuditLog";

export default function AuditPage() {
  return <><WorkspaceTitle eyebrow="Workspace" title="Audit log" description="Review access, settings, and finance activity across this workspace." /><AuditLog /></>;
}
