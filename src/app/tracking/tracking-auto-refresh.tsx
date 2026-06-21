"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type TrackingProviderHeartbeatProps = {
  enabled: boolean;
  intervalMinutes: number;
  provider: string;
  initialNextRefreshAt?: Date | string | null;
  lastCheckedAt?: Date | string | null;
};

export function TrackingProviderHeartbeat({ enabled, intervalMinutes, provider, initialNextRefreshAt, lastCheckedAt }: TrackingProviderHeartbeatProps) {
  const router = useRouter();
  const intervalSeconds = Math.max(1, intervalMinutes) * 60;
  const propNextRefreshAtMs = useMemo(() => parseTime(initialNextRefreshAt), [initialNextRefreshAt]);
  const [nextRefreshAtMs, setNextRefreshAtMs] = useState<number | null>(propNextRefreshAtMs);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    setNextRefreshAtMs(propNextRefreshAtMs);
  }, [propNextRefreshAtMs]);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!enabled || nowMs === null || nextRefreshAtMs === null || nextRefreshAtMs > nowMs || inFlight.current || document.visibilityState === "hidden") return;
    inFlight.current = true;

    async function refreshDueTracking() {
      try {
        const response = await fetch("/api/tracking/refresh", {
          method: "POST",
          headers: { "content-type": "application/json", "x-lambenti-agent-id": "tracking-page-heartbeat" },
          body: JSON.stringify({ dueOnly: true, limit: 25 })
        });
        const body = await response.json().catch(() => null) as { scanned?: number; failed?: number; heartbeat?: { nextRefreshAt?: string | null } } | null;
        const nextFromServer = parseTime(body?.heartbeat?.nextRefreshAt ?? null);
        setNextRefreshAtMs(nextFromServer);
        setLastResult(response.ok || response.status === 207
          ? `Heartbeat checked ${body?.scanned ?? 0} due number(s); ${body?.failed ?? 0} failed.`
          : `Heartbeat blocked: ${response.statusText}`);
        router.refresh();
      } catch (error) {
        setNextRefreshAtMs(Date.now() + 60_000);
        setLastResult(error instanceof Error ? error.message : "Heartbeat refresh failed.");
      } finally {
        inFlight.current = false;
      }
    }

    void refreshDueTracking();
  }, [enabled, nextRefreshAtMs, nowMs, router]);

  const secondsUntilRefresh = enabled && nextRefreshAtMs !== null && nowMs !== null
    ? Math.max(0, Math.ceil((nextRefreshAtMs - nowMs) / 1000))
    : null;
  const elapsedSeconds = secondsUntilRefresh === null ? 0 : Math.max(0, intervalSeconds - Math.min(intervalSeconds, secondsUntilRefresh));
  const elapsedPercent = enabled && secondsUntilRefresh !== null ? Math.min(100, Math.max(0, (elapsedSeconds / intervalSeconds) * 100)) : 0;
  const remainingPercent = enabled && secondsUntilRefresh !== null ? Math.max(0, 100 - elapsedPercent) : 42;
  const ringColor = enabled ? "#34d399" : "#f59e0b";
  const ringBackground = `conic-gradient(${ringColor} 0 ${remainingPercent}%, rgba(148, 163, 184, 0.18) ${remainingPercent}% 100%)`;

  return (
    <div className="flex items-center gap-4">
      <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full p-1 transition-all duration-500" style={{ background: ringBackground }} aria-label="Provider heartbeat countdown ring">
        <div className="grid h-full w-full place-items-center rounded-full bg-white px-2 text-center text-slate-900">
          <div>
            <div className="text-xs font-semibold">{enabled ? "LIVE" : "SETUP"}</div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-500">{enabled ? formatCountdown(secondsUntilRefresh) : "—"}</div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Actual Refresh Heartbeat</div>
        <div className="mt-1 font-mono text-lg font-semibold text-slate-900">
          {enabled ? formatCountdown(secondsUntilRefresh) : "Not Scheduled"}
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${elapsedPercent}%` }} />
        </div>
        <div className="mt-2 text-xs leading-5 text-slate-500">
          {enabled
            ? `${provider} Countdown Is Anchored to Saved Tracking nextRefreshAt${lastCheckedAt ? `; Last Checked ${formatTimestamp(lastCheckedAt)}` : ""}.`
            : `Configure ${provider} Before Automatic Provider Updates Run.`}
          {lastResult ? <span className="block">{lastResult}</span> : null}
        </div>
      </div>
    </div>
  );
}

function parseTime(value: Date | string | null | undefined) {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function formatCountdown(totalSeconds: number | null) {
  if (totalSeconds === null) return "No open due";
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatTimestamp(value: Date | string) {
  const time = parseTime(value);
  return time === null ? "—" : new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(time));
}
