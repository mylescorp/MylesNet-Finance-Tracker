"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";

export function InvitationAcceptance({ token }: { token: string }) {
  const accept = useMutation(api.settings.acceptInvite);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true); setMessage("");
    try { await accept({ token }); router.replace("/dashboard"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not accept this invitation."); }
    finally { setBusy(false); }
  }
  if (!token) return <p className="muted-note">This invite link is missing its secure token. Ask the workspace owner for a fresh invitation.</p>;
  if (isLoading) return <p className="muted-note" role="status">Checking your sign-in…</p>;
  if (!isAuthenticated) {
    const returnTo = `/invite?token=${encodeURIComponent(token)}`;
    return <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Sign in to continue</h2><p className="card-subtitle">Use the Google account this invitation was sent to. You will return here to accept it.</p></div></div><Link className="button button-accent" href={`/signin?redirectTo=${encodeURIComponent(returnTo)}`}>Sign in with Google</Link></section>;
  }
  return <section className="card settings-card"><div className="card-heading"><div><h2 className="card-title">Join a MylesNet workspace</h2><p className="card-subtitle">Sign in with the Google account that received the invitation, then accept it below.</p></div></div><button className="button button-accent" type="button" disabled={busy} onClick={() => void submit()}>{busy ? "Checking invitation…" : "Accept invitation"}</button>{message && <p className="form-feedback form-error" role="alert">{message}</p>}</section>;
}
