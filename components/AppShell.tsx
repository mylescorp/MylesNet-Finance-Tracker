"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import {
  Activity, ArrowDownUp, BarChart3, Bell, ChevronDown, FileBarChart,
  HandCoins, LayoutDashboard, LogOut, Menu, Receipt, Search, Settings,
  Wallet, X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useState } from "react";
import { api } from "@/convex/_generated/api";

const nav = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Analytics", href: "/analytics", icon: BarChart3 },
  { label: "Sales", href: "/sales", icon: Receipt },
  { label: "Expenses", href: "/expenses", icon: Wallet },
  { label: "Movements", href: "/movements", icon: ArrowDownUp },
  { label: "Savings", href: "/savings", icon: HandCoins },
  { label: "Loans", href: "/loans", icon: FileBarChart },
  { label: "Daily Report", href: "/daily-report", icon: Activity },
  { label: "Monthly P&L", href: "/monthly-pnl", icon: FileBarChart },
  { label: "Partners", href: "/partners", icon: HandCoins },
  { label: "Bills", href: "/bills", icon: Receipt },
  { label: "Reconcile", href: "/reconcile", icon: ArrowDownUp },
  { label: "Settings", href: "/settings/general", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { signOut } = useAuthActions();
  const access = useQuery(api.workspace.currentAccess, {});
  const [mobileOpen, setMobileOpen] = useState(false);
  const accountLabel = access?.access === "ready" ? access.businessName : "My account";

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
          <div className="search-box" role="search">
            <Search size={16} aria-hidden="true" />
            <input aria-label="Search" placeholder="Search entries, partners and bills" disabled />
            <kbd>/</kbd>
          </div>
          <Link className="utility-link" href="/issues" aria-label="Needs attention"><Bell size={17} /><span>Needs attention</span></Link>
          <button className="user-menu" type="button" aria-label="Sign out" title={`Sign out of ${accountLabel}`} onClick={() => void signOut()}>
            <span className="avatar">MN</span>
            <span className="user-menu-label">{accountLabel}</span>
            <LogOut size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <nav className={`primary-nav ${mobileOpen ? "primary-nav-open" : ""}`} aria-label="Main navigation">
        {nav.map((item, index) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return <span className="nav-item-wrap" key={item.href}>
            {index === 7 && <span className="nav-divider" aria-hidden="true" />}
            <Link className={`nav-link ${active ? "nav-link-active" : ""}`} href={item.href} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}>
              <Icon size={15} strokeWidth={1.8} /><span>{item.label}</span>
            </Link>
          </span>;
        })}
        <Link className="button button-accent nav-add-entry" href="/sales" onClick={() => setMobileOpen(false)}>+ Add entry <ChevronDown size={14} /></Link>
      </nav>
      {access?.access === "pending" && <div className="access-pending" role="status"><strong>Access awaiting invitation</strong><span>This Google account is signed in but is not yet linked to a MylesNet workspace.</span></div>}
      <main className="page-content">{children}</main>
      <footer className="app-footer"><span>MylesNet Finance Tracker · UGX</span><span>Workspace data is protected by your assigned role.</span></footer>
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
