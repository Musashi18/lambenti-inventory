"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MailboxActionResult = void | {
  scanned?: number;
  refreshed?: number;
  skippedManual?: number;
  sync?: {
    configured?: boolean;
    fetchedMessages?: number;
    imported?: number;
    duplicates?: number;
    trackingSaved?: number;
    trackingUpdated?: number;
    shipmentConfirmations?: number;
    portalCaptureTargetUrls?: number;
    portalCapturedSnapshots?: number;
    portalTrackingImported?: number;
    portalTrackingDuplicates?: number;
    errors?: string[];
  };
};

type MailboxAction = () => Promise<MailboxActionResult>;

type MailboxSyncButtonProps = {
  syncAction: MailboxAction;
  disabled?: boolean;
};

type ReassessRecentImportsButtonProps = {
  reassessAction: MailboxAction;
  disabled?: boolean;
};

export function MailboxSyncButton({ syncAction, disabled = false }: MailboxSyncButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSync() {
    setPending(true);
    setMessage(null);
    try {
      const result = await syncAction();
      router.refresh();
      window.location.reload();
      setMessage(describeMailboxSyncResult(result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mailbox sync failed. Check mailbox settings and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void handleSync()}
        disabled={disabled || pending}
        aria-busy={pending}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="inline-flex items-center gap-2">
          {pending ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : null}
          {pending ? "Syncing mailbox…" : "Sync mailbox now"}
        </span>
      </button>
      {message ? <p className="text-xs text-slate-600" role="status">{message}</p> : null}
    </div>
  );
}

export function ReassessRecentImportsButton({ reassessAction, disabled = false }: ReassessRecentImportsButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleReassess() {
    setPending(true);
    setMessage(null);
    try {
      const result = await reassessAction();
      router.refresh();
      window.location.reload();
      setMessage(describeReassessResult(result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reassessment failed. Refresh and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void handleReassess()}
        disabled={disabled || pending}
        aria-busy={pending}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="inline-flex items-center gap-2">
          {pending ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : null}
          {pending ? "Syncing & reassessing…" : "Sync & reassess recent imports"}
        </span>
      </button>
      {message ? <p className="text-xs text-slate-600" role="status">{message}</p> : null}
    </div>
  );
}

function describeMailboxSyncResult(result: MailboxActionResult) {
  if (!result || typeof result !== "object" || !result.sync) return "Mailbox sync complete. Recent imports were refreshed.";
  const sync = result.sync;
  if (!sync.configured) return "Mailbox is not configured.";
  const targeted = sync.portalCaptureTargetUrls && sync.portalCaptureTargetUrls > 0
    ? ` Targeted Alibaba capture checked ${sync.portalCaptureTargetUrls} order-detail link(s), captured ${sync.portalCapturedSnapshots ?? 0} portal snapshot(s), and imported ${sync.portalTrackingImported ?? 0} tracking evidence snapshot(s) (${sync.portalTrackingDuplicates ?? 0} duplicates/refreshed).`
    : "";
  const errorSummary = sync.errors?.length ? ` Sync notes: ${sync.errors.join("; ")}` : "";
  return `Mailbox checked (${sync.fetchedMessages ?? 0} fetched, ${sync.imported ?? 0} new, ${sync.duplicates ?? 0} refreshed/duplicates, ${sync.shipmentConfirmations ?? 0} shipment confirmation(s), ${sync.trackingSaved ?? 0} tracking saved, ${sync.trackingUpdated ?? 0} tracking updated).${targeted}${errorSummary}`;
}

function describeReassessResult(result: MailboxActionResult) {
  if (!result || typeof result !== "object") return "Recent imports reassessed with the latest multi-item parser.";
  const sync = result.sync;
  const syncSummary = sync?.configured
    ? `Mailbox checked (${sync.fetchedMessages ?? 0} fetched, ${sync.imported ?? 0} new, ${sync.duplicates ?? 0} refreshed/duplicates, ${sync.trackingSaved ?? 0} tracking saved, ${sync.trackingUpdated ?? 0} tracking updated).`
    : "Mailbox not configured; reassessed stored imports only.";
  const errorSummary = sync?.errors?.length ? ` Sync notes: ${sync.errors.join("; ")}` : "";
  return `${syncSummary} Reassessed ${result.scanned ?? 0} recent imports; updated ${result.refreshed ?? 0}; skipped ${result.skippedManual ?? 0} manually edited.${errorSummary}`;
}
