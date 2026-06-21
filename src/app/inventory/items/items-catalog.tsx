"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { convertToUsd, type CurrencyRates } from "@/modules/currency";
import { getItemUseGroup, groupItemOptionsByUse, ITEM_USE_GROUP_RULES } from "@/modules/inventory/item-option-groups";
import {
  archiveItemFormAction,
  unarchiveItemFormAction,
  updateItemFormAction,
  updateItemUseGroupFormAction,
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
  useGroupOverride?: string | null;
  unit: string;
  reorderPoint: number;
  targetStock: number;
  leadTimeDays: number;
  observedLeadTimeLabel: string;
  observedLeadTimeSampleCount: number;
  preferredSupplierId: string;
  preferredSupplierName: string;
  lifecycleStatus: string;
  onHand: number;
  available: number;
  reserved: number;
  estimatedUnitCost: string;
  costCurrency: string;
  costConfidence: string;
  costSourceRef: string;
  displayUnitCost?: string;
  displayCostSource?: string;
};

const emptyActionState: ItemActionState = { ok: false, message: "" };

function statusClass(ok: boolean) {
  return ok ? "border-mint/40 bg-mint/10 text-emerald-800" : "border-coral/40 bg-coral/10 text-red-800";
}

function formatUsdUnitPrice(item: Pick<EditableItem, "estimatedUnitCost" | "costCurrency" | "displayUnitCost">, rates?: CurrencyRates) {
  const rawUnitCost = (item.displayUnitCost ?? item.estimatedUnitCost).trim();
  if (rawUnitCost === "") return "—";

  const unitCost = Number(rawUnitCost);
  if (!Number.isFinite(unitCost)) return "—";

  const currency = item.displayUnitCost ? "USD" : item.costCurrency.trim().toUpperCase() || "USD";
  return `USD ${convertToUsd(unitCost, currency, { rates }).toFixed(2)}`;
}

type ItemFormAction = (_previous: ItemActionState, formData: FormData) => Promise<ItemActionState>;

function getStockHealth(item: Pick<EditableItem, "available" | "reorderPoint" | "preferredSupplierId" | "preferredSupplierName" | "estimatedUnitCost" | "displayUnitCost">) {
  if (!item.preferredSupplierId && !item.preferredSupplierName) {
    return { label: "No Supplier", className: "border-amber-200 bg-amber-50 text-amber-800", nextAction: "Assign source before reorder." };
  }
  if ((item.displayUnitCost ?? item.estimatedUnitCost).trim() === "") {
    return { label: "Needs Cost", className: "border-blue-200 bg-blue-50 text-blue-800", nextAction: "Add landed/quoted/BOM cost." };
  }
  if (item.available < item.reorderPoint) {
    return { label: "Below Reorder", className: "border-red-200 bg-red-50 text-red-800", nextAction: "Draft purchase request." };
  }
  return { label: "OK", className: "border-emerald-200 bg-emerald-50 text-emerald-800", nextAction: "No immediate stock action." };
}

export function ItemsCatalog({
  title = "Item catalog",
  archivedView = false,
  items,
  suppliers,
  categories,
  units,
  lifecycleStatuses,
  costConfidences,
  currencyRates
}: {
  title?: string;
  archivedView?: boolean;
  items: EditableItem[];
  suppliers: SupplierOption[];
  categories: string[];
  units: string[];
  lifecycleStatuses: string[];
  costConfidences: string[];
  currencyRates?: CurrencyRates;
}) {
  const router = useRouter();
  const [state, setState] = useState<ItemActionState>(emptyActionState);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const itemGroups = groupItemOptionsByUse(items);

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
              <th className="px-4 py-3 font-medium">Stock Health</th>
              <th className="px-4 py-3 font-medium">Description</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Unit Price (USD)</th>
              <th className="px-4 py-3 font-medium">Lead Time</th>
              <th className="px-4 py-3 font-medium">Cost Confidence</th>
              <th className="px-4 py-3 font-medium">Lifecycle</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td className="px-4 py-4 text-slate-500" colSpan={9}>
                  {archivedView ? "No archived items found." : "No active items found."}
                </td>
              </tr>
            ) : (
              itemGroups.map((group) => (
                <Fragment key={group.key}>
                  <tr className="border-t border-slate-200 bg-slate-100/80 text-xs uppercase tracking-wide text-slate-600">
                    <td className="px-4 py-2 font-semibold" colSpan={9}>
                      {group.label} <span className="font-normal text-slate-400">({group.items.length})</span>
                    </td>
                  </tr>
                  {group.items.map((item) => {
                const dialogId = `edit-item-${item.id}`;
                const isObsolete = item.lifecycleStatus === "OBSOLETE";
                const archiveBusy = busyKey === `archive:${item.id}`;
                const unarchiveBusy = busyKey === `unarchive:${item.id}`;
                const updateBusy = busyKey === `update:${item.id}`;
                const moveBusy = busyKey === `move:${item.id}`;
                const stockHealth = getStockHealth(item);
                const currentUseGroup = getItemUseGroup(item);
                const automaticUseGroup = getItemUseGroup({ ...item, useGroupOverride: null });
                const supplierOptionsForItem = item.preferredSupplierId && !suppliers.some((supplier) => supplier.id === item.preferredSupplierId)
                  ? [
                      {
                        id: item.preferredSupplierId,
                        name: item.preferredSupplierName || "current preferred supplier"
                      },
                      ...suppliers
                    ]
                  : suppliers;

                return (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium">{item.sku}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${stockHealth.className}`}>{stockHealth.label}</span>
                      <div className="mt-1 text-xs text-slate-500">On Hand {item.onHand} · Available {item.available}</div>
                      <div className="text-xs text-slate-500">Supplier {item.preferredSupplierName || "—"}</div>
                      <div className="text-[11px] text-slate-400">{stockHealth.nextAction}</div>
                    </td>
                    <td className="px-4 py-3">{item.description}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{item.category}</div>
                      <form
                        className="mt-2 space-y-1"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void runItemAction(`move:${item.id}`, new FormData(event.currentTarget), updateItemUseGroupFormAction);
                        }}
                      >
                        <input type="hidden" name="itemId" value={item.id} />
                        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500" htmlFor={`use-group-${item.id}`}>
                          Catalog Section
                        </label>
                        <select
                          id={`use-group-${item.id}`}
                          name="useGroupOverride"
                          defaultValue={item.useGroupOverride ?? ""}
                          disabled={Boolean(busyKey)}
                          className="w-48 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 disabled:opacity-60"
                          title={`Current section: ${currentUseGroup.label}`}
                          onChange={(event) => event.currentTarget.form?.requestSubmit()}
                        >
                          <option value="">Auto: {automaticUseGroup.label}</option>
                          {ITEM_USE_GROUP_RULES.map((rule) => (
                            <option key={rule.key} value={rule.key}>{rule.label}</option>
                          ))}
                        </select>
                        {item.useGroupOverride ? <div className="text-[11px] text-orange-600">Manual section override</div> : null}
                        {moveBusy ? <div className="text-[11px] text-slate-500">Moving…</div> : null}
                      </form>
                    </td>
                    <td className="px-4 py-3">
                      <div>{formatUsdUnitPrice(item, currencyRates)}</div>
                      {item.displayCostSource ? <div className="mt-1 text-[11px] text-slate-500">{item.displayCostSource}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{item.leadTimeDays}d current</div>
                      <div className="text-xs text-slate-500">{item.observedLeadTimeLabel}</div>
                    </td>
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
                              <h3 className="text-lg font-semibold">Edit Item</h3>
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
                              <span>Manufacturer Part No.</span>
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
                              <span>Reorder Point</span>
                              <input name="reorderPoint" type="number" defaultValue={item.reorderPoint} className="w-full rounded-md border px-3 py-2 font-normal" required />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Target Stock</span>
                              <input name="targetStock" type="number" defaultValue={item.targetStock} className="w-full rounded-md border px-3 py-2 font-normal" required />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Lead Time Days</span>
                              <input name="leadTimeDays" type="number" defaultValue={item.leadTimeDays} className="w-full rounded-md border px-3 py-2 font-normal" required />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Preferred supplier</span>
                              <select name="preferredSupplierId" defaultValue={item.preferredSupplierId} className="w-full rounded-md border px-3 py-2 font-normal">
                                <option value="">No preferred supplier</option>
                                {supplierOptionsForItem.map((supplier) => (
                                  <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Custom Supplier</span>
                              <input name="customSupplierName" placeholder="Type a new supplier if it is not listed" className="w-full rounded-md border px-3 py-2 font-normal" />
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
                              <span>Unit Cost</span>
                              <input name="estimatedUnitCost" type="number" step="0.0001" defaultValue={item.estimatedUnitCost} className="w-full rounded-md border px-3 py-2 font-normal" />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Currency</span>
                              <input name="costCurrency" defaultValue={item.costCurrency} className="w-full rounded-md border px-3 py-2 font-normal" />
                            </label>
                            <label className="space-y-1 text-sm font-medium">
                              <span>Cost Confidence</span>
                              <select name="costConfidence" defaultValue={item.costConfidence} className="w-full rounded-md border px-3 py-2 font-normal">
                                {costConfidences.map((value) => (
                                  <option key={value} value={value}>{value}</option>
                                ))}
                              </select>
                            </label>
                            <label className="space-y-1 text-sm font-medium md:col-span-2">
                              <span>Cost Source / Quote Ref</span>
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
                              {updateBusy ? "Saving changes…" : "Save Changes"}
                            </button>
                          </div>
                        </form>
                      </dialog>
                    </td>
                  </tr>
                );
                  })}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
