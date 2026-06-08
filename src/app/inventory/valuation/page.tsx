import { DashboardTable } from "@/components/dashboard-table";
import { prisma } from "@/lib/prisma";
import { calculatePricedItemValuations } from "@/modules/inventory/valuation";
import { requirePermission } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";

export default async function ValuationPage() {
  await requirePermission("accounting:view");
  const items = await prisma.item.findMany({
    where: {
      lifecycleStatus: { not: "OBSOLETE" },
      estimatedUnitCost: { not: null }
    },
    include: {
      stockMovements: {
        select: {
          movementType: true,
          quantity: true
        }
      }
    },
    orderBy: { sku: "asc" }
  });

  const itemValuation = calculatePricedItemValuations(
    items.map((item) => ({
      itemId: item.id,
      sku: item.sku,
      description: item.description,
      unitCost: item.estimatedUnitCost === null ? null : Number(item.estimatedUnitCost),
      currency: item.costCurrency,
      movements: item.stockMovements
    }))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inventory valuation</h1>
        <p className="text-sm text-slate-600">
          Automatically includes every active item with an estimated unit price. Quantity is ledger-derived from immutable item movements; value is quantity × price per unit.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Priced item valuation</div>
          <div className="mt-1 text-2xl font-semibold">USD ${itemValuation.totalValue.toFixed(2)}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <div className="text-sm text-slate-500">Priced active items</div>
          <div className="mt-1 text-2xl font-semibold">{itemValuation.rows.length}</div>
        </div>
      </section>

      <DashboardTable
        title="Priced item valuation"
        columns={["SKU", "Description", "Quantity", "Price/unit", "Value"]}
        rows={itemValuation.rows.map((row) => [
          row.sku,
          row.description,
          row.quantity.toString(),
          `${row.currency} ${row.unitCost.toFixed(2)}`,
          `${row.currency} ${row.value.toFixed(2)}`
        ])}
      />
    </div>
  );
}
