import { CostConfidence, ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getItems } from "@/modules/items/service";
import { exportItemsToCsv } from "@/modules/items/import-export";
import { getConfirmedSupplierOptions } from "@/modules/suppliers/service";
import { requirePermission } from "@/modules/auth/permissions";
import { ItemCreateForm } from "./item-create-form";
import { ItemImportExportPanel } from "./item-import-export-panel";
import { ItemsCatalog } from "./items-catalog";

export const dynamic = "force-dynamic";

export default async function ItemsPage({
  searchParams
}: {
  searchParams?: Promise<{ archived?: string }>;
}) {
  await requirePermission("item:view");
  const params = await searchParams;
  const showArchived = params?.archived === "1";
  const [items, confirmedSupplierOptions, storageLocations] = await Promise.all([
    getItems({ archivedOnly: showArchived }),
    getConfirmedSupplierOptions(),
    prisma.storageLocation.findMany({ orderBy: { code: "asc" } })
  ]);

  const defaultStorageLocationId = storageLocations[0]?.id;
  const exportCsv = exportItemsToCsv(items.map((item) => ({
    sku: item.sku,
    description: item.description,
    category: item.category,
    unit: item.unit,
    reorderPoint: item.reorderPoint,
    targetStock: item.targetStock,
    leadTimeDays: item.leadTimeDays,
    lifecycleStatus: item.lifecycleStatus,
    manufacturerPartNo: item.manufacturerPartNo ?? undefined,
    supplierSku: item.supplierSku ?? undefined,
    preferredSupplierId: item.preferredSupplierId ?? undefined,
    estimatedUnitCost: item.estimatedUnitCost === null ? undefined : Number(item.estimatedUnitCost),
    costCurrency: item.costCurrency,
    costConfidence: item.costConfidence,
    costSourceRef: item.costSourceRef ?? undefined
  })));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Inventory items</h1>
          <p className="text-sm text-slate-600">
            {showArchived ? "Archived/obsolete items are hidden from active inventory and automated checks." : "Create, edit, and maintain active stock master data."}
          </p>
        </div>
        <a href={showArchived ? "/inventory/items" : "/inventory/items?archived=1"} className="text-sm font-medium text-ink underline underline-offset-4">
          {showArchived ? "Back to active items" : "View archived items"}
        </a>
      </div>

      {!showArchived ? (
        <>
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <h2 className="mb-4 font-medium">Add item</h2>
            {!defaultStorageLocationId ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Add at least one internal storage location before creating items. Location is hidden in this screen for now, but the database still needs a default internal value.
              </p>
            ) : (
              <ItemCreateForm
                defaultStorageLocationId={defaultStorageLocationId}
                suppliers={confirmedSupplierOptions}
                categories={Object.values(ItemCategory)}
                units={Object.values(Unit)}
                lifecycleStatuses={Object.values(LifecycleStatus)}
                costConfidences={Object.values(CostConfidence)}
              />
            )}
          </section>
        </>
      ) : null}

      <ItemsCatalog
        title={showArchived ? "Archived items" : "Active item catalog"}
        archivedView={showArchived}
        items={items.map((item) => ({
          id: item.id,
          sku: item.sku,
          manufacturerPartNo: item.manufacturerPartNo ?? "",
          supplierSku: item.supplierSku ?? "",
          description: item.description,
          category: item.category,
          unit: item.unit,
          reorderPoint: item.reorderPoint,
          targetStock: item.targetStock,
          leadTimeDays: item.leadTimeDays,
          preferredSupplierId: item.preferredSupplierId ?? "",
          preferredSupplierName: item.preferredSupplier?.name ?? "",
          lifecycleStatus: item.lifecycleStatus,
          estimatedUnitCost: item.estimatedUnitCost?.toString() ?? "",
          costCurrency: item.costCurrency,
          costConfidence: item.costConfidence,
          costSourceRef: item.costSourceRef ?? ""
        }))}
        suppliers={confirmedSupplierOptions}
        categories={Object.values(ItemCategory)}
        units={Object.values(Unit)}
        lifecycleStatuses={Object.values(LifecycleStatus)}
        costConfidences={Object.values(CostConfidence)}
      />

      {!showArchived ? (
        <ItemImportExportPanel exportCsv={exportCsv} defaultStorageLocationId={defaultStorageLocationId} />
      ) : null}
    </div>
  );
}
