import { ItemCategory, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export function visibleStockMovementWhere(voidedMovementIds: string[]): Prisma.StockMovementWhereInput {
  return {
    id: { notIn: voidedMovementIds },
    OR: [
      { reference: null },
      { NOT: { reference: { startsWith: "VOID:" } } }
    ]
  };
}

export async function getMovementPageData() {
  const [items, buildableBomParents, voidLogs, voidReversalRows] = await Promise.all([
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      orderBy: { sku: "asc" }
    }),
    prisma.bOM.findMany({
      where: {
        active: true,
        parentItem: {
          lifecycleStatus: { not: "OBSOLETE" },
          category: ItemCategory.FINISHED_GOOD
        },
        lines: {
          some: {},
          none: { componentItem: { lifecycleStatus: "OBSOLETE" } }
        }
      },
      select: { parentItemId: true },
      orderBy: { createdAt: "desc" }
    }),
    prisma.auditLog.findMany({
      where: { action: "VOID_STOCK_MOVEMENT", entityType: "StockMovement" },
      select: { entityId: true }
    }),
    prisma.stockMovement.findMany({
      where: { reference: { startsWith: "VOID:" } },
      select: { reference: true }
    })
  ]);

  const voidedMovementIds = Array.from(new Set([
    ...voidLogs.map((log) => log.entityId),
    ...voidReversalRows
      .map((movement) => movement.reference?.slice("VOID:".length))
      .filter((movementId): movementId is string => Boolean(movementId))
  ]));

  const movements = await prisma.stockMovement.findMany({
    where: visibleStockMovementWhere(voidedMovementIds),
    include: { item: true },
    orderBy: { createdAt: "desc" },
    take: 25
  });

  const formItems = items.map((item) => ({
    id: item.id,
    sku: item.sku,
    description: item.description
  }));
  const buildableItemIds = Array.from(new Set(buildableBomParents.map((bom) => bom.parentItemId)));

  return { formItems, buildableItemIds, movements, voidedMovementIds };
}
