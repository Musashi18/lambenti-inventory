"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type MailboxAction = () => Promise<void>;

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
      await syncAction();
      router.refresh();
      window.location.reload();
      setMessage("Mailbox sync complete. Recent imports were refreshed.");
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
      await reassessAction();
      router.refresh();
      window.location.reload();
      setMessage("Recent imports reassessed with the latest multi-item parser.");
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
          {pending ? "Reassessing…" : "Reassess recent imports"}
        </span>
      </button>
      {message ? <p className="text-xs text-slate-600" role="status">{message}</p> : null}
    </div>
  );
}
