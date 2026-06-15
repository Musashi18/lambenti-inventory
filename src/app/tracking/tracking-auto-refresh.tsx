"use client";

import { useEffect, useRef, useState } from "react";

type TrackingAutoRefreshProps = {
  enabled: boolean;
  intervalMinutes: number;
};

export function TrackingAutoRefresh({ enabled, intervalMinutes }: TrackingAutoRefreshProps) {
  const [lastResult, setLastResult] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const intervalMs = Math.max(1, intervalMinutes) * 60_000;

    async function refreshDueTracking() {
      if (inFlight.current || document.visibilityState === "hidden") return;
      inFlight.current = true;
      try {
        const response = await fetch("/api/tracking/refresh", {
          method: "POST",
          headers: { "content-type": "application/json", "x-lambenti-agent-id": "tracking-page-auto-refresh" },
          body: JSON.stringify({ dueOnly: true, limit: 25 })
        });
        const body = await response.json().catch(() => null);
        setLastResult(response.ok ? `Auto refresh checked ${body?.scanned ?? 0} due numbers.` : `Auto refresh blocked: ${body?.error ?? response.statusText}`);
      } catch (error) {
        setLastResult(error instanceof Error ? error.message : "Auto refresh failed.");
      } finally {
        inFlight.current = false;
      }
    }

    const timer = window.setInterval(refreshDueTracking, intervalMs);
    void refreshDueTracking();
    return () => window.clearInterval(timer);
  }, [enabled, intervalMinutes]);

  if (!enabled) return null;
  return <p className="text-xs text-slate-500">Auto refresh is enabled while this page is open. {lastResult}</p>;
}
