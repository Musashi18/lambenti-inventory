import { getStockSummaries } from "@/modules/inventory/service";
import { getIncomingOrders, getPurchaseRecommendations } from "@/modules/purchasing/service";
import { prisma } from "@/lib/prisma";
import type { ShortageSummary } from "@/types/inventory";

export async function getDashboardSummary() {
  const stock = await getStockSummaries();
  const lowStockItems = stock.filter((item) => item.available < item.reorderPoint);
  const reservations = await prisma.buildReservation.findMany({
    include: { item: true }
  });

  const shortages: ShortageSummary[] = reservations
    .map((reservation) => {
      const current = stock.find((item) => item.itemId === reservation.itemId);
      const available = current?.available ?? 0;
      return {
        itemId: reservation.itemId,
        sku: reservation.item.sku,
        demand: reservation.quantity,
        available,
        shortage: Math.max(reservation.quantity - available, 0)
      };
    })
    .filter((item) => item.shortage > 0);

  const lots = await prisma.stockLot.findMany({
    include: { item: { include: { stockMovements: true } } }
  });

  const inventoryValuation = lots.reduce((total, lot) => {
    const itemStock = stock.find((item) => item.itemId === lot.itemId);
    return total + Number(lot.unitCost) * (itemStock?.onHand ?? 0);
  }, 0);

  return {
    lowStockItems,
    shortages,
    inventoryValuation,
    recommendations: await getPurchaseRecommendations(),
    incomingOrders: await getIncomingOrders()
  };
}

