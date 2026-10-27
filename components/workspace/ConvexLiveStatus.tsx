"use client";

import { useConvexConnectionState } from "convex/react";

export function ConvexLiveStatus() {
  const connection = useConvexConnectionState();
  const connected = connection.isWebSocketConnected;
  const label = connected
    ? "Live · Convex synced"
    : connection.hasEverConnected
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
