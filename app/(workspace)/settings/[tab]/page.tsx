import { notFound } from "next/navigation";
import { WorkspaceTitle } from "@/components/AppShell";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

const pages = {
  finance: { title: "Finance settings", description: "Configure cashbook categories, targets, and classification." },
  rules: { title: "Rules", description: "Set review thresholds, entry requirements, and data-quality checks." },
  data: { title: "Data and privacy", description: "Export records, review data quality, and inspect integration and backup readiness." },
  access: { title: "Access", description: "Invite teammates and review workspace roles and access changes." },
  releases: { title: "Releases", description: "Review the running application version and verified release notes." },
} as const;

export default async function SettingsPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!(tab in pages)) notFound();
  const page = pages[tab as keyof typeof pages];
  return <><WorkspaceTitle eyebrow="Settings" title={page.title} description={page.description} /><SettingsNav current={`/settings/${tab}`} /><SettingsWorkspace tab={tab as keyof typeof pages} /></>;
}
