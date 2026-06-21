import { CostConfidence } from "@prisma/client";
import { getActiveSupplierOptions, getArchivedSupplierProfiles, getItemSupplierEntries, getSupplierCleanupCandidates, getUniqueSupplierProfiles, type ItemSupplierEntry, type SupplierCleanupCandidate, type SupplierProfile } from "@/modules/suppliers/service";
import { RefreshingActionForm } from "@/app/refreshing-action-form";
import { ItemSelectOptions } from "@/components/item-select-options";
import { requirePermission } from "@/modules/auth/permissions";
import { getLeadTimeSummaryIndex } from "@/modules/tracking/service";
import { archiveSupplierAction, archiveSupplierCleanupCandidatesAction, deleteArchivedSupplierAction, unarchiveSupplierAction, updateItemSupplierEntryAction, updateSupplierContactAction } from "./actions";

export const dynamic = "force-dynamic";

type ContactFieldName = "companyName" | "contactEmail" | "contactName" | "companyRevenue" | "foundedYear" | "address";

export default async function SuppliersPage() {
  await requirePermission("supplier:view");
  const [supplierEntries, supplierProfiles, archivedSupplierProfiles, supplierOptions, leadTimeSummaries, cleanupCandidates] = await Promise.all([
    getItemSupplierEntries(),
    getUniqueSupplierProfiles(),
    getArchivedSupplierProfiles(),
    getActiveSupplierOptions(),
    getLeadTimeSummaryIndex(),
    getSupplierCleanupCandidates()
  ]);
  const costConfidences = Object.values(CostConfidence);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Suppliers</h1>
        <p className="text-sm text-slate-600">
          Supplier records are generated from active item master records by clean item type. Edit supplier assignment, supplier SKU, and USD unit price without changing inventory quantities.
        </p>
      </div>

      <SupplierCleanupSection candidates={cleanupCandidates} />

      <section className="rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Suppliers</h2>
          <p className="text-xs text-slate-500">
            Company and contact name are shown by default. Saved supplier contact information is collapsed by default until additional fields or edit controls are needed.
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {supplierProfiles.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No displayable suppliers found.</div>
          ) : supplierProfiles.map((supplier) => {
            const itemTypes = Array.from(new Set(
              supplierEntries
                .filter((entry) => entry.supplierId === supplier.id)
                .map((entry) => entry.cleanItemType)
            )).join(", ") || "—";

            return (
              <article key={supplier.id} className="space-y-3 p-4">
                <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="font-medium">{supplier.displayName}</div>
                    <div className="text-xs text-slate-500">Source: {supplier.sourceLabel}</div>
                    <div className="text-xs text-slate-500">Item types supplied: {itemTypes}</div>
                    <div className="text-xs text-slate-500">
                      Lead Time: {supplier.leadTimeDays}d current · {leadTimeSummaries.bySupplierId[supplier.id]?.label ?? "No completed tracking/receiving samples yet"}
                    </div>
                  </div>
                  <span className={supplier.confirmedByHuman ? "rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700" : "rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"}>
                    {supplier.confirmedByHuman ? "Human-Confirmed Supplier Record" : "Active Supplier Record"}
                  </span>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <SupplierContactField supplier={supplier} field="companyName" label="Company" editLabel="Edit Company" value={supplier.companyName} displayValue={supplier.companyName || supplier.displayName} />
                  <SupplierContactField supplier={supplier} field="contactName" label="Contact Name" editLabel="Edit Contact Name" value={supplier.contactName} />
                </div>
                <SupplierAdditionalContactDetails supplier={supplier} />
                <ArchiveSupplierControl supplier={supplier} />
              </article>
            );
          })}
        </div>

        <AddNewSupplierSection supplierEntries={supplierEntries} costConfidences={costConfidences} />

        <details className="border-t border-slate-200 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">Archived Suppliers ({archivedSupplierProfiles.length})</summary>
          <p className="mt-1 text-xs text-slate-500">Archived entries are hidden from the active suppliers list and item dropdowns. Delete only rows that no longer need to be retained.</p>
          <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-100">
            {archivedSupplierProfiles.length === 0 ? (
              <div className="p-3 text-sm text-slate-500">No archived suppliers.</div>
            ) : archivedSupplierProfiles.map((supplier) => (
              <ArchivedSupplierRow key={supplier.id} supplier={supplier} />
            ))}
          </div>
        </details>

        <div className="border-t border-slate-200 px-4 py-3">
          <h3 className="text-sm font-medium text-slate-800">Item Sourcing Rows</h3>
          <p className="text-xs text-slate-500">One editable sourcing row is created automatically for every active item.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Clean Item Type</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Supplier SKU</th>
                <th className="px-4 py-3">Unit Price (USD)</th>
                <th className="px-4 py-3">Confidence</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {supplierEntries.length === 0 ? (
                <tr><td className="px-4 py-6 text-slate-500" colSpan={8}>No active supplier entries found.</td></tr>
              ) : supplierEntries.map((entry) => {
                const formId = `supplier-entry-${entry.itemId}`;
                const options = supplierOptions.some((supplier) => supplier.id === entry.supplierId) || !entry.supplierId
                  ? supplierOptions
                  : [{ id: entry.supplierId, name: entry.supplierName }, ...supplierOptions];
                return (
                  <tr key={entry.itemId}>
                    <td className="px-4 py-3">{entry.cleanItemType}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{entry.sku}</div>
                      <div className="text-xs text-slate-500">{entry.description}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select form={formId} name="preferredSupplierId" defaultValue={entry.supplierId} className="min-w-56 rounded-md border px-2 py-1.5">
                        <option value="">Unassigned</option>
                        {options.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input form={formId} name="supplierSku" defaultValue={entry.supplierSku} className="w-36 rounded-md border px-2 py-1.5" />
                    </td>
                    <td className="px-4 py-3">
                      <input form={formId} name="estimatedUnitCost" type="number" min="0" step="0.0001" defaultValue={entry.unitPriceUsd?.toString() ?? ""} className="w-28 rounded-md border px-2 py-1.5" />
                    </td>
                    <td className="px-4 py-3">
                      <select form={formId} name="costConfidence" defaultValue={entry.costConfidence} className="rounded-md border px-2 py-1.5">
                        {costConfidences.map((value) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input form={formId} name="costSourceRef" defaultValue={entry.costSourceRef} className="w-44 rounded-md border px-2 py-1.5" />
                    </td>
                    <td className="px-4 py-3">
                      <RefreshingActionForm id={formId} action={updateItemSupplierEntryAction}>
                        <input type="hidden" name="itemId" value={entry.itemId} />
                        <button className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white">Save</button>
                      </RefreshingActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SupplierCleanupSection({ candidates }: { candidates: SupplierCleanupCandidate[] }) {
  if (candidates.length === 0) {
    return (
      <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div className="font-medium">Supplier Cleanup Queue clear</div>
        <p className="mt-1 text-xs">No unreferenced Alibaba UI/email junk suppliers are eligible for quarantine. Active supplier dropdowns use the cleaned displayable supplier source.</p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-medium">Supplier Cleanup Queue</h2>
          <p className="mt-1 text-xs">
            {candidates.length} unconfirmed supplier row{candidates.length === 1 ? "" : "s"} look like Alibaba UI/email text and have no preferred items, offers, purchase requests, purchase orders, or invoices. Quarantine hides them from active supplier lists while preserving historical email evidence.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {candidates.slice(0, 6).map((candidate) => (
              <li key={candidate.id}>{candidate.reason} · {candidate.emailImportCount} linked email evidence row{candidate.emailImportCount === 1 ? "" : "s"}</li>
            ))}
          </ul>
          {candidates.length > 6 ? <p className="mt-1 text-xs">+ {candidates.length - 6} more cleanup candidate(s).</p> : null}
        </div>
        <RefreshingActionForm action={archiveSupplierCleanupCandidatesAction} confirmMessage={`Archive ${candidates.length} supplier cleanup candidate(s)? This preserves history and does not change stock.`}>
          <button className="rounded-md bg-amber-900 px-3 py-2 text-xs font-medium text-white hover:bg-amber-950">Archive Cleanup Candidates</button>
        </RefreshingActionForm>
      </div>
    </section>
  );
}


function AddNewSupplierSection({ supplierEntries, costConfidences }: { supplierEntries: ItemSupplierEntry[]; costConfidences: CostConfidence[] }) {
  const defaultConfidence = costConfidences.includes(CostConfidence.UNKNOWN) ? CostConfidence.UNKNOWN : costConfidences[0];
  const hasItems = supplierEntries.length > 0;

  return (
    <details className="border-t border-slate-200 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-blue-700">Add New Supplier</summary>
      <RefreshingActionForm action={updateItemSupplierEntryAction} className="mt-3 grid gap-2 xl:grid-cols-[minmax(14rem,1.4fr)_minmax(12rem,1.2fr)_minmax(8rem,0.8fr)_minmax(7rem,0.6fr)_minmax(8rem,0.7fr)_minmax(10rem,1fr)_auto] xl:items-end">
        <input type="hidden" name="preferredSupplierId" value="" />
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Item
          <select name="itemId" required disabled={!hasItems} className="rounded-md border px-2 py-1.5 text-sm font-normal text-slate-900 disabled:bg-slate-100 disabled:text-slate-400">
            <option value="">{hasItems ? "Choose item" : "No active items"}</option>
            <ItemSelectOptions
              items={supplierEntries.map((entry) => ({
                id: entry.itemId,
                sku: entry.sku,
                description: entry.description,
                category: entry.category,
                useGroupOverride: entry.useGroupOverride
              }))}
            />
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Supplier
          <input name="customSupplierName" required disabled={!hasItems} placeholder="New supplier name" className="rounded-md border px-2 py-1.5 text-sm font-normal text-slate-900 disabled:bg-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Supplier SKU
          <input name="supplierSku" disabled={!hasItems} placeholder="Optional" className="rounded-md border px-2 py-1.5 text-sm font-normal text-slate-900 disabled:bg-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Unit Price
          <input name="estimatedUnitCost" type="number" min="0" step="0.0001" disabled={!hasItems} placeholder="USD" className="rounded-md border px-2 py-1.5 text-sm font-normal text-slate-900 disabled:bg-slate-100" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Confidence
          <select name="costConfidence" defaultValue={defaultConfidence} disabled={!hasItems} className="rounded-md border px-2 py-1.5 text-sm font-normal text-slate-900 disabled:bg-slate-100 disabled:text-slate-400">
            {costConfidences.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Source
          <input name="costSourceRef" disabled={!hasItems} placeholder="Quote/order/ref" className="rounded-md border px-2 py-1.5 text-sm font-normal text-slate-900 disabled:bg-slate-100" />
        </label>
        <button disabled={!hasItems} className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300">Add Supplier</button>
      </RefreshingActionForm>
    </details>
  );
}

function SupplierAdditionalContactDetails({ supplier }: { supplier: SupplierProfile }) {
  return (
    <details className="rounded-md border border-slate-100 bg-slate-50 p-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-slate-700">Additional Supplier Information</summary>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <SupplierContactField supplier={supplier} field="contactEmail" label="Email" editLabel="Edit Email" value={supplier.contactEmail} inputType="email" />
        <SupplierContactField supplier={supplier} field="companyRevenue" label="Company Revenue" editLabel="Edit Company Revenue" value={supplier.companyRevenue} inputType="number" min="0" step="0.01" />
        <SupplierContactField supplier={supplier} field="foundedYear" label="Founded Year" editLabel="Edit Founded Year" value={supplier.foundedYear} inputType="number" min="1800" max={new Date().getFullYear().toString()} />
        <SupplierContactField supplier={supplier} field="address" label="Address" editLabel="Edit Address" value={supplier.address} />
        <SupplierConfirmationField supplier={supplier} />
      </div>
    </details>
  );
}

function ArchiveSupplierControl({ supplier }: { supplier: SupplierProfile }) {
  return (
    <details className="inline-block max-w-full text-xs text-slate-600">
      <summary className="inline-flex w-fit cursor-pointer list-none rounded px-0 py-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-800">Archive Supplier</summary>
      <RefreshingActionForm action={archiveSupplierAction} className="mt-2 flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2 md:flex-row md:items-end">
        <input type="hidden" name="supplierId" value={supplier.id} />
        <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-600">
          Archive Reason
          <input name="archiveReason" placeholder="Duplicate, test row, no longer used..." className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900" />
        </label>
        <button className="self-start rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Archive</button>
      </RefreshingActionForm>
    </details>
  );
}

function ArchivedSupplierRow({ supplier }: { supplier: SupplierProfile }) {
  return (
    <div className="flex flex-col gap-2 p-3 text-sm md:flex-row md:items-center md:justify-between">
      <div>
        <div className="font-medium text-slate-800">{supplier.displayName}</div>
        <div className="text-xs text-slate-500">Archived {supplier.archivedAt ? new Date(supplier.archivedAt).toLocaleString() : "—"}</div>
        <div className="text-xs text-slate-500">Reason: {supplier.archiveReason || "—"}</div>
      </div>
      <div className="flex flex-wrap gap-2">
        <RefreshingActionForm action={unarchiveSupplierAction}>
          <input type="hidden" name="supplierId" value={supplier.id} />
          <button className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">Unarchive Supplier</button>
        </RefreshingActionForm>
        <RefreshingActionForm action={deleteArchivedSupplierAction}>
          <input type="hidden" name="supplierId" value={supplier.id} />
          <button className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700">Delete Archived Supplier</button>
        </RefreshingActionForm>
      </div>
    </div>
  );
}

function SupplierContactField({
  supplier,
  field,
  label,
  editLabel,
  value,
  displayValue,
  inputType = "text",
  min,
  max,
  step
}: {
  supplier: SupplierProfile;
  field: ContactFieldName;
  label: string;
  editLabel: string;
  value: string;
  displayValue?: string;
  inputType?: "text" | "email" | "number";
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 min-h-5 text-slate-900">{displayValue || value || "—"}</div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-blue-700">{editLabel}</summary>
        <RefreshingActionForm action={updateSupplierContactAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="supplierId" value={supplier.id} />
          <SupplierContactHiddenFields supplier={supplier} exclude={field} />
          <input name={field} type={inputType} min={min} max={max} step={step} defaultValue={value} className="rounded-md border px-2 py-1.5" />
          <button className="self-start rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white">Save {label}</button>
        </RefreshingActionForm>
      </details>
    </div>
  );
}

function SupplierConfirmationField({ supplier }: { supplier: SupplierProfile }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 p-3 text-sm md:col-span-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">human confirmation</div>
      <div className="mt-1 text-slate-900">{supplier.confirmedByHuman ? "Human-Confirmed Supplier Record" : "Active Supplier Record, not yet marked human-confirmed"}</div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-blue-700">Edit Human Confirmation</summary>
        <RefreshingActionForm action={updateSupplierContactAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="supplierId" value={supplier.id} />
          <SupplierContactHiddenFields supplier={supplier} exclude="confirmedByHuman" />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="confirmedByHuman" defaultChecked={supplier.confirmedByHuman} className="h-4 w-4 rounded border-slate-300" />
            <span>Human-Confirmed Supplier Record</span>
          </label>
          <button className="self-start rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white">Save Human Confirmation</button>
        </RefreshingActionForm>
      </details>
    </div>
  );
}

function SupplierContactHiddenFields({ supplier, exclude }: { supplier: SupplierProfile; exclude: ContactFieldName | "confirmedByHuman" }) {
  return (
    <>
      {exclude !== "companyName" ? <input type="hidden" name="companyName" value={supplier.companyName} /> : null}
      {exclude !== "contactEmail" ? <input type="hidden" name="contactEmail" value={supplier.contactEmail} /> : null}
      {exclude !== "contactName" ? <input type="hidden" name="contactName" value={supplier.contactName} /> : null}
      {exclude !== "companyRevenue" ? <input type="hidden" name="companyRevenue" value={supplier.companyRevenue} /> : null}
      {exclude !== "foundedYear" ? <input type="hidden" name="foundedYear" value={supplier.foundedYear} /> : null}
      {exclude !== "address" ? <input type="hidden" name="address" value={supplier.address} /> : null}
      {exclude !== "confirmedByHuman" && supplier.confirmedByHuman ? <input type="hidden" name="confirmedByHuman" value="on" /> : null}
    </>
  );
}
