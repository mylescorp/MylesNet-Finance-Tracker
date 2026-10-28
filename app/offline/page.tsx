import { WifiOff } from "lucide-react";
import { pwaBrand } from "@/lib/pwa-brand";

export default function OfflinePage() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: `var(--mn-bg, ${pwaBrand.backgroundColor})` }}>
      <section aria-labelledby="offline-title" style={{ width: "min(440px, 100%)", padding: 32, border: "1px solid var(--mn-line, #E8E8E5)", borderRadius: 14, background: "var(--mn-card, #FFFFFF)", textAlign: "center" }}>
        <div aria-hidden="true" style={{ display: "grid", width: 56, height: 56, margin: "0 auto 20px", placeItems: "center", borderRadius: 16, color: `var(--mn-accent, ${pwaBrand.themeColor})`, background: "var(--mn-accent-bg, #FBEEE3)" }}><WifiOff size={28} /></div>
        <p style={{ color: `var(--mn-accent, ${pwaBrand.themeColor})`, fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase" }}>{pwaBrand.shortName}</p>
        <h1 id="offline-title" style={{ margin: "8px 0", fontSize: 34, fontWeight: 400 }}>You’re offline</h1>
        <p style={{ margin: "0 0 20px", color: "var(--mn-muted, #6B6B68)", lineHeight: 1.6 }}>Your finance workspace will be ready as soon as your connection returns.</p>
        <form action="/dashboard" method="get">
          <button type="submit" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 40, padding: "0 16px", border: 0, borderRadius: 8, color: "var(--mn-on-accent, #FFFFFF)", background: `var(--mn-accent, ${pwaBrand.themeColor})`, font: "inherit", cursor: "pointer" }}>
            Retry
          </button>
        </form>
      </section>
    </main>
  );
}
