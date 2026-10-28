"use client";

import { useMutation, useQuery } from "convex/react";
import {
  Activity, ArrowDownUp, ArrowUpRight, BarChart3, Bell, CalendarDays, ChevronDown,
  ChevronsLeft, ChevronsRight, FileBarChart, HandCoins, LayoutDashboard,
  Menu, MessageCircle, Newspaper, PiggyBank, Receipt, Settings2, UsersRound, Wallet, X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AccountDrawer, ProfileAvatar } from "@/components/account/AccountDrawer";
import { AccountMenu } from "@/components/account/AccountMenu";
import { GlobalSearch } from "@/components/workspace/GlobalSearch";
import { api } from "@/convex/_generated/api";

type ChangelogSummary = { contentHash: string; totalChanges: number };
const changelogSeenKey = "mylesnet-changelog-seen-v1";

function readSeenChangelog() {
  try { return window.localStorage.getItem(changelogSeenKey); }
  catch { return null; }
}

function unreadChangelogCount(summary: ChangelogSummary, seenValue: string | null) {
  if (!seenValue) return summary.totalChanges;
  try {
    const seen = JSON.parse(seenValue) as Partial<ChangelogSummary> & { version?: string };
    const seenHash = seen.contentHash ?? (seen as unknown as { version?: string }).version;
    if (seenHash === summary.contentHash) return 0;
    return Math.max(summary.totalChanges - (seen.totalChanges ?? 0), 1);
  } catch {
    return summary.totalChanges;
  }
}

const navGroups = [
  { label: "Overview", items: [
    { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
    { label: "Analytics", href: "/analytics", icon: BarChart3, permission: "analytics.view" },
  ] },
  { label: "Cashbook", items: [
    { label: "Sales", href: "/sales", icon: Receipt, permission: "sales.view" },
    { label: "Expenses", href: "/expenses", icon: Wallet, permission: "expenses.view" },
    { label: "Movements", href: "/movements", icon: ArrowDownUp, permission: "movements.view" },
    { label: "Savings", href: "/savings", icon: PiggyBank, permission: "savings.view" },
    { label: "Loans", href: "/loans", icon: HandCoins, permission: "loans.view" },
    { label: "Bills", href: "/bills", icon: CalendarDays, permission: "bills.view" },
  ] },
  { label: "Reports", items: [
    { label: "Daily Report", href: "/daily-report", icon: Activity, permission: "dailyReport.view" },
    { label: "Monthly P&L", href: "/monthly-pnl", icon: FileBarChart, permission: "monthlyPnl.view" },
    { label: "Reconcile", href: "/reconcile", icon: ArrowDownUp, permission: "reconcile.view" },
  ] },
  { label: "Workspace", items: [
    { label: "Partners", href: "/partners", icon: UsersRound, permission: "partners.view" },
    { label: "Settings", href: "/settings/general", icon: Settings2, permission: "settings.view" },
  ] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const access = useQuery(api.workspace.currentAccess, {});
  const profile = useQuery(api.users.profile, {});
  const requestWorkspaceAccess = useMutation(api.settings.requestWorkspaceAccess);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [unreadChanges, setUnreadChanges] = useState(0);
  const [changelogSummary, setChangelogSummary] = useState<ChangelogSummary | null>(null);
  const changelogSummaryRef = useRef<ChangelogSummary | null>(null);
  const [accountReturnTo, setAccountReturnTo] = useState("/dashboard");
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  const accountLabel = access?.access === "ready" ? access.businessName : "My account";
  const sidebarWorkspaceLabel = /^MylesNet Finance Tracker$/i.test(accountLabel) ? "Finance" : accountLabel;
  const permissions = access?.access === "ready" ? access.permissions : [];
  useEffect(() => {
    let active = true;
    void fetch("/api/changelog/summary", { cache: "no-store" })
      .then(response => response.ok ? response.json() as Promise<ChangelogSummary> : null)
      .then(summary => {
        if (!active || !summary || typeof summary.contentHash !== "string" || !Number.isSafeInteger(summary.totalChanges)) return;
        changelogSummaryRef.current = summary;
        setChangelogSummary(summary);
        setUnreadChanges(unreadChangelogCount(summary, readSeenChangelog()));
      })
      .catch(() => {});
    const onStorage = (event: StorageEvent) => {
      const summary = changelogSummaryRef.current;
      if (event.key === changelogSeenKey && summary) setUnreadChanges(unreadChangelogCount(summary, event.newValue));
    };
    window.addEventListener("storage", onStorage);
    return () => { active = false; window.removeEventListener("storage", onStorage); };
  }, []);
  const markChangelogRead = useCallback(() => {
    const summary = changelogSummaryRef.current;
    if (!summary) return;
    try { window.localStorage.setItem(changelogSeenKey, JSON.stringify(summary)); }
    catch { /* The current tab still clears the badge when storage is unavailable. */ }
    setUnreadChanges(0);
  }, []);
  useEffect(() => {
    if (pathname === "/changelog" && changelogSummary) markChangelogRead();
  }, [changelogSummary, markChangelogRead, pathname]);
  useEffect(() => {
    if (access?.access === "pending") void requestWorkspaceAccess({}).catch(() => {});
  }, [access?.access, requestWorkspaceAccess]);
  const visibleNavGroups = navGroups.map(group => ({
    ...group,
    items: group.items.filter(item => access?.access !== "ready"
      ? item.href === "/dashboard"
      : permissions.includes(item.permission) || item.href === "/settings/general" && ["access.view", "roles.manage", "data.export"].some(permission => permissions.includes(permission))),
  })).filter(group => group.items.length > 0);
  const financeApproverOnly = access?.access === "ready" && access.permissions.includes("partners.distributions.approve") && !access.permissions.some(permission => ["dashboard.view", "analytics.view", "sales.view", "expenses.view", "movements.view", "savings.view", "loans.view", "dailyReport.view", "monthlyPnl.view", "bills.view", "reconcile.view", "settings.view"].includes(permission));
  const activePage = navGroups.flatMap(group => group.items).find(item => pathname === item.href || pathname.startsWith(`${item.href}/`));
  const settingsPageLabels: Record<string, string> = {
    general: "General settings", finance: "Finance settings", rules: "Rules",
    data: "Data", access: "Access", releases: "Releases",
  };
  const routePageLabel = pathname === "/account" ? "Your account" : pathname === "/staff/access" ? "Staff & access" : pathname === "/audits" ? "Audit log" : pathname === "/add-entry" ? "Add an entry" : activePage?.label
    ?? (pathname.startsWith("/settings/") ? settingsPageLabels[pathname.split("/")[2]] ?? "Settings" : undefined)
    ?? (pathname === "/issues" ? "Needs attention" : pathname === "/changelog" ? "What's new" : "Workspace");
  const closeAccount = useCallback(() => {
    router.replace(accountReturnTo === "/account" ? "/dashboard" : accountReturnTo);
  }, [accountReturnTo, router]);
  const closeAccountMenu = useCallback(() => setAccountMenuOpen(false), []);
  const openProfile = useCallback(() => {
    setAccountReturnTo(pathname);
    setAccountMenuOpen(false);
    router.push("/account");
  }, [pathname, router]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    if (!mobileOpen || !media.matches) return;
    const previousOverflow = document.body.style.overflow;
    const menuButton = menuButtonRef.current;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (event.key !== "Tab") return;
      const drawer = document.getElementById("workspace-sidebar");
      const focusable = drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawer?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const closeOnDesktop = (event: MediaQueryListEvent) => { if (!event.matches) setMobileOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    media.addEventListener("change", closeOnDesktop);
    sidebarCloseRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      media.removeEventListener("change", closeOnDesktop);
      if (media.matches) menuButton?.focus();
    };
  }, [mobileOpen]);

  return (
    <div className={`app-frame${collapsed ? " app-frame-collapsed" : ""}${mobileOpen ? " app-frame-menu-open" : ""}`}>
      <aside className="app-sidebar" id="workspace-sidebar" aria-label="Workspace sidebar" role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen || undefined}>
        <div className="sidebar-brand-row">
          <Link className="sidebar-brand" href="/dashboard" aria-label="MylesNet Finance home" onClick={() => setMobileOpen(false)}>
            <Image src="/brand/logo.png" width={174} height={52} alt="MylesNet" priority />
          </Link>
          <button className="sidebar-collapse-button" type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-pressed={collapsed} onClick={() => setCollapsed(value => !value)} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
          </button>
          <button ref={sidebarCloseRef} className="sidebar-mobile-close" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={19} /></button>
        </div>
        <div className="sidebar-workspace" aria-label={`Current workspace: ${accountLabel}`} title={accountLabel}>
          <span className="sidebar-workspace-mark" aria-hidden="true">M</span>
          <span className="sidebar-workspace-copy"><strong>{sidebarWorkspaceLabel}</strong></span>
        </div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {visibleNavGroups.map(group => <section className="sidebar-nav-group" key={group.label} aria-label={group.label}>
            <h2 className="sidebar-group-label">{group.label}</h2>
            {group.items.map(item => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link className={`sidebar-link${active ? " sidebar-link-active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined} onClick={() => setMobileOpen(false)}>
                <span className="sidebar-link-icon"><Icon size={18} strokeWidth={1.9} aria-hidden="true" /></span><span className="sidebar-link-label">{item.label}</span>
                {active && <span className="sidebar-active-indicator" aria-hidden="true" />}
              </Link>;
            })}
          </section>)}
        </nav>
        <div className="sidebar-bottom">
          <Link className={`sidebar-link sidebar-changelog-link${pathname === "/changelog" ? " sidebar-link-active" : ""}`} href="/changelog" aria-current={pathname === "/changelog" ? "page" : undefined} aria-label={unreadChanges ? `What's new, ${unreadChanges} unread changes` : "What's new"} title={collapsed ? "What's new" : undefined} onClick={() => { markChangelogRead(); setMobileOpen(false); }}>
            <span className="sidebar-link-icon"><Newspaper size={18} strokeWidth={1.9} aria-hidden="true" /></span><span className="sidebar-link-label">What&apos;s new</span>
            {unreadChanges > 0 && <span className="changelog-unread-count" aria-hidden="true">{unreadChanges > 99 ? "99+" : unreadChanges}</span>}
            {pathname === "/changelog" && <span className="sidebar-active-indicator" aria-hidden="true" />}
          </Link>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <div className="app-main-column">
      <header className="app-header">
        <button ref={menuButtonRef} className="button mobile-menu-button" type="button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="workspace-sidebar" onClick={() => setMobileOpen((open) => !open)}>
          {mobileOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
        <div className="topbar-page-context"><strong>{routePageLabel}</strong></div>
        <div className="topbar-center">
          {!financeApproverOnly && <GlobalSearch />}
        </div>
        <div className="header-actions">
          {!financeApproverOnly && permissions.includes("audit.view") && <Link className="utility-link" href="/issues" aria-label="Needs attention"><Bell size={17} /><span>Needs attention</span></Link>}
          <a className="topbar-support" href="https://wa.me/254743993715" target="_blank" rel="noopener noreferrer" aria-label="Contact support on WhatsApp" title="Contact support on WhatsApp"><MessageCircle size={15} aria-hidden="true" /><span>Support</span><ArrowUpRight size={13} aria-hidden="true" /></a>
          <button className="user-menu" type="button" aria-label="Open your account menu" aria-haspopup="dialog" aria-expanded={accountMenuOpen} title="Manage your account" onClick={() => setAccountMenuOpen(open => !open)}>
            <ProfileAvatar imageUrl={profile?.photoUrl} name={profile?.displayName || accountLabel} />
            <span className="user-menu-label">{profile?.displayName || accountLabel}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      {access?.access === "pending" && <div className="access-pending" role="status"><strong>Access awaiting invitation</strong><span>Your account is not yet linked to a MylesNet workspace.</span></div>}
      <main className="page-content">{children}</main>
      <footer className="app-footer"><span>Powered by <a href="https://mylescorptech.com" target="_blank" rel="noopener noreferrer">MylesCorp Technologies</a></span></footer>
      </div>
      {pathname === "/account" && <AccountDrawer onClose={closeAccount} />}
      {accountMenuOpen && <AccountMenu displayName={profile?.displayName || accountLabel} email={profile?.email} photoUrl={profile?.photoUrl} workspaceName={accountLabel} canManageStaff={permissions.includes("access.view") || permissions.includes("access.manage") || permissions.includes("roles.manage")} canViewAudit={permissions.includes("audit.view")} onClose={closeAccountMenu} onProfile={openProfile} />}
    </div>
  );
}

export function WorkspaceTitle({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-title-row"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1 className="page-title">{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action && <div className="page-title-action">{action}</div>}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}
