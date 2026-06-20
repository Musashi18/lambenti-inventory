"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { importItemsCsvFormAction } from "./actions";
import type { ItemActionState } from "./actions";

const initialImportState: ItemActionState = { ok: false, message: "" };

export function ItemImportExportPanel({
  exportCsv,
  defaultStorageLocationId
}: {
  exportCsv: string;
  defaultStorageLocationId?: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(importItemsCsvFormAction, initialImportState);

  useEffect(() => {
    if (!state.ok) return;
    router.refresh();
    window.location.reload();
  }, [router, state.ok, state.message]);

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div>
            <h2 className="font-medium">CSV Import / Export</h2>
            <p className="text-sm text-slate-500">Collapsed by Default. Open Only When You Need Bulk Item Master Data Movement.</p>
          </div>
          <span className="text-sm font-medium text-ink group-open:hidden">Open</span>
          <span className="hidden text-sm font-medium text-ink group-open:inline">Close</span>
        </summary>
        <div className="grid gap-4 border-t border-slate-200 p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div>
              <h3 className="font-medium">Export CSV</h3>
              <p className="text-sm text-slate-500">Copy the current item master data with stable import-compatible headers.</p>
            </div>
            <textarea
              readOnly
              className="h-48 w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-xs"
              value={exportCsv}
            />
          </div>

          <form action={formAction} className="space-y-3">
            <div>
              <h3 className="font-medium">Import CSV</h3>
              <p className="text-sm text-slate-500">Validated all at once before mutation; invalid rows prevent the entire import.</p>
            </div>
            {defaultStorageLocationId ? (
              <input type="hidden" name="storageLocationId" value={defaultStorageLocationId} />
            ) : null}
            <textarea
              name="csv"
              className="h-48 w-full rounded-md border border-slate-300 p-3 font-mono text-xs"
              placeholder="sku,description,category,unit,reorderPoint,targetStock,leadTimeDays,lifecycleStatus,costCurrency"
              required
            />
            <button
              disabled={pending || !defaultStorageLocationId}
              className="rounded-md bg-ink px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Importing…" : "Validate and Import CSV"}
            </button>
            {!defaultStorageLocationId ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Add an internal storage location before importing items.
              </p>
            ) : null}
            {state.message ? (
              <p className={`rounded-md border px-3 py-2 text-sm ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                {state.message}
              </p>
            ) : null}
          </form>
        </div>
      </details>
    </section>
  );
}
