"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import {
  Activity, ArrowDownUp, BarChart3, Bell, ChevronDown, FileBarChart,
  HandCoins, LayoutDashboard, LogOut, Menu, Receipt, Settings,
  Wallet, X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useState } from "react";
import { ThemeControl } from "@/components/ThemeControl";
import { GlobalSearch } from "@/components/workspace/GlobalSearch";
import { api } from "@/convex/_generated/api";

const nav = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.view" },
  { label: "Analytics", href: "/analytics", icon: BarChart3, permission: "analytics.view" },
  { label: "Sales", href: "/sales", icon: Receipt, permission: "sales.view" },
  { label: "Expenses", href: "/expenses", icon: Wallet, permission: "expenses.view" },
  { label: "Movements", href: "/movements", icon: ArrowDownUp, permission: "movements.view" },
  { label: "Savings", href: "/savings", icon: HandCoins, permission: "savings.view" },
  { label: "Loans", href: "/loans", icon: FileBarChart, permission: "loans.view" },
  { label: "Daily Report", href: "/daily-report", icon: Activity, permission: "dailyReport.view" },
  { label: "Monthly P&L", href: "/monthly-pnl", icon: FileBarChart, permission: "monthlyPnl.view" },
  { label: "Partners", href: "/partners", icon: HandCoins, permission: "partners.view" },
  { label: "Bills", href: "/bills", icon: Receipt, permission: "bills.view" },
  { label: "Reconcile", href: "/reconcile", icon: ArrowDownUp, permission: "reconcile.view" },
  { label: "Settings", href: "/settings/general", icon: Settings, permission: "settings.view" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { signOut } = useAuthActions();
  const access = useQuery(api.workspace.currentAccess, {});
  const context = useQuery(api.settings.runtimeContext, {});
  const [mobileOpen, setMobileOpen] = useState(false);
  const accountLabel = access?.access === "ready" ? access.businessName : "My account";
  const permissions = access?.access === "ready" ? access.permissions ?? [] : null;
  const visibleNav = nav.filter(item => {
    if (permissions === null) return item.href === "/dashboard";
    return permissions.includes(item.permission) || item.label === "Settings" && ["access.view", "roles.manage", "data.export"].some(p => permissions.includes(p));
  });

  return (
    <div className="app-frame">
      <header className="app-header">
        <Link className="brand-mark" href="/dashboard" aria-label="MylesNet home">
          <Image src="/brand/logo.png" width={174} height={52} alt="MylesNet" priority />
        </Link>
        <button className="button mobile-menu-button" type="button" aria-label={mobileOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileOpen} onClick={() => setMobileOpen((open) => !open)}>
          {mobileOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
        <div className="header-actions">
          <GlobalSearch />
          <ThemeControl />
          <Link className="utility-link" href="/issues" aria-label="Needs attention"><Bell size={17} /><span>Needs attention</span></Link>
          <button className="user-menu" type="button" aria-label="Sign out" title={`Sign out of ${accountLabel}`} onClick={() => void signOut()}>
            <span className="avatar">MN</span>
            <span className="user-menu-label">{accountLabel}</span>
            <LogOut size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <nav className={`primary-nav ${mobileOpen ? "primary-nav-open" : ""}`} aria-label="Main navigation">
        {visibleNav.map((item, index) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return <span className="nav-item-wrap" key={item.href}>
            {index === 7 && <span className="nav-divider" aria-hidden="true" />}
            <Link className={`nav-link ${active ? "nav-link-active" : ""}`} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}>
              <Icon size={15} strokeWidth={1.8} /><span>{item.label}</span>
            </Link>
          </span>;
        })}
        {access?.access === "ready" && (access.permissions.includes("sales.create") || access.permissions.includes("expenses.create")) && <Link className="button button-accent nav-add-entry" href={access.permissions.includes("sales.create") ? "/sales" : "/expenses"} onClick={() => setMobileOpen(false)}>+ Add entry <ChevronDown size={14} /></Link>}
      </nav>
      {access?.access === "pending" && <div className="access-pending" role="status"><strong>Workspace access pending</strong><span>Your account is signed in but has no active membership. A workspace owner can approve it or send you an invitation.</span></div>}
      <main className="page-content">{children}</main>
      <footer className="app-footer"><span>MylesNet Finance Tracker · {context?.access === "ready" ? context.currency : "UGX"}</span><span>Workspace data is protected by your assigned role.</span></footer>
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
