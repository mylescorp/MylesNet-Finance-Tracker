"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, LogOut, Settings2, UsersRound, UserRound } from "lucide-react";
import Link from "next/link";
import { ThemeControl } from "@/components/ThemeControl";
import { ProfileAvatar } from "@/components/account/AccountDrawer";

type Props = {
  displayName: string;
  email?: string;
  photoUrl?: string | null;
  workspaceName: string;
  canManageStaff: boolean;
  canViewAudit: boolean;
  onClose: () => void;
  onProfile: () => void;
};

export function AccountMenu({ displayName, email, photoUrl, workspaceName, canManageStaff, canViewAudit, onClose, onProfile }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const { signOut } = useAuthActions();
  const router = useRouter();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        document.querySelector<HTMLButtonElement>(".user-menu")?.focus();
        onClose();
      }
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".user-menu")) return;
      if (event.target instanceof Node && !panelRef.current?.contains(event.target)) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("mousedown", closeOnOutsideClick);
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, [onClose]);

  async function handleSignOut() {
    onClose();
    await signOut();
    router.replace("/signin");
  }

  return <aside className="account-menu-popover" ref={panelRef} role="dialog" aria-label="Account menu">
    <header className="account-menu-identity">
      <ProfileAvatar imageUrl={photoUrl} name={displayName} />
      <span><strong>{workspaceName}</strong><small>{email || displayName}</small></span>
    </header>
    <div className="account-menu-theme"><ThemeControl /></div>
    <nav className="account-menu-nav" aria-label="Account and workspace">
      <span className="account-menu-heading">Account</span>
      <Link href="/account" onClick={onProfile}><UserRound size={16} />Profile</Link>
      <span className="account-menu-heading">Workspace</span>
      <Link href="/settings/general" onClick={onClose}><Settings2 size={16} />Settings</Link>
      {canManageStaff && <Link href="/staff/access" onClick={onClose}><UsersRound size={16} />Staff</Link>}
      {canViewAudit && <Link href="/audits" onClick={onClose}><ClipboardList size={16} />Audit log</Link>}
    </nav>
    <footer className="account-menu-footer">
      <span className="account-menu-heading">Signed in as {displayName}</span>
      <button type="button" onClick={() => void handleSignOut()}><LogOut size={16} />Sign out</button>
    </footer>
  </aside>;
}
