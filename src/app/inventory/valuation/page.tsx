import { DashboardTable } from "@/components/dashboard-table";
import { prisma } from "@/lib/prisma";
import { getStockSummaries } from "@/modules/inventory/service";

export const dynamic = "force-dynamic";

export default async function ValuationPage() {
  const [lots, stock] = await Promise.all([
    prisma.stockLot.findMany({ include: { item: true } }),
    getStockSummaries()
  ]);

  const rows = lots.map((lot) => {
    const summary = stock.find((item) => item.itemId === lot.itemId);
    const onHand = summary?.onHand ?? 0;
    return [
      lot.item.sku,
      lot.lotCode,
      onHand.toString(),
      `$${Number(lot.unitCost).toFixed(2)}`,
      `$${(onHand * Number(lot.unitCost)).toFixed(2)}`
    ];
  });

  return (
    <DashboardTable
      title="Inventory valuation"
      columns={["SKU", "Lot", "On hand", "Unit cost", "Value"]}
      rows={rows}
    />
  );
}
