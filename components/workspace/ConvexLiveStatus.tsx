"use client";

import { useConvexConnectionState } from "convex/react";
import { useSyncExternalStore } from "react";

export function ConvexLiveStatus() {
  const connection = useConvexConnectionState();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const connected = mounted && connection.isWebSocketConnected;
  const label = connected
    ? "Live · Convex synced"
    : mounted && connection.hasEverConnected
      ? "Reconnecting to live data…"
      : "Connecting to live data…";

  return (
    <span
      className={`status-chip ${connected ? "status-live" : "status-live status-live-pending"}`}
      role="status"
      aria-live="polite"
    >
      {label}
    </span>
  );
}
