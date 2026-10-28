"use client";

import { Download, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const dismissalCookie = "__mylesnet_pwa_prompt";
const dismissalMaxAge = 7 * 24 * 60 * 60;

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && window.navigator.standalone === true);
}

function isIosSafari(): boolean {
  const agent = window.navigator.userAgent;
  const iosDevice = /iPad|iPhone|iPod/.test(agent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  return iosDevice && /Safari/.test(agent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(agent);
}

function promptWasDismissed(): boolean {
  return document.cookie.split(";").some((cookie) => cookie.trim().startsWith(`${dismissalCookie}=`));
}

function rememberDismissal(): void {
  // This preference is read by the install UI, so JavaScript must be able to access it; it contains no authentication data.
  document.cookie = `${dismissalCookie}=1; Max-Age=${dismissalMaxAge}; Path=/; SameSite=Lax; Secure`;
}

export default function PwaBootstrap({ brandName }: { brandName: string }) {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    }

    window.setTimeout(() => {
      setDismissed(promptWasDismissed());
      setShowIosHint(isIosSafari());
    }, 0);

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
      setShowIosHint(false);
    }

    function handleAppInstalled() {
      setInstallEvent(null);
      setShowIosHint(false);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "accepted") setShowIosHint(false);
  }

  function dismissPrompt() {
    rememberDismissal();
    setDismissed(true);
  }

  if (isStandalone() || dismissed) return null;

  if (installEvent) {
    return (
      <aside className="pwa-install-prompt" aria-label={`Install ${brandName}`}>
        <div className="pwa-install-copy"><strong>{brandName}</strong><span>Keep your workspace close at hand.</span></div>
        <button className="pwa-install-action" type="button" onClick={() => void installApp()}>
          <Download size={16} aria-hidden="true" /> Install app
        </button>
        <button className="pwa-install-dismiss" type="button" onClick={dismissPrompt} aria-label="Dismiss install suggestion"><X size={17} /></button>
      </aside>
    );
  }

  if (showIosHint) {
    return (
      <aside className="pwa-install-prompt" aria-label={`Add ${brandName} to your Home Screen`}>
        <div className="pwa-install-copy"><strong>Add to Home Screen</strong><span>Share &gt; Add to Home Screen</span></div>
        <Share2 className="pwa-ios-share-icon" size={20} aria-hidden="true" />
        <button className="pwa-install-dismiss" type="button" onClick={dismissPrompt} aria-label="Dismiss install suggestion"><X size={17} /></button>
      </aside>
    );
  }

  return null;
}
