"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

const STORAGE_PREFIX = "lambenti:tracking-data-read-signature";

type TrackingDataDisclosureProps = {
  trackingId: string;
  trackingNumber: string;
  eventCount: number;
  latestEventMarker: string | null;
  compact?: boolean;
  children: ReactNode;
};

export function TrackingDataDisclosure({
  trackingId,
  trackingNumber,
  eventCount,
  latestEventMarker,
  compact = false,
  children
}: TrackingDataDisclosureProps) {
  const summaryLabelId = useId();
  const storageKey = `${STORAGE_PREFIX}:${trackingId}`;
  const signature = useMemo(
    () => [eventCount, latestEventMarker ?? "none"].join("|"),
    [eventCount, latestEventMarker]
  );
  const hasTrackingData = eventCount > 0;
  const [unread, setUnread] = useState(hasTrackingData);

  useEffect(() => {
    if (!hasTrackingData) {
      setUnread(false);
      return;
    }

    try {
      setUnread(window.localStorage.getItem(storageKey) !== signature);
    } catch {
      setUnread(true);
    }
  }, [hasTrackingData, signature, storageKey]);

  function markTrackingDataRead() {
    if (!hasTrackingData) return;
    try {
      window.localStorage.setItem(storageKey, signature);
    } catch {
      // Private browsing or locked-down storage should not block expanding the tracking record.
    }
    setUnread(false);
  }

  return (
    <details
      className={compact ? "mt-0" : "mt-4 rounded-lg border border-slate-200 bg-slate-50"}
      onToggle={(event) => {
        if (event.currentTarget.open) markTrackingDataRead();
      }}
    >
      <summary aria-labelledby={summaryLabelId} className="cursor-pointer list-none p-3 marker:hidden">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div id={summaryLabelId} className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
              <span>Tracking Data</span>
              <TrackingUnreadIndicator active={unread} hasTrackingData={hasTrackingData} trackingNumber={trackingNumber} />
            </div>
            <div className="text-xs text-slate-500">Package movements first; technical details are nested below.</div>
          </div>
          <span className={`rounded-full border px-2 py-1 text-xs font-medium ${unread ? "border-orange-300 bg-orange-50 text-orange-800" : "border-slate-200 bg-white text-slate-600"}`}>
            {unread ? "Expand to review" : "Expand Tracking Data"} · {eventCount} Event{eventCount === 1 ? "" : "s"}
          </span>
        </div>
      </summary>
      <div className={`${compact ? "" : "border-t border-slate-200"} space-y-4 p-3`}>
        {children}
      </div>
    </details>
  );
}

function TrackingUnreadIndicator({ active, hasTrackingData, trackingNumber }: { active: boolean; hasTrackingData: boolean; trackingNumber: string }) {
  if (!hasTrackingData) {
    return (
      <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        No Data Yet
      </span>
    );
  }

  return (
    <span
      aria-label={active ? `Unread tracking data for ${trackingNumber}; expand Tracking Data to review` : `Tracking data reviewed for ${trackingNumber}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${active ? "border-orange-300 bg-orange-100 text-orange-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-orange-500" : "bg-emerald-500"}`} aria-hidden="true" />
      {active ? "Unread" : "Reviewed"}
    </span>
  );
}
