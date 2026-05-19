import { MovementType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import type { StockSummary } from "@/types/inventory";

const inboundTypes = new Set<MovementType>([
  MovementType.RECEIVE,
  MovementType.RETURN
]);

const outboundTypes = new Set<MovementType>([
  MovementType.CONSUME,
  MovementType.SCRAP
]);

export async function getStockSummaries(): Promise<StockSummary[]> {
  const items = await prisma.item.findMany({
    include: { stockMovements: true },
    orderBy: { sku: "asc" }
  });

  return items.map((item) => {
    const onHand = item.stockMovements.reduce((total, movement) => {
      if (inboundTypes.has(movement.movementType)) return total + movement.quantity;
      if (outboundTypes.has(movement.movementType)) return total - movement.quantity;
      if (movement.movementType === MovementType.ADJUST) return total + movement.quantity;
      return total;
    }, 0);

    const reserved = item.stockMovements
      .filter((movement) => movement.movementType === MovementType.RESERVE)
      .reduce((total, movement) => total + movement.quantity, 0);

    return {
      itemId: item.id,
      sku: item.sku,
      description: item.description,
      reorderPoint: item.reorderPoint,
      targetStock: item.targetStock,
      onHand,
      reserved,
      available: onHand - reserved
    };
  });
}

export async function createStockMovement(input: {
  itemId: string;
  stockLotId?: string;
  movementType: MovementType;
  quantity: number;
  reason: string;
  reference?: string;
  actorId: string;
}) {
  if (input.quantity <= 0 && input.movementType !== MovementType.ADJUST) {
    throw new Error("Quantity must be positive except for adjustments.");
  }

  const movement = await prisma.stockMovement.create({
    data: {
      itemId: input.itemId,
      stockLotId: input.stockLotId,
      movementType: input.movementType,
      quantity: input.quantity,
      reason: input.reason,
      reference: input.reference,
      actorType: "USER",
      actorId: input.actorId
    }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "CREATE_STOCK_MOVEMENT",
    entityType: "StockMovement",
    entityId: movement.id,
    payload: input
  });

  return movement;
}

