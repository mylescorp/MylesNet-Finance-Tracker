import Link from "next/link";
import { Card, WorkspaceTitle } from "@/components/AppShell";

const screens: Record<string, { title: string; section: string; description: string; source: string }> = {
  analytics: { title: "Analytics", section: "Reports", description: "Explore performance trends and compare reporting periods.", source: "02-Analytics" },
  movements: { title: "Movements", section: "Cashbook", description: "Track transfers between business accounts and external movements.", source: "05-Movements" },
  savings: { title: "Savings", section: "Cashbook", description: "Track savings goals, contributions and withdrawals.", source: "06-Savings" },
  loans: { title: "Loans", section: "Cashbook", description: "Track loan balances, repayments and interest assumptions.", source: "07-Loans" },
  "daily-report": { title: "Daily Report", section: "Reports", description: "Review recorded sales, expenses and activity for a selected day.", source: "08-Daily-Report" },
  "monthly-pnl": { title: "Monthly P&L", section: "Reports", description: "Review revenue, expenses and net operating result by month.", source: "09-Monthly-PnL" },
  partners: { title: "Partners", section: "Workspace", description: "Manage partner ownership and their cashbook views.", source: "10-Partners" },
  bills: { title: "Bills", section: "Cashbook", description: "Track upcoming business bills and payment status.", source: "11-Bills" },
  reconcile: { title: "Reconcile", section: "Controls", description: "Compare recorded transactions with cash and mobile money balances.", source: "12-Reconcile" },
  issues: { title: "Needs attention", section: "Controls", description: "Review unresolved data quality and reconciliation items.", source: "03-Settings-Rules" },
  "settings/general": { title: "General settings", section: "Settings", description: "Manage workspace name, locale and display preferences.", source: "13-Settings-General" },
  "settings/finance": { title: "Finance settings", section: "Settings", description: "Configure accounts, categories, currency and reporting rules.", source: "14-Settings-Finance" },
  "settings/rules": { title: "Rules", section: "Settings", description: "Set review thresholds and validation rules for the cashbook.", source: "15-Settings-Rules" },
  "settings/data": { title: "Data", section: "Settings", description: "Review imports, exports and backup status.", source: "16-Settings-Data" },
  "settings/access": { title: "Access", section: "Settings", description: "Manage invitations and workspace roles.", source: "17-Settings-Access" },
  "settings/releases": { title: "Releases", section: "Settings", description: "Review application version and release notes.", source: "18-Settings-Releases" },
};

const settingLinks = [
  ["General", "/settings/general"], ["Finance", "/settings/finance"],
  ["Rules", "/settings/rules"], ["Data", "/settings/data"],
  ["Access", "/settings/access"], ["Releases", "/settings/releases"],
];

export default async function WorkspaceScreen({ params }: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await params;
  const key = segments.join("/");
  const screen = screens[key];
  if (!screen) return <WorkspaceTitle eyebrow="MylesNet" title="Page not found" description="Choose a section from the navigation." />;
  const settings = key.startsWith("settings/");
  return <>
    <WorkspaceTitle eyebrow={screen.section} title={screen.title} description={screen.description} />
    {settings && <nav className="settings-links" aria-label="Settings sections">{settingLinks.map(([label, href]) => <Link key={href} href={href} aria-current={href === `/${key}` ? "page" : undefined}>{label}</Link>)}</nav>}
    <Card>
      <div className="eyebrow">Screen foundation · Board {screen.source}</div>
      <h2 className="card-title" style={{ marginTop: 10 }}>This workspace view is being connected to live records.</h2>
      <p className="muted-note">The approved board is kept in the project reference folder. This screen will use the same layout hierarchy and design tokens, with values sourced from authorized Convex queries.</p>
      <div className="settings-links" style={{ marginTop: 18 }}><Link href="/dashboard">Back to dashboard</Link>{key === "analytics" && <Link href="/sales">Record a sale</Link>}</div>
    </Card>
  </>;
}
