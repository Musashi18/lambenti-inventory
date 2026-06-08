import { getBomWorkspace } from "@/modules/boms/service";
import { requirePermission } from "@/modules/auth/permissions";
import { BomBuilder } from "./bom-builder";
import { addBomLineAction, createBomSectionAction, removeBomLineAction, updateBomLineAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function BomsPage() {
  await requirePermission("item:view");
  const { boms, activeItems, finishedUnitItems } = await getBomWorkspace();
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
    }))
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">BOM builder</h1>
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
