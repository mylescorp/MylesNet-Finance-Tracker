"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation, useQuery } from "convex/react";
import { Camera, Check, ChevronRight, CircleUserRound, ExternalLink, LogOut, Mail, Phone, ShieldCheck, Sun, Upload, UserRound, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ThemeControl } from "@/components/ThemeControl";

type Props = { onClose: () => void };

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "MN";
}

export function ProfileAvatar({ imageUrl, name, size = "normal" }: { imageUrl?: string | null; name?: string; size?: "normal" | "large" }) {
  return <span className={`account-avatar account-avatar-${size}`} aria-hidden="true">
    {imageUrl ? <Image src={imageUrl} alt="" fill sizes={size === "large" ? "88px" : "38px"} unoptimized /> : initials(name ?? "")}
  </span>;
}

export function AccountDrawer({ onClose }: Props) {
  const profile = useQuery(api.users.profile, {});
  const saveProfile = useMutation(api.users.saveProfile);
  const uploadUrl = useMutation(api.users.generateProfilePhotoUploadUrl);
  const { signOut } = useAuthActions();
  const router = useRouter();
  const drawerRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState<string>();
  const [phoneDraft, setPhoneDraft] = useState<string>();
  const [photoUrlDraft, setPhotoUrlDraft] = useState<string | null>();
  const [photoId, setPhotoId] = useState<Id<"_storage"> | undefined>();
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [onClose]);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(""); setNotice("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError("Choose a JPEG, PNG, or WebP image under 5 MB."); return;
    }
    setBusy(true);
    try {
      const url = await uploadUrl({});
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("The photo could not be uploaded. Please try again.");
      const result = await response.json() as { storageId: Id<"_storage"> };
      setPhotoId(result.storageId);
      setPhotoUrlDraft(URL.createObjectURL(file));
      setRemovePhoto(false);
      setNotice("Photo ready. Save your profile to apply it.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The photo could not be uploaded.");
    } finally { setBusy(false); }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await saveProfile({ displayName: nameDraft ?? profile?.displayName ?? "", phone: phoneDraft ?? profile?.phone ?? "", photoId, removePhoto });
      setPhotoId(undefined); setRemovePhoto(false); setNotice("Your profile has been saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your profile could not be saved.");
    } finally { setBusy(false); }
  }

  async function handleSignOut() {
    setBusy(true);
    try { await signOut(); router.replace("/signin"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out. Try again."); setBusy(false); }
  }

  const name = nameDraft ?? profile?.displayName ?? "";
  const phone = phoneDraft ?? profile?.phone ?? "";
  const photoUrl = photoUrlDraft === undefined ? profile?.photoUrl ?? null : photoUrlDraft;
  const displayName = name.trim() || profile?.email?.split("@")[0] || "Your account";
  const activePhoto = removePhoto ? null : photoUrl;

  return <div className="account-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="account-drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="account-drawer-title">
      <header className="account-drawer-header">
        <div><span className="account-kicker">MYLESNET IDENTITY</span><h1 id="account-drawer-title">Your account</h1></div>
        <button className="account-close" type="button" onClick={onClose} aria-label="Close account drawer"><X size={19} /></button>
      </header>
      {profile === undefined ? <div className="account-loading" role="status">Loading your account…</div> : profile === null ? <div className="account-loading" role="status">Sign in to manage your account.</div> : <>
        <section className="account-identity-card">
          <div className="account-identity-glow" aria-hidden="true" />
          <div className="account-identity-main">
            <div className="account-photo-wrap"><ProfileAvatar imageUrl={activePhoto} name={displayName} size="large" /><button className="account-photo-edit" type="button" onClick={() => fileInputRef.current?.click()} aria-label="Change profile photo" disabled={busy}><Camera size={15} /></button></div>
            <div className="account-identity-copy"><h2>{displayName}</h2><p>{profile.email || "Google account"}</p></div>
          </div>
          <div className="account-identity-footer"><span><ShieldCheck size={14} /> Protected with Google sign-in</span><span className="account-connected"><i /> Connected</span></div>
        </section>

        <form className="account-form" onSubmit={handleSave}>
          <div className="account-section-heading"><div><span className="account-section-icon"><UserRound size={16} /></span><div><h2>Personal details</h2><p>How you appear across MylesNet</p></div></div></div>
          <label className="account-field"><span>Display name</span><span className="account-input-wrap"><UserRound size={16} /><input value={name} onChange={(event) => setNameDraft(event.target.value)} maxLength={80} autoComplete="name" required placeholder="Your name" /></span></label>
          <label className="account-field"><span>Email address <small>Google account</small></span><span className="account-input-wrap account-input-readonly"><Mail size={16} /><input value={profile.email} readOnly aria-readonly="true" /></span></label>
          <label className="account-field"><span>Phone number <small>Optional</small></span><span className="account-input-wrap"><Phone size={16} /><input type="tel" value={phone} onChange={(event) => setPhoneDraft(event.target.value)} maxLength={32} autoComplete="tel" placeholder="Add a contact number" /></span></label>
          <input ref={fileInputRef} className="account-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void handlePhotoChange(event)} aria-label="Upload profile photo" />
          <div className="account-photo-actions"><button type="button" className="account-upload-button" onClick={() => fileInputRef.current?.click()} disabled={busy}><Upload size={14} />{photoUrl && !removePhoto ? "Change photo" : "Add a profile photo"}</button>{photoUrl && !removePhoto && <button type="button" className="account-remove-photo" onClick={() => { setRemovePhoto(true); setPhotoId(undefined); setNotice("Photo will be removed when you save."); }} disabled={busy}>Remove</button>}<span>JPG, PNG or WebP · max 5 MB</span></div>
          {(notice || error) && <p className={`account-feedback${error ? " account-feedback-error" : ""}`} role={error ? "alert" : "status"}>{error || <><Check size={14} />{notice}</>}</p>}
          <button className="account-save-button" type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save changes"}<ChevronRight size={16} /></button>
        </form>

        <section className="account-preferences">
          <div className="account-section-heading"><div><span className="account-section-icon"><Sun size={16} /></span><div><h2>Appearance</h2><p>Choose the look that works for you</p></div></div><ThemeControl /></div>
        </section>
        <Link className="account-settings-link" href="/settings/general" onClick={onClose}><span className="account-section-icon"><CircleUserRound size={16} /></span><span><strong>Workspace settings</strong><small>Business details, currency and preferences</small></span><ExternalLink size={15} /></Link>
        <section className="account-security-row"><span className="account-section-icon"><ShieldCheck size={16} /></span><span><strong>Sign-in & security</strong><small>Authenticated with Google</small></span><span className="account-security-status">Secure</span></section>
        <footer className="account-drawer-footer"><span>Signed in as <strong>{profile.email}</strong></span><button type="button" className="account-signout" onClick={() => void handleSignOut()} disabled={busy}><LogOut size={16} />Sign out</button></footer>
      </>}
    </aside>
  </div>;
}
