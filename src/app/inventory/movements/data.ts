import { ItemCategory, MovementType, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type MovementWithItem = Prisma.StockMovementGetPayload<{ include: { item: true } }>;

type Balance = {
  onHand: number;
  reserved: number;
  available: number;
};

export type MovementPageRow = MovementWithItem & {
  signedQuantity: number;
  balanceAfter: Balance;
};

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

  const visibleWhere = visibleStockMovementWhere(voidedMovementIds);
  const recentMovements = await prisma.stockMovement.findMany({
    where: visibleWhere,
    include: { item: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 25
  });

  const itemIds = Array.from(new Set(recentMovements.map((movement) => movement.itemId)));
  const movementHistory = itemIds.length === 0
    ? []
    : await prisma.stockMovement.findMany({
      where: {
        AND: [
          visibleWhere,
          { itemId: { in: itemIds } }
        ]
      },
      include: { item: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
  const balancesByMovementId = calculateMovementBalances(movementHistory);
  const movements = recentMovements.map((movement) => ({
    ...movement,
    signedQuantity: movementSignedQuantity(movement),
    balanceAfter: balancesByMovementId.get(movement.id) ?? emptyBalance()
  }));

  const formItems = items.map((item) => ({
    id: item.id,
    sku: item.sku,
    description: item.description,
    category: item.category
  }));
  const buildableItemIds = Array.from(new Set(buildableBomParents.map((bom) => bom.parentItemId)));

  return { formItems, buildableItemIds, movements, voidedMovementIds };
}

function calculateMovementBalances(movements: MovementWithItem[]) {
  const balancesByItem = new Map<string, Balance>();
  const balancesByMovementId = new Map<string, Balance>();

  for (const movement of movements) {
    const balance = { ...(balancesByItem.get(movement.itemId) ?? emptyBalance()) };
    applyMovementToBalance(balance, movement);
    balancesByItem.set(movement.itemId, balance);
    balancesByMovementId.set(movement.id, { ...balance });
  }

  return balancesByMovementId;
}

function applyMovementToBalance(balance: Balance, movement: { movementType: MovementType; quantity: number }) {
  switch (movement.movementType) {
    case MovementType.RECEIVE:
    case MovementType.RETURN:
      balance.onHand += movement.quantity;
      break;
    case MovementType.CONSUME:
    case MovementType.SCRAP:
      balance.onHand -= movement.quantity;
      break;
    case MovementType.ADJUST:
      balance.onHand += movement.quantity;
      break;
    case MovementType.RESERVE:
      balance.reserved += movement.quantity;
      break;
  }
  balance.available = balance.onHand - balance.reserved;
}

function movementSignedQuantity(movement: { movementType: MovementType; quantity: number }) {
  switch (movement.movementType) {
    case MovementType.RECEIVE:
    case MovementType.RETURN:
      return movement.quantity;
    case MovementType.CONSUME:
    case MovementType.SCRAP:
      return -movement.quantity;
    case MovementType.ADJUST:
      return movement.quantity;
    case MovementType.RESERVE:
      return 0;
  }
}

function emptyBalance(): Balance {
  return { onHand: 0, reserved: 0, available: 0 };
}
