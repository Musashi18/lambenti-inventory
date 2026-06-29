"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { receiveIncomingPurchaseOrderLineFormAction } from "./actions";
import { notifyIncomingLineReceived } from "./incoming-line-receipt-shell";
import { initialIncomingReceiveActionState, type IncomingReceiveActionState } from "./state";

type ReceiveIncomingLineFormProps = {
  purchaseOrderLineId: string;
  remainingQuantity: number;
  defaultUnitCost: string;
  defaultCurrency: string;
  defaultReceivedAt: string;
  defaultReference: string;
};

export function ReceiveIncomingLineForm({
  purchaseOrderLineId,
  remainingQuantity,
  defaultUnitCost,
  defaultCurrency,
  defaultReceivedAt,
  defaultReference
}: ReceiveIncomingLineFormProps) {
  const router = useRouter();
  const [actionState, formAction, pending] = useActionState(
    receiveIncomingPurchaseOrderLineFormAction,
    initialIncomingReceiveActionState
  );
  const state = mergeStateWithDefaults(actionState, {
    purchaseOrderLineId,
    quantity: remainingQuantity > 0 ? String(remainingQuantity) : "",
    lotCode: "",
    receivedAt: defaultReceivedAt,
    unitCost: defaultUnitCost,
    currency: defaultCurrency,
    reference: defaultReference,
    notes: "",
    overrideReason: ""
  });

  useEffect(() => {
    if (!state.success) return;
    notifyIncomingLineReceived(purchaseOrderLineId);
    router.refresh();
    const timeout = window.setTimeout(() => window.location.reload(), 550);
    return () => window.clearTimeout(timeout);
  }, [purchaseOrderLineId, router, state.message, state.success]);

  return (
    <form action={formAction} className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3" aria-label="Confirm counted receipt">
      <input type="hidden" name="purchaseOrderLineId" value={purchaseOrderLineId} />
      {state.message ? (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-sm ${state.success ? "border-mint/40 bg-mint/10 text-emerald-800" : "border-coral/40 bg-coral/10 text-red-800"}`}
          role="status"
        >
          {state.message}
        </div>
      ) : null}

      <div className="mb-3">
        <div className="text-sm font-medium text-slate-900">Confirm counted receipt</div>
        <p className="text-xs text-slate-500">
          Use this only after the package is physically counted. Email imports and invoices do not receive stock.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 rounded-lg border border-blue-200 bg-white p-3 text-sm shadow-sm xl:col-span-2">
          <span className="font-semibold text-blue-900">Quantity Counted</span>
          <input
            name="quantity"
            type="number"
            min="1"
            step="1"
            className="w-full rounded-md border border-blue-300 px-3 py-3 text-lg font-semibold"
            defaultValue={state.success ? "" : state.values.quantity}
            required
          />
          <p className="text-xs text-slate-500">Remaining Quantity: {remainingQuantity}</p>
          <FieldErrors errors={state.fieldErrors.quantity} />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Lot / Packing Slip Code</span>
          <input
            name="lotCode"
            placeholder="LOT-2026-001 or packing slip"
            className="w-full rounded-md border px-3 py-2"
            defaultValue={state.success ? "" : state.values.lotCode}
            required
          />
          <FieldErrors errors={state.fieldErrors.lotCode} />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Received Date</span>
          <input
            name="receivedAt"
            type="date"
            className="w-full rounded-md border px-3 py-2"
            defaultValue={state.values.receivedAt}
            required
          />
          <FieldErrors errors={state.fieldErrors.receivedAt} />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Unit Cost</span>
          <input
            name="unitCost"
            type="number"
            min="0"
            step="0.0001"
            className="w-full rounded-md border px-3 py-2"
            defaultValue={state.values.unitCost}
            required
          />
          <FieldErrors errors={state.fieldErrors.unitCost} />
        </label>

        <label className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">Currency</span>
          <input
            name="currency"
            className="w-full rounded-md border px-3 py-2 uppercase"
            defaultValue={state.values.currency}
            maxLength={3}
            required
          />
          <FieldErrors errors={state.fieldErrors.currency} />
        </label>

        <label className="space-y-1 text-sm xl:col-span-3">
          <span className="font-medium text-slate-700">Reference</span>
          <input
            name="reference"
            placeholder="PO, packing slip, tracking, or shipment reference"
            className="w-full rounded-md border px-3 py-2"
            defaultValue={state.success ? "" : state.values.reference}
            required
          />
          <FieldErrors errors={state.fieldErrors.reference} />
        </label>

        <label className="space-y-1 text-sm xl:col-span-2">
          <span className="font-medium text-slate-700">Notes</span>
          <input
            name="notes"
            placeholder="Human count, package condition, bench/location notes..."
            className="w-full rounded-md border px-3 py-2"
            defaultValue={state.success ? "" : state.values.notes}
          />
          <FieldErrors errors={state.fieldErrors.notes} />
        </label>

        <label className="space-y-1 text-sm xl:col-span-2">
          <span className="font-medium text-slate-700">Admin Override Reason</span>
          <input
            name="overrideReason"
            placeholder="Required only for over-receipts or obsolete items"
            className="w-full rounded-md border px-3 py-2"
            defaultValue={state.success ? "" : state.values.overrideReason}
          />
          <FieldErrors errors={state.fieldErrors.overrideReason} />
        </label>
      </div>

      <button className="mt-3 rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60" disabled={pending}>
        {pending ? "Receiving…" : "Receive Counted Stock"}
      </button>
    </form>
  );
}

function mergeStateWithDefaults(actionState: IncomingReceiveActionState, defaults: Record<string, string>): IncomingReceiveActionState {
  const hasSubmittedState = Boolean(
    actionState.success
      || actionState.message
      || actionState.domainErrorCode
      || Object.keys(actionState.fieldErrors ?? {}).length > 0
  );

  return {
    ...initialIncomingReceiveActionState,
    ...actionState,
    values: {
      ...defaults,
      ...(hasSubmittedState ? actionState.values : {})
    }
  };
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-red-700">{errors.join(" ")}</p>;
}
