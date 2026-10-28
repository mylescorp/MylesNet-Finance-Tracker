import { notFound } from "next/navigation";
import { WorkspaceTitle } from "@/components/AppShell";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

const pages = {
  finance: { title: "Finance settings", description: "Configure cashbook categories, targets, and classification." },
  rules: { title: "Rules", description: "Set review thresholds, entry requirements, and data-quality checks." },
  data: { title: "Data and privacy", description: "Export records, review data quality, and inspect integration and backup readiness." },
  access: { title: "Access", description: "Approve users, assign workspace roles, and review permissions and access changes." },
  releases: { title: "Product updates", description: "Review improvements to your finance workspace and service continuity information." },
} as const;

export default async function SettingsPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params;
  if (!Object.hasOwn(pages, tab)) notFound();
  const page = pages[tab as keyof typeof pages];
  return <><WorkspaceTitle eyebrow="Settings" title={page.title} description={page.description} /><SettingsNav current={`/settings/${tab}`} /><SettingsWorkspace tab={tab as keyof typeof pages} /></>;
}
