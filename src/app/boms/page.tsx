import { getBomWorkspace } from "@/modules/boms/service";
import { getStockSummaries } from "@/modules/inventory/service";
import { requirePermission } from "@/modules/auth/permissions";
import { BomBuilder } from "./bom-builder";
import { addBomLineAction, createBomSectionAction, removeBomLineAction, updateBomLineAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BomsPage() {
  await requirePermission("item:view");
  const [{ boms, activeItems, finishedUnitItems }, stockSummaries] = await Promise.all([
    getBomWorkspace(),
    getStockSummaries()
  ]);
  const stockSummaryByItemId = new Map(stockSummaries.map((summary) => [summary.itemId, summary]));
  const itemOptions = activeItems.map(toBomBuilderItem);
  const finishedUnitOptions = finishedUnitItems.map(toBomBuilderItem);
  const bomSections = boms.map((bom) => ({
    id: bom.id,
    parentItemId: bom.parentItemId,
    version: bom.version,
    parentItem: toBomBuilderItem(bom.parentItem),
    lines: bom.lines.map((line) => ({
      id: line.id,
      componentItemId: line.componentItemId,
      quantity: line.quantity,
      componentItem: toBomBuilderItem(line.componentItem)
    })),
    buildConstraint: summarizeBomBuildConstraint(bom, stockSummaryByItemId)
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">BOM Builder</h1>
        <p className="text-sm text-slate-600">
          Build finished-unit sections from item-master dropdowns, add component rows, and edit quantities per unit. Actual inventory consumption is still recorded from Inventory → Movements using the BUILD movement type.
        </p>
      </div>

      <BomBuilder
        boms={bomSections}
        activeItems={itemOptions}
        finishedUnitItems={finishedUnitOptions}
        createBomSectionAction={createBomSectionAction}
        addBomLineAction={addBomLineAction}
        updateBomLineAction={updateBomLineAction}
        removeBomLineAction={removeBomLineAction}
      />
    </div>
  );
}

function toBomBuilderItem(item: { id: string; sku: string; description: string; category: string }) {
  return {
    id: item.id,
    sku: item.sku,
    description: item.description,
    category: item.category
  };
}


type BomWorkspaceBom = Awaited<ReturnType<typeof getBomWorkspace>>["boms"][number];
type StockSummaryByItemId = Map<string, { available: number }>;

function summarizeBomBuildConstraint(bom: BomWorkspaceBom, stockSummaryByItemId: StockSummaryByItemId) {
  if (bom.lines.length === 0) return null;
  const lineConstraints = bom.lines.map((line) => {
    const available = stockSummaryByItemId.get(line.componentItemId)?.available ?? 0;
    const capacity = line.quantity > 0 ? Math.floor(available / line.quantity) : 0;
    return {
      sku: line.componentItem.sku,
      quantityPerUnit: line.quantity,
      available,
      capacity
    };
  }).sort((left, right) => left.capacity - right.capacity || left.sku.localeCompare(right.sku));
  const bottleneck = lineConstraints[0];
  const maxCapacity = Math.max(1, ...lineConstraints.map((line) => line.capacity));
  return {
    bottleneckSku: bottleneck.sku,
    quantityPerUnit: bottleneck.quantityPerUnit,
    available: bottleneck.available,
    buildableUnits: bottleneck.capacity,
    percentOfMax: Math.max(4, Math.round((bottleneck.capacity / maxCapacity) * 100))
  };
}
