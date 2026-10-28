"use client";

import { useConvexAuth } from "convex/react";
import { useCallback, useEffect } from "react";

export default function PwaAuthStateReporter() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  const reportState = useCallback((authenticated: boolean | null) => {
    if (!("serviceWorker" in navigator)) return;

    const message = { type: "PWA_AUTH_STATE", authenticated };
    navigator.serviceWorker.controller?.postMessage(message);
    void navigator.serviceWorker.ready.then((registration) => {
      registration.active?.postMessage(message);
    });
  }, []);

  useEffect(() => {
    reportState(isLoading ? null : isAuthenticated);
  }, [isAuthenticated, isLoading, reportState]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    function respondToStateRequest(event: MessageEvent<unknown>) {
      if (typeof event.data !== "object" || event.data === null ||
          !("type" in event.data) || event.data.type !== "PWA_AUTH_STATE_REQUEST") return;

      if (event.ports[0]) {
        event.ports[0].postMessage({ authenticated: isLoading ? null : isAuthenticated });
      }
    }

    navigator.serviceWorker.addEventListener("message", respondToStateRequest);
    return () => navigator.serviceWorker.removeEventListener("message", respondToStateRequest);
  }, [isAuthenticated, isLoading]);

  return null;
}
