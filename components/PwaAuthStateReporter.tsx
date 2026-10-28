"use client";

import { useConvexAuth } from "@convex-dev/auth/react";
import { useEffect } from "react";

export default function PwaAuthStateReporter() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  useEffect(() => {
    if (isLoading || !("serviceWorker" in navigator)) return;

    const message = { type: "PWA_AUTH_STATE", authenticated: isAuthenticated };
    navigator.serviceWorker.controller?.postMessage(message);
    void navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage(message);
    });
  }, [isAuthenticated, isLoading]);

  return null;
}
