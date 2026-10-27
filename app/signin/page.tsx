"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export default function SignInPage() {
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function startGoogleSignIn() {
    setPending(true); setError("");
    try {
      const requested = new URLSearchParams(window.location.search).get("redirectTo") ?? "/dashboard";
      const redirectTo = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";
      await signIn("google", { redirectTo });
    }
    catch { setError("Google sign-in could not start. Please try again."); setPending(false); }
  }
  return <main className="signin-frame">
    <section className="card signin-card">
      <Link href="/" aria-label="MylesNet home"><Image className="signin-logo" src="/brand/logo.png" width={190} height={58} alt="MylesNet" priority /></Link>
      <div className="eyebrow">Finance workspace</div>
      <h1 className="page-title" style={{ marginTop: 8 }}>Sign in to MylesNet</h1>
      <p className="page-description" style={{ marginBottom: 22 }}>Use your invited Google account to access the finance tracker.</p>
      <button className="button" style={{ width: "100%", height: 44 }} type="button" onClick={() => void startGoogleSignIn()} disabled={pending}>
        <span className="google-mark" aria-hidden="true">G</span>{pending ? "Connecting to Google…" : "Continue with Google"}
      </button>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="muted-note" style={{ marginTop: 18, fontSize: 12 }}>Signing in does not grant finance access automatically. A workspace owner must invite your account.</p>
    </section>
  </main>;
}
