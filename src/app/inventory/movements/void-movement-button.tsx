"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { voidStockMovementAction } from "./actions";

export function VoidMovementButton({ movementId, disabled }: { movementId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || pending) return;

    const confirmed = window.confirm(
      "Delete this stock movement?\n\nFor audit safety this will not hard-delete the row. It creates a compensating reversal movement so inventory remains ledger-based and traceable."
    );
    if (!confirmed) return;

    setPending(true);
    try {
      await voidStockMovementAction(new FormData(event.currentTarget));
      router.refresh();
      window.location.reload();
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} aria-busy={pending}>
      <input type="hidden" name="movementId" value={movementId} />
      <button
        className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || pending}
        title={disabled ? "This movement is already a reversal or cannot be safely deleted." : "Delete by adding a compensating reversal movement"}
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
    </form>
  );
}
