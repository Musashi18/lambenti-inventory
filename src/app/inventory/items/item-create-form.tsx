"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { CostConfidence, ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { createItemFormAction } from "./actions";
import type { ItemActionState } from "./actions";

type SupplierOption = { id: string; name: string };

type Props = {
  defaultStorageLocationId: string;
  suppliers: SupplierOption[];
  categories: ItemCategory[];
  units: Unit[];
  lifecycleStatuses: LifecycleStatus[];
  costConfidences: CostConfidence[];
};

const initialItemActionState: ItemActionState = { ok: false, message: "" };

export function ItemCreateForm({
  defaultStorageLocationId,
  suppliers,
  categories,
  units,
  lifecycleStatuses,
  costConfidences
}: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createItemFormAction, initialItemActionState);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state.ok) return;
    formRef.current?.reset();
    router.refresh();
    window.location.reload();
  }, [router, state.ok, state.message]);

  return (
    <form ref={formRef} action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <input type="hidden" name="storageLocationId" value={defaultStorageLocationId} />
      <input name="sku" placeholder="Internal SKU" className="rounded-md border px-3 py-2" required />
      <input name="manufacturerPartNo" placeholder="Manufacturer part no." className="rounded-md border px-3 py-2" />
      <input name="supplierSku" placeholder="Supplier SKU" className="rounded-md border px-3 py-2" />
      <input name="description" placeholder="Description" className="rounded-md border px-3 py-2" required />
      <select name="category" className="rounded-md border px-3 py-2" defaultValue="COMPONENT">
        {categories.map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
      <select name="unit" className="rounded-md border px-3 py-2" defaultValue="EACH">
        {units.map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
      <input name="reorderPoint" type="number" placeholder="Reorder point" className="rounded-md border px-3 py-2" required />
      <input name="targetStock" type="number" placeholder="Target stock" className="rounded-md border px-3 py-2" required />
      <input name="leadTimeDays" type="number" placeholder="Lead time days" className="rounded-md border px-3 py-2" required />
      <select name="preferredSupplierId" className="rounded-md border px-3 py-2" defaultValue="">
        <option value="">No preferred supplier</option>
        {suppliers.map((supplier) => (
          <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
        ))}
      </select>
      <select name="lifecycleStatus" className="rounded-md border px-3 py-2" defaultValue="ACTIVE">
        {lifecycleStatuses.map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
      <input name="estimatedUnitCost" type="number" step="0.01" placeholder="Unit cost" className="rounded-md border px-3 py-2" />
      <input name="costCurrency" placeholder="USD" defaultValue="USD" className="rounded-md border px-3 py-2" />
      <select name="costConfidence" className="rounded-md border px-3 py-2" defaultValue="UNKNOWN">
        {costConfidences.map((value) => (
          <option key={value} value={value}>{value}</option>
        ))}
      </select>
      <input name="costSourceRef" placeholder="Cost source / quote ref" className="rounded-md border px-3 py-2" />
      <button disabled={pending} className="rounded-md bg-ink px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60 xl:col-span-4">
        {pending ? "Creating…" : "Create item"}
      </button>
      {state.message ? (
        <div className={`rounded-md border px-3 py-2 text-sm xl:col-span-4 ${state.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
          {state.message}
        </div>
      ) : null}
    </form>
  );
}
