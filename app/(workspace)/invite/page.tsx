import { WorkspaceTitle } from "@/components/AppShell";
import { InvitationAcceptance } from "@/components/settings/InvitationAcceptance";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <><WorkspaceTitle title="Accept invitation" description="Join the workspace using the account email the invitation was sent to." /><InvitationAcceptance token={token ?? ""} /></>;
}
