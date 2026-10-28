"use client";

import { useMutation, useQuery } from "convex/react";
import {
  Activity, ArrowDownUp, BarChart3, Bell, CalendarDays, ChevronDown,
  ChevronsLeft, ChevronsRight, FileBarChart, HandCoins, LayoutDashboard,
  Menu, PiggyBank, Receipt, Settings2, UsersRound, Wallet, X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ThemeControl } from "@/components/ThemeControl";
import { AccountDrawer, ProfileAvatar } from "@/components/account/AccountDrawer";
import { AccountMenu } from "@/components/account/AccountMenu";
import { GlobalSearch } from "@/components/workspace/GlobalSearch";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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
  const selectWorkspace = useMutation(api.workspace.selectWorkspace);
  const businessSettings = useQuery(api.workspace.businessSettings, {});
  const profile = useQuery(api.users.profile, {});
  const requestWorkspaceAccess = useMutation(api.settings.requestWorkspaceAccess);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [accountReturnTo, setAccountReturnTo] = useState("/dashboard");
  const [workspaceError, setWorkspaceError] = useState("");
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  const accountLabel = access?.access === "ready" ? access.businessName : "My account";
  const permissions = access?.access === "ready" ? access.permissions : [];
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
    ?? (pathname === "/issues" ? "Needs attention" : "Workspace");
  const closeAccount = useCallback(() => {
    router.replace(accountReturnTo === "/account" ? "/dashboard" : accountReturnTo);
  }, [accountReturnTo, router]);
  async function changeWorkspace(businessId: string) {
    if (!businessId || access?.access !== "ready" || businessId === access.businessId) return;
    setSwitchingWorkspace(true); setWorkspaceError("");
    try { await selectWorkspace({ businessId: businessId as Id<"businesses"> }); }
    catch (error) { setWorkspaceError(error instanceof Error ? error.message : "Could not switch workspaces."); }
    finally { setSwitchingWorkspace(false); }
  }
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
          <span className="sidebar-workspace-copy"><strong>{accountLabel}</strong><small>FINANCE WORKSPACE</small></span>
          <ChevronDown className="sidebar-workspace-chevron" size={15} aria-hidden="true" />
        </div>
        {access?.access === "ready" && access.workspaces.length > 1 && <label className="workspace-switcher"><span>Switch workspace</span><select aria-label="Switch workspace" value={access.businessId} disabled={switchingWorkspace} onChange={event => void changeWorkspace(event.target.value)}>{access.workspaces.map(workspace => <option key={workspace.businessId} value={workspace.businessId}>{workspace.businessName} · {workspace.role.replaceAll("_", " ")}</option>)}</select></label>}
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
          <div className="sidebar-support"><span className="sidebar-support-dot" /><span><strong>Workspace protected</strong><small>Secure finance access</small></span></div>
        </div>
      </aside>
      {mobileOpen && <button className="sidebar-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <div className="app-main-column">
      <header className="app-header">
        <button ref={menuButtonRef} className="button mobile-menu-button" type="button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} aria-controls="workspace-sidebar" onClick={() => setMobileOpen((open) => !open)}>
          {mobileOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
        <div className="topbar-page-context"><span>MYLESNET</span><strong>{routePageLabel}</strong></div>
        <div className="header-actions">
          {!financeApproverOnly && <GlobalSearch />}
          <ThemeControl />
          {!financeApproverOnly && permissions.includes("audit.view") && <Link className="utility-link" href="/issues" aria-label="Needs attention"><Bell size={17} /><span>Needs attention</span></Link>}
          <button className="user-menu" type="button" aria-label="Open your account menu" aria-haspopup="dialog" aria-expanded={accountMenuOpen} title="Manage your account" onClick={() => setAccountMenuOpen(open => !open)}>
            <ProfileAvatar imageUrl={profile?.photoUrl} name={profile?.displayName || accountLabel} />
            <span className="user-menu-label">{profile?.displayName || accountLabel}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      {access?.access === "pending" && <div className="access-pending" role="status"><strong>Access awaiting invitation</strong><span>Your account is not yet linked to a MylesNet workspace.</span></div>}
      {access?.access === "choose_workspace" && <section className="access-pending workspace-choice" role="status"><strong>Choose a workspace</strong><span>Your account has access to more than one workspace. Select which workspace to open.</span>{workspaceError && <span role="alert">{workspaceError}</span>}{access.workspaces.map(workspace => <button key={workspace.businessId} className="button" type="button" disabled={switchingWorkspace} onClick={() => { setSwitchingWorkspace(true); setWorkspaceError(""); void selectWorkspace({ businessId: workspace.businessId }).catch(error => setWorkspaceError(error instanceof Error ? error.message : "Could not open this workspace.")).finally(() => setSwitchingWorkspace(false)); }}><strong>{workspace.businessName}</strong><span>{workspace.role.replaceAll("_", " ")}</span></button>)}</section>}
      <main key={access?.access === "ready" ? access.businessId : access?.access ?? "loading"} className="page-content">{access?.access === "choose_workspace" ? null : children}</main>
      <footer className="app-footer"><span>MylesNet Finance Tracker · {businessSettings?.access === "ready" ? businessSettings.currency : "UGX"}</span><span>Workspace data is protected by your assigned role.</span></footer>
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
