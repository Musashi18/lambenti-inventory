"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { convertToUsd } from "@/modules/currency";
import {
  archiveItemFormAction,
  unarchiveItemFormAction,
  updateItemFormAction,
  type ItemActionState
} from "./actions";

type SupplierOption = {
  id: string;
  name: string;
};

type EditableItem = {
  id: string;
  sku: string;
  manufacturerPartNo: string;
  supplierSku: string;
  description: string;
  category: string;
  unit: string;
  reorderPoint: number;
  targetStock: number;
  leadTimeDays: number;
  preferredSupplierId: string;
  preferredSupplierName: string;
  lifecycleStatus: string;
  estimatedUnitCost: string;
  costCurrency: string;
  costConfidence: string;
  costSourceRef: string;
};

const emptyActionState: ItemActionState = { ok: false, message: "" };

function statusClass(ok: boolean) {
  return ok ? "border-mint/40 bg-mint/10 text-emerald-800" : "border-coral/40 bg-coral/10 text-red-800";
}

function formatUsdUnitPrice(item: Pick<EditableItem, "estimatedUnitCost" | "costCurrency">) {
  const rawUnitCost = item.estimatedUnitCost.trim();
  if (rawUnitCost === "") return "—";

  const unitCost = Number(rawUnitCost);
  if (!Number.isFinite(unitCost)) return "—";

  const currency = item.costCurrency.trim().toUpperCase() || "USD";
  return `USD ${convertToUsd(unitCost, currency).toFixed(2)}`;
}

type ItemFormAction = (_previous: ItemActionState, formData: FormData) => Promise<ItemActionState>;

export function ItemsCatalog({
  title = "Item catalog",
  archivedView = false,
  items,
  suppliers,
  categories,
  units,
  lifecycleStatuses,
  costConfidences
}: {
  title?: string;
  archivedView?: boolean;
  items: EditableItem[];
  suppliers: SupplierOption[];
  categories: string[];
  units: string[];
  lifecycleStatuses: string[];
  costConfidences: string[];
}) {
  const router = useRouter();
  const [state, setState] = useState<ItemActionState>(emptyActionState);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  async function runItemAction(key: string, formData: FormData, action: ItemFormAction, onSuccess?: () => void) {
    setBusyKey(key);
    try {
      const result = await action(emptyActionState, formData);
      setState(result);
      if (result.ok) {
        onSuccess?.();
        router.refresh();
        window.location.reload();
      }
    } catch (error) {
      setState({ ok: false, message: error instanceof Error ? error.message : "Item action failed. Check the fields and try again." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="font-medium">{title}</h2>
        {state.message ? (
          <p className={`mt-2 rounded-md border px-3 py-2 text-sm ${statusClass(state.ok)}`} role="status">
            {state.message}
          </p>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Unit price (USD)</th>
              <th className="px-4 py-3 font-medium">Cost confidence</th>
              <th className="px-4 py-3 font-medium">Lifecycle</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-500" colSpan={7}>
                  {archivedView ? "No archived items found." : "No active items found."}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const dialogId = `edit-item-${item.id}`;
                const isObsolete = item.lifecycleStatus === "OBSOLETE";
                const archiveBusy = busyKey === `archive:${item.id}`;
                const unarchiveBusy = busyKey === `unarchive:${item.id}`;
                const updateBusy = busyKey === `update:${item.id}`;

                return (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{item.sku}</td>
                    <td className="px-4 py-3">{item.description}</td>
                    <td className="px-4 py-3">{item.category}</td>
                    <td className="px-4 py-3">{formatUsdUnitPrice(item)}</td>
                    <td className="px-4 py-3">{item.costConfidence}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${isObsolete ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                        {isObsolete ? "Archived / OBSOLETE" : item.lifecycleStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
                          onClick={() => (document.getElementById(dialogId) as HTMLDialogElement | null)?.showModal()}
                        >
                          Edit
                        </button>
                        {isObsolete ? (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void runItemAction(`unarchive:${item.id}`, new FormData(event.currentTarget), unarchiveItemFormAction);
                            }}
                          >
                            <input type="hidden" name="itemId" value={item.id} />
                            <button
                              className="rounded-md border border-emerald-300 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
                              disabled={Boolean(busyKey)}
                              type="submit"
                            >
                              {unarchiveBusy ? "Unarchiving…" : "Unarchive"}
                            </button>
                          </form>
                        ) : (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void runItemAction(`archive:${item.id}`, new FormData(event.currentTarget), archiveItemFormAction);
                            }}
                          >
                            <input type="hidden" name="itemId" value={item.id} />
                            <button
                              className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                              disabled={Boolean(busyKey)}
                              type="submit"
                            >
                              {archiveBusy ? "Archiving…" : "Archive"}
                            </button>
                          </form>
                        )}
                      </div>
                      <dialog id={dialogId} className="w-full max-w-3xl rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40">
                        <form
                          className="space-y-4 p-5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const form = event.currentTarget;
                            void runItemAction(`update:${item.id}`, new FormData(form), updateItemFormAction, () => {
                              (document.getElementById(dialogId) as HTMLDialogElement | null)?.close();
                            });
                          }}
                        >
                          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
                            <div>
                              <h3 className="text-lg font-semibold">Edit item</h3>
                              <p className="text-sm text-slate-500">Update any item field. Location is intentionally hidden for now.</p>
                            </div>
                            <button
                              type="button"
                              className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
                              onClick={() => (document.getElementById(dialogId) as HTMLDialogElement | null)?.close()}
                            >
                              ✕
                            </button>
                          </div>

                          <input type="hidden" name="itemId" value={item.id} />

                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="space-y-1 text-sm font-medium">
                              <span>Internal SKU</span>
                              <input name="sku" defaultValue={item.sku} className="w-full rounded-md border px-3 py-2 font-normal" required />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Description</span>
                              <input name="description" defaultValue={item.description} className="w-full rounded-md border px-3 py-2 font-normal" required />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Manufacturer part no.</span>
                              <input name="manufacturerPartNo" defaultValue={item.manufacturerPartNo} className="w-full rounded-md border px-3 py-2 font-normal" />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Supplier SKU</span>
                              <input name="supplierSku" defaultValue={item.supplierSku} className="w-full rounded-md border px-3 py-2 font-normal" />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Category</span>
                              <select name="category" defaultValue={item.category} className="w-full rounded-md border px-3 py-2 font-normal">
                                {categories.map((value) => (
                                  <option key={value} value={value}>{value}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Unit</span>
                              <select name="unit" defaultValue={item.unit} className="w-full rounded-md border px-3 py-2 font-normal">
                                {units.map((value) => (
                                  <option key={value} value={value}>{value}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Reorder point</span>
                              <input name="reorderPoint" type="number" defaultValue={item.reorderPoint} className="w-full rounded-md border px-3 py-2 font-normal" required />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Target stock</span>
                              <input name="targetStock" type="number" defaultValue={item.targetStock} className="w-full rounded-md border px-3 py-2 font-normal" required />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Lead time days</span>
                              <input name="leadTimeDays" type="number" defaultValue={item.leadTimeDays} className="w-full rounded-md border px-3 py-2 font-normal" required />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Preferred supplier</span>
                              <select name="preferredSupplierId" defaultValue={item.preferredSupplierId} className="w-full rounded-md border px-3 py-2 font-normal">
                                <option value="">No preferred supplier</option>
                                {suppliers.map((supplier) => (
                                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Lifecycle status</span>
                              <select name="lifecycleStatus" defaultValue={item.lifecycleStatus} className="w-full rounded-md border px-3 py-2 font-normal">
                                {lifecycleStatuses.map((value) => (
                                  <option key={value} value={value}>{value}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Unit cost</span>
                              <input name="estimatedUnitCost" type="number" step="0.01" defaultValue={item.estimatedUnitCost} className="w-full rounded-md border px-3 py-2 font-normal" />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Currency</span>
                              <input name="costCurrency" defaultValue={item.costCurrency} className="w-full rounded-md border px-3 py-2 font-normal" />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Cost confidence</span>
                              <select name="costConfidence" defaultValue={item.costConfidence} className="w-full rounded-md border px-3 py-2 font-normal">
                                {costConfidences.map((value) => (
                                  <option key={value} value={value}>{value}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1 text-sm font-medium md:col-span-2">
                              <span>Cost source / quote ref</span>
                              <input name="costSourceRef" defaultValue={item.costSourceRef} className="w-full rounded-md border px-3 py-2 font-normal" />
                            </label>
                          </div>

                          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                            <button
                              type="button"
                              className="rounded-md border border-slate-300 px-4 py-2"
                              onClick={() => (document.getElementById(dialogId) as HTMLDialogElement | null)?.close()}
                            >
                              Cancel
                            </button>
                            <button className="rounded-md bg-ink px-4 py-2 text-white disabled:opacity-60" disabled={Boolean(busyKey)} type="submit">
                              {updateBusy ? "Saving changes…" : "Save changes"}
                            </button>
                          </div>
                        </form>
                      </dialog>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
