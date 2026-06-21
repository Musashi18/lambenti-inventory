"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ItemSelectOptions } from "@/components/item-select-options";
import { sortItemsByUseGroup } from "@/modules/inventory/item-option-groups";

type BomAction = (formData: FormData) => Promise<void>;

type BomBuilderItem = {
  id: string;
  sku: string;
  description: string;
  category: string;
  useGroupOverride?: string | null;
};

type BomBuilderLine = {
  id: string;
  componentItemId: string;
  quantity: number;
  componentItem: BomBuilderItem;
};

type BomBuildConstraint = {
  bottleneckSku: string;
  quantityPerUnit: number;
  available: number;
  buildableUnits: number;
  percentOfMax: number;
};

type BomBuilderSection = {
  id: string;
  parentItemId: string;
  version: string;
  parentItem: BomBuilderItem;
  lines: BomBuilderLine[];
  buildConstraint: BomBuildConstraint | null;
};

type BomBuilderProps = {
  boms: BomBuilderSection[];
  activeItems: BomBuilderItem[];
  finishedUnitItems: BomBuilderItem[];
  createBomSectionAction: BomAction;
  addBomLineAction: BomAction;
  updateBomLineAction: BomAction;
  removeBomLineAction: BomAction;
};

export function BomBuilder({
  boms,
  activeItems,
  finishedUnitItems,
  createBomSectionAction,
  addBomLineAction,
  updateBomLineAction,
  removeBomLineAction
}: BomBuilderProps) {
  const router = useRouter();
  const itemById = useMemo(() => new Map(activeItems.map((item) => [item.id, item])), [activeItems]);
  const sortedActiveItems = useMemo(() => sortItemsByUseGroup(activeItems), [activeItems]);
  const sortedFinishedUnitItems = useMemo(() => sortItemsByUseGroup(finishedUnitItems), [finishedUnitItems]);
  const firstFinishedUnitId = sortedFinishedUnitItems[0]?.id ?? "";
  const [newParentItemId, setNewParentItemId] = useState(firstFinishedUnitId);

  const [componentSelections, setComponentSelections] = useState<Record<string, string>>(() => Object.fromEntries(
    boms.flatMap((bom) => bom.lines.map((line) => [line.id, line.componentItemId]))
  ));
  const [draftComponentSelections, setDraftComponentSelections] = useState<Record<string, string>>({});
  const [removedLineIds, setRemovedLineIds] = useState<Set<string>>(() => new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submitForm(event: FormEvent<HTMLFormElement>, action: BomAction, key: string, afterSuccess?: () => void) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPendingKey(key);
    setMessage(null);
    try {
      await action(formData);
      afterSuccess?.();
      router.refresh();
      window.location.reload();
      setMessage("BOM Builder updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "BOM update failed. Refresh and try again.");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-slate-200 bg-white p-4">
        <div>
          <h2 className="font-medium">Create Another Finished Unit Section</h2>
          <p className="mt-1 text-sm text-slate-600">
            Finished units are active finished-good items from the item master. Components/raw materials stay available only in component-row dropdowns.
          </p>
        </div>
        <form
          className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
          onSubmit={(event) => void submitForm(event, createBomSectionAction, "create-section")}
        >
          <label className="text-sm font-medium text-slate-700">
            Finished unit
            <select
              name="parentItemId"
              value={newParentItemId}
              onChange={(event) => setNewParentItemId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              required
            >
              {sortedFinishedUnitItems.length === 0 ? <option value="">No finished units available</option> : null}
              <ItemSelectOptions items={sortedFinishedUnitItems} />
            </select>
          </label>
          <button
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            disabled={!newParentItemId || pendingKey !== null}
            aria-busy={pendingKey === "create-section"}
          >
            {pendingKey === "create-section" ? "Creating…" : "Create Another Finished Unit Section"}
          </button>
        </form>
      </section>

      {boms.length === 0 ? (
        <section className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-500">
          No active BOMs found. Create a finished unit section above, then add component rows with quantities per unit.
        </section>
      ) : null}

      {boms.map((bom) => {
        const componentOptions = sortedActiveItems.filter((item) => item.id !== bom.parentItemId);
        const draftComponentId = draftComponentSelections[bom.id] ?? componentOptions[0]?.id ?? "";
        const selectedComponentDetails = itemById.get(draftComponentId);

        return (
          <section key={bom.id} className="rounded-md border border-slate-200 bg-white p-4">
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wide text-slate-500">Finished unit</div>
              <h2 className="text-lg font-semibold">{bom.parentItem.sku} — {titleCaseLabel(bom.parentItem.description)}</h2>
              <p className="text-sm text-slate-500">{cleanItemType(bom.parentItem.category)} · {bom.version}</p>
              {bom.parentItem.sku === "LAMBENTI_PACKAGE" ? (
                <span className="mt-2 inline-flex rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-800">Launch-Critical BOM</span>
              ) : null}
            </div>

            <BomBuildConstraintBar constraint={bom.buildConstraint} />

            <div className="mt-4 overflow-x-auto rounded-md border border-slate-100">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Component</th>
                    <th className="px-3 py-2 font-medium">Clean Item Type</th>
                    <th className="px-3 py-2 font-medium">Description</th>
                    <th className="px-3 py-2 font-medium">Quantity per Unit</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {bom.lines.filter((line) => !removedLineIds.has(line.id)).length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={5}>No component lines. Add the first row below.</td>
                    </tr>
                  ) : null}
                  {bom.lines.filter((line) => !removedLineIds.has(line.id)).map((line) => {
                    const selectedComponentId = componentSelections[line.id] ?? line.componentItemId;
                    const selectedLineComponentDetails = itemById.get(selectedComponentId) ?? line.componentItem;
                    return (
                      <tr key={line.id} className="table-row-interactive border-t border-slate-100 align-top">
                        <td className="px-3 py-2 min-w-72">
                          <form
                            id={`bom-line-${line.id}`}
                            onSubmit={(event) => void submitForm(event, updateBomLineAction, `update-${line.id}`)}
                          >
                            <input type="hidden" name="lineId" value={line.id} />
                            <select
                              name="componentItemId"
                              value={selectedComponentId}
                              onChange={(event) => setComponentSelections((current) => ({ ...current, [line.id]: event.target.value }))}
                              className="w-full rounded-md border px-2 py-1.5"
                            >
                              <ItemSelectOptions items={componentOptions} />
                            </select>
                          </form>
                        </td>
                        <td className="px-3 py-2">{cleanItemType(selectedLineComponentDetails.category)}</td>
                        <td className="px-3 py-2">{selectedLineComponentDetails.description}</td>
                        <td className="px-3 py-2">
                          <input form={`bom-line-${line.id}`} name="quantity" type="number" min="0.0001" step="0.0001" defaultValue={line.quantity} className="w-28 rounded-md border px-3 py-2" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button form={`bom-line-${line.id}`} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-60" disabled={pendingKey !== null}>
                              {pendingKey === `update-${line.id}` ? "Saving…" : "Save Row"}
                            </button>
                            <form
                              onSubmit={(event) => void submitForm(event, removeBomLineAction, `remove-${line.id}`, () => {
                                setRemovedLineIds((current) => new Set(current).add(line.id));
                              })}
                            >
                              <input type="hidden" name="lineId" value={line.id} />
                              <button className="rounded-md border border-red-200 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60" disabled={pendingKey !== null}>
                                {pendingKey === `remove-${line.id}` ? "Removing…" : "Remove Row"}
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <form
              className="mt-4 grid gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 md:grid-cols-[minmax(0,1fr)_10rem_8rem_auto] md:items-end"
              onSubmit={(event) => void submitForm(event, addBomLineAction, `add-${bom.id}`)}
            >
              <input type="hidden" name="bomId" value={bom.id} />
              <label className="text-sm font-medium text-slate-700">
                Add Component Line
                <select
                  name="componentItemId"
                  value={draftComponentId}
                  onChange={(event) => setDraftComponentSelections((current) => ({ ...current, [bom.id]: event.target.value }))}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                  required
                >
                  {componentOptions.length === 0 ? <option value="">No component options</option> : null}
                  <ItemSelectOptions items={componentOptions} />
                </select>
              </label>
              <div className="text-sm text-slate-600">
                <div className="text-xs uppercase tracking-wide text-slate-400">Item type</div>
                {selectedComponentDetails ? cleanItemType(selectedComponentDetails.category) : "—"}
              </div>
              <label className="text-sm font-medium text-slate-700">
                Qty/Unit
                <input name="quantity" type="number" min="0.0001" step="0.0001" defaultValue="1" className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
              </label>
              <button className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-white disabled:opacity-60" disabled={!draftComponentId || pendingKey !== null}>
                {pendingKey === `add-${bom.id}` ? "Adding…" : "Add Component Line"}
              </button>
              <div className="text-xs text-slate-500 md:col-span-4">
                {selectedComponentDetails ? selectedComponentDetails.description : "Choose an active item; type and description autofill from the item master."}
              </div>
            </form>
          </section>
        );
      })}

      {message ? <p role="status" className="text-sm text-slate-600">{message}</p> : null}
    </div>
  );
}

function BomBuildConstraintBar({ constraint }: { constraint: BomBuildConstraint | null }) {
  if (!constraint) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
        Build Constraint: Add Component Rows To Calculate The Current Bottleneck.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div>
          <div className="font-semibold uppercase tracking-wide text-slate-500">Build Constraint</div>
          <div className="mt-1 text-sm font-medium text-slate-900">{constraint.bottleneckSku} limits this BOM to {constraint.buildableUnits} buildable unit{constraint.buildableUnits === 1 ? "" : "s"}</div>
        </div>
        <div className="text-slate-500">Qty/Unit {constraint.quantityPerUnit} · Available {constraint.available}</div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" aria-label="BOM build constraint mini-bar">
        <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" style={{ width: `${constraint.percentOfMax}%` }} />
      </div>
    </div>
  );
}

function cleanItemType(category: string) {
  return category
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleCaseLabel(value: string) {
  return value.replace(/\b[a-z][\w-]*/g, (word) => word.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("-"));
}
