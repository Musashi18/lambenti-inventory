"use client";

import { MovementType } from "@prisma/client";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ItemSelectOptions } from "@/components/item-select-options";
import { sortItemsByUseGroup } from "@/modules/inventory/item-option-groups";
import { createMovementAction } from "./actions";
import { initialMovementActionState } from "./state";

const movementOptions = [...Object.values(MovementType), "BUILD"] as const;

type ItemOption = {
  id: string;
  sku: string;
  description: string;
  category: string;
  useGroupOverride?: string | null;
  unit: string;
};

export function MovementForm({ items, buildableItemIds = [] }: { items: ItemOption[]; buildableItemIds?: string[] }) {
  const router = useRouter();
  const sortedItems = useMemo(() => sortItemsByUseGroup(items), [items]);
  const [actionState, setActionState] = useState(initialMovementActionState);
  const [pending, setPending] = useState(false);
  const state = {
    ...initialMovementActionState,
    ...actionState,
    values: {
      ...initialMovementActionState.values,
      ...(actionState?.values ?? {})
    }
  };
  const initialItemId = state.values.itemId || sortedItems[0]?.id || "";
  const [selectedItemId, setSelectedItemId] = useState(initialItemId);
  const [movementType, setMovementType] = useState<string>(state.values.movementType || MovementType.RECEIVE);
  const buildableItemIdSet = useMemo(() => new Set(buildableItemIds), [buildableItemIds]);
  const filteredItems = useMemo(
    () => movementType === "BUILD" ? sortedItems.filter((item) => buildableItemIdSet.has(item.id)) : sortedItems,
    [buildableItemIdSet, sortedItems, movementType]
  );
  const selectedItem = filteredItems.find((item) => item.id === selectedItemId);
  const isMeterMovement = movementType !== "BUILD" && selectedItem?.unit === "METER";

  useEffect(() => {
    if (filteredItems.length === 0) {
      if (selectedItemId !== "") setSelectedItemId("");
      return;
    }
    if (!filteredItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(filteredItems[0].id);
    }
  }, [filteredItems, selectedItemId]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const form = event.currentTarget;
    setPending(true);
    try {
      const result = await createMovementAction(undefined, new FormData(form));
      setActionState(result);
      if (result.success) {
        router.refresh();
        window.location.reload();
        return;
      }
    } catch (caught) {
      setActionState({
        ...initialMovementActionState,
        success: false,
        message: caught instanceof Error ? caught.message : "Stock movement failed. Refresh and try again.",
        domainErrorCode: "STOCK_MOVEMENT_REJECTED"
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {state.message ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm xl:col-span-5 ${state.success ? "border-mint/40 bg-mint/10 text-emerald-800" : "border-coral/40 bg-coral/10 text-red-800"}`}
          role="status"
        >
          {state.message}
        </div>
      ) : null}

      <label className="space-y-1 text-sm xl:col-span-2">
        <span className="font-medium text-slate-700">Item</span>
        <select
          name="itemId"
          className="w-full rounded-md border px-3 py-2"
          value={selectedItemId}
          onChange={(event) => setSelectedItemId(event.target.value)}
          disabled={filteredItems.length === 0}
        >
          {filteredItems.length === 0 ? (
            <option value="">No active finished BOM unit is available for build movements</option>
          ) : (
            <ItemSelectOptions items={filteredItems} />
          )}
        </select>
        {movementType === "BUILD" ? (
          <p className="text-xs text-slate-500">Build movements only show active finished goods with an active BOM. Component/raw items are hidden for this movement type.</p>
        ) : null}
        <FieldErrors errors={state.fieldErrors.itemId} />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-slate-700">Movement</span>
        <select
          name="movementType"
          className="w-full rounded-md border px-3 py-2"
          value={movementType}
          onChange={(event) => setMovementType(event.target.value)}
        >
          {movementOptions.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        {movementType === "BUILD" ? (
          <p className="text-xs text-slate-500">
            Build consumes active BOM component quantities per finished unit and records assembled packages as finished stock.
          </p>
        ) : null}
        <FieldErrors errors={state.fieldErrors.movementType} />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-slate-700">Quantity</span>
        <input
          name="quantity"
          type="number"
          step={isMeterMovement ? "0.0001" : "1"}
          placeholder="Quantity"
          className="w-full rounded-md border px-3 py-2"
          defaultValue={state.success ? "" : state.values.quantity}
          required
        />
        <p className="text-xs text-slate-500">
          {isMeterMovement ? "Meter-measured items accept decimals up to 4 places, e.g. 1.5 m." : "Piece-counted and build movements require whole-number quantities."}
        </p>
        <FieldErrors errors={state.fieldErrors.quantity} />
      </label>

      <label className="space-y-1 text-sm">
        <span className="font-medium text-slate-700">Reason <span className="font-normal text-slate-400">Optional</span></span>
        <input
          name="reason"
          placeholder="Optional operator note"
          className="w-full rounded-md border px-3 py-2"
          defaultValue={state.success ? "" : state.values.reason}
        />
        <FieldErrors errors={state.fieldErrors.reason} />
      </label>

      <div className="space-y-1 text-sm xl:col-span-4">
        <label htmlFor="movement-reference" className="font-medium text-slate-700">Reference</label>
        <input
          id="movement-reference"
          name="reference"
          placeholder="PO/build/reservation/audit reference"
          className="w-full rounded-md border px-3 py-2"
          defaultValue={state.success ? "" : state.values.reference}
        />
        <p className="text-xs text-slate-500">Movements are item-level only for now. Lots are intentionally hidden.</p>
        <FieldErrors errors={state.fieldErrors.reference} />
      </div>

      <button className="rounded-md bg-ink px-4 py-2 text-white disabled:opacity-60 xl:col-span-5" disabled={pending}>
        {pending ? "Recording…" : "Record Movement"}
      </button>
    </form>
  );
}

function FieldErrors({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="text-xs text-red-700">{errors.join(" ")}</p>;
}
