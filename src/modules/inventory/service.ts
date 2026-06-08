import { ItemCategory, LifecycleStatus, MovementType, Prisma, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import type { StockSummary } from "@/types/inventory";
import { normalizeCostToUsd } from "@/modules/currency";
import { calculateStockPosition, validateStockMovementInput } from "./ledger";

type InventoryClient = Prisma.TransactionClient;

export type CreateStockMovementInput = {
  itemId: string;
  stockLotId?: string;
  newLot?: {
    lotCode: string;
    receivedAt: Date;
    unitCost: number;
    currency?: string;
  };
  purchaseOrderLineId?: string;
  movementType: MovementType;
  quantity: number;
  reason?: string;
  reference?: string;
  actorType?: "USER" | "AGENT";
  actorId: string;
  allowVoidReference?: boolean;
};

export async function getStockSummaries(options: { includeObsolete?: boolean } = {}): Promise<StockSummary[]> {
  const items = await prisma.item.findMany({
    where: options.includeObsolete ? undefined : { lifecycleStatus: { not: LifecycleStatus.OBSOLETE } },
    include: { stockMovements: true },
    orderBy: { sku: "asc" }
  });

  return items.map((item) => {
    const stockPosition = calculateStockPosition(item.stockMovements);

    return {
      itemId: item.id,
      sku: item.sku,
      description: item.description,
      reorderPoint: item.reorderPoint,
      targetStock: item.targetStock,
      onHand: stockPosition.onHand,
      reserved: stockPosition.reserved,
      available: stockPosition.available
    };
  });
}

export async function createStockMovement(input: CreateStockMovementInput) {
  return withSerializableRetry(() => prisma.$transaction(
    (tx) => createStockMovementInTransaction(tx, input),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ));
}

export async function createStockMovementInTransaction(client: InventoryClient, input: CreateStockMovementInput) {
  assertAllowedStockMovementReference(input.reference, input.allowVoidReference);
  await lockItemForStockMutation(client, input.itemId);

  let stockLotId = input.stockLotId;
  if (input.newLot) {
    if (input.movementType !== MovementType.RECEIVE) {
      throw new Error("Only receive movements can create a new lot.");
    }
    if (input.newLot.unitCost < 0) {
      throw new Error("New lot unit cost cannot be negative.");
    }
    const normalizedLotCost = normalizeCostToUsd(input.newLot.unitCost, input.newLot.currency);
    const lot = await client.stockLot.create({
      data: {
        itemId: input.itemId,
        lotCode: input.newLot.lotCode,
        receivedAt: input.newLot.receivedAt,
        unitCost: normalizedLotCost.estimatedUnitCost ?? input.newLot.unitCost,
        currency: normalizedLotCost.costCurrency
      }
    });
    stockLotId = lot.id;
  }

  if (stockLotId) {
    await assertStockLotBelongsToItem(client, stockLotId, input.itemId);
  }

  const movementReason = normalizeMovementReason(input.movementType, input.reason);
  const movementInput = { ...input, stockLotId, reason: movementReason };
  if (stockLotId) {
    const lotCurrent = await getLotStockPosition(stockLotId, client);
    validateLotStockMovement(movementInput, lotCurrent);
  }

  const current = await getStockPosition(input.itemId, client);
  validateStockMovementInput(movementInput, current);

  const movement = await client.stockMovement.create({
    data: {
      itemId: input.itemId,
      stockLotId,
      purchaseOrderLineId: input.purchaseOrderLineId,
      movementType: input.movementType,
      quantity: input.quantity,
      reason: movementReason,
      reference: input.reference,
      actorType: input.actorType ?? "USER",
      actorId: input.actorId
    }
  });

  await writeAuditLog({
    actorType: input.actorType ?? "USER",
    actorId: input.actorId,
    action: "CREATE_STOCK_MOVEMENT",
    entityType: "StockMovement",
    entityId: movement.id,
    payload: { ...input, stockLotId, reason: movementReason }
  }, client);

  return movement;
}

export async function createStockMovementReversal(input: { movementId: string; actorId: string; actorType?: "USER" | "AGENT"; reason?: string }) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const [existingVoidLog, existingReversal] = await Promise.all([
      tx.auditLog.findFirst({
        where: { action: "VOID_STOCK_MOVEMENT", entityType: "StockMovement", entityId: input.movementId }
      }),
      tx.stockMovement.findFirst({
        where: { reference: `VOID:${input.movementId}` },
        select: { id: true }
      })
    ]);
    if (existingVoidLog || existingReversal) {
      throw new Error("This stock movement has already been voided/deleted by a reversal entry.");
    }

    const original = await tx.stockMovement.findUnique({
      where: { id: input.movementId },
      include: { item: true, purchaseOrderLine: true }
    });
    if (!original) throw new Error("Stock movement does not exist.");
    if (original.reference?.startsWith("VOID:")) {
      throw new Error("A reversal/void entry cannot be voided again.");
    }
    if (original.movementType === MovementType.RESERVE) {
      throw new Error("Reserve entries cannot be deleted safely yet because the ledger has no release-reservation movement type.");
    }
    if (original.purchaseOrderLineId && original.movementType !== MovementType.RECEIVE) {
      throw new Error("Only purchase-order receipt movements can be voided through the PO rollback path.");
    }
    if (original.purchaseOrderLine && original.purchaseOrderLine.receivedQuantity < original.quantity) {
      throw new Error("Cannot void this purchase-order receipt because the PO line has already been rolled back below the receipt quantity.");
    }

    await lockItemForStockMutation(tx, original.itemId);
    const reversalType = reversalMovementType(original.movementType);
    const reversalQuantity = original.movementType === MovementType.ADJUST ? -original.quantity : original.quantity;
    const reversal = await createStockMovementInTransaction(tx, {
      itemId: original.itemId,
      stockLotId: original.stockLotId ?? undefined,
      purchaseOrderLineId: original.purchaseOrderLineId ?? undefined,
      movementType: reversalType,
      quantity: reversalQuantity,
      reason: input.reason?.trim() || `Operator deleted/voided stock movement ${original.id}; this reversal preserves the immutable ledger trail.`,
      reference: `VOID:${original.id}`,
      actorType: input.actorType ?? "USER",
      actorId: input.actorId,
      allowVoidReference: true
    });

    let purchaseOrderRollback: { purchaseOrderLineId: string; purchaseOrderId: string; receivedQuantity: number; status: string } | undefined;
    if (original.purchaseOrderLineId && original.purchaseOrderLine) {
      const updatedLine = await tx.purchaseOrderLine.update({
        where: { id: original.purchaseOrderLineId },
        data: { receivedQuantity: { decrement: original.quantity } }
      });
      const orderLines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: updatedLine.purchaseOrderId },
        select: { quantity: true, receivedQuantity: true }
      });
      const status = purchaseOrderStatusFromReceivedQuantities(orderLines);
      await tx.purchaseOrder.update({ where: { id: updatedLine.purchaseOrderId }, data: { status } });
      purchaseOrderRollback = {
        purchaseOrderLineId: updatedLine.id,
        purchaseOrderId: updatedLine.purchaseOrderId,
        receivedQuantity: updatedLine.receivedQuantity,
        status
      };
    }

    await writeAuditLog({
      actorType: input.actorType ?? "USER",
      actorId: input.actorId,
      action: "VOID_STOCK_MOVEMENT",
      entityType: "StockMovement",
      entityId: original.id,
      payload: {
        reversalMovementId: reversal.id,
        originalMovementType: original.movementType,
        originalQuantity: original.quantity,
        originalStockLotId: original.stockLotId,
        originalPurchaseOrderLineId: original.purchaseOrderLineId,
        purchaseOrderRollback,
        itemSku: original.item.sku,
        note: "No historical stock movement row was hard-deleted; inventory effect was reversed with a compensating ledger row."
      }
    }, tx);

    return reversal;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function recordAssembledPackageMovement(input: {
  finishedItemId: string;
  quantity: number;
  reason?: string;
  reference?: string;
  actorId: string;
  actorType?: "USER" | "AGENT";
}) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Assembled package quantity must be a positive whole number.");
  }

  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const bom = await tx.bOM.findFirst({
      where: {
        parentItemId: input.finishedItemId,
        active: true,
        parentItem: {
          lifecycleStatus: { not: LifecycleStatus.OBSOLETE },
          category: ItemCategory.FINISHED_GOOD
        }
      },
      include: {
        parentItem: true,
        lines: {
          include: { componentItem: true },
          orderBy: { id: "asc" }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    if (!bom) {
      throw new Error("No active finished-good BOM exists for the selected assembled package.");
    }
    if (bom.lines.length === 0) {
      throw new Error("Cannot assemble a finished package from a BOM with no component lines.");
    }
    assertNoObsoleteBomComponentLines(bom.lines);

    const reference = input.reference?.trim() || `BUILD-${bom.parentItem.sku}-${Date.now()}`;
    const baseReason = input.reason?.trim() || `Assembled ${input.quantity} × ${bom.parentItem.sku} package(s) from active BOM ${bom.version}.`;
    const movements = [];

    movements.push(await createStockMovementInTransaction(tx, {
      itemId: bom.parentItemId,
      movementType: MovementType.RECEIVE,
      quantity: input.quantity,
      reason: baseReason,
      reference,
      actorType: input.actorType ?? "USER",
      actorId: input.actorId
    }));

    for (const line of bom.lines) {
      const componentQuantity = line.quantity * input.quantity;
      movements.push(await createStockMovementInTransaction(tx, {
        itemId: line.componentItemId,
        movementType: MovementType.CONSUME,
        quantity: componentQuantity,
        reason: `${baseReason} Consumed ${line.quantity} × ${line.componentItem.sku} per package.`,
        reference,
        actorType: input.actorType ?? "USER",
        actorId: input.actorId
      }));
    }

    await writeAuditLog({
      actorType: input.actorType ?? "USER",
      actorId: input.actorId,
      action: "RECORD_ASSEMBLED_PACKAGE_BUILD",
      entityType: "BOM",
      entityId: bom.id,
      payload: {
        finishedItemId: bom.parentItemId,
        finishedSku: bom.parentItem.sku,
        version: bom.version,
        quantity: input.quantity,
        reference,
        movementIds: movements.map((movement) => movement.id),
        note: "Finished package receive and component consumption were recorded in one transaction."
      }
    }, tx);

    return movements;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

async function lockItemForStockMutation(client: InventoryClient, itemId: string) {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${itemId}))`;
}

async function assertStockLotBelongsToItem(client: InventoryClient, stockLotId: string, itemId: string) {
  const lot = await client.stockLot.findUnique({
    where: { id: stockLotId },
    select: { itemId: true }
  });

  if (!lot) {
    throw new Error("Stock lot does not exist.");
  }

  if (lot.itemId !== itemId) {
    throw new Error("Stock lot does not belong to the selected item.");
  }
}

function validateLotStockMovement(
  input: Parameters<typeof validateStockMovementInput>[0],
  current: Parameters<typeof validateStockMovementInput>[1]
) {
  try {
    validateStockMovementInput(input, current);
  } catch (error) {
    if (error instanceof Error && /negative/i.test(error.message)) {
      throw new Error(`Stock movement would create negative lot stock. ${error.message}`);
    }
    throw error;
  }
}

function assertAllowedStockMovementReference(reference: string | undefined, allowVoidReference: boolean | undefined) {
  if (!allowVoidReference && reference?.trim().startsWith("VOID:")) {
    throw new Error("The VOID: reference prefix is reserved for audited stock-movement reversal rows.");
  }
}

function normalizeMovementReason(movementType: MovementType, reason?: string) {
  const trimmed = reason?.trim();
  if (trimmed) return trimmed;
  if (movementType === MovementType.SCRAP) return "Operator did not provide a scrap reason; recorded for audit review.";
  return `Operator recorded ${movementType.toLowerCase()} movement without an optional reason.`;
}

function reversalMovementType(movementType: MovementType) {
  switch (movementType) {
    case MovementType.RECEIVE:
    case MovementType.RETURN:
      return MovementType.CONSUME;
    case MovementType.CONSUME:
    case MovementType.SCRAP:
      return MovementType.RETURN;
    case MovementType.ADJUST:
      return MovementType.ADJUST;
    case MovementType.RESERVE:
      throw new Error("Reserve entries cannot be reversed without a release-reservation movement type.");
    default:
      return MovementType.ADJUST;
  }
}

function purchaseOrderStatusFromReceivedQuantities(lines: { quantity: number; receivedQuantity: number }[]) {
  if (lines.length > 0 && lines.every((line) => line.receivedQuantity >= line.quantity)) {
    return PurchaseOrderStatus.RECEIVED;
  }
  if (lines.some((line) => line.receivedQuantity > 0)) {
    return PurchaseOrderStatus.PARTIALLY_RECEIVED;
  }
  return PurchaseOrderStatus.ORDERED;
}

function assertNoObsoleteBomComponentLines(lines: { componentItem: { sku: string; lifecycleStatus: LifecycleStatus } }[]) {
  const obsoleteSkus = lines
    .filter((line) => line.componentItem.lifecycleStatus === LifecycleStatus.OBSOLETE)
    .map((line) => line.componentItem.sku);
  if (obsoleteSkus.length > 0) {
    throw new Error(`Cannot record build while obsolete BOM component lines remain: ${obsoleteSkus.join(", ")}. Correct the BOM before consuming inventory.`);
  }
}

async function getStockPosition(itemId: string, client: InventoryClient = prisma) {
  const movements = await client.stockMovement.findMany({
    where: { itemId },
    select: { movementType: true, quantity: true }
  });

  return calculateStockPosition(movements);
}

async function getLotStockPosition(stockLotId: string, client: InventoryClient) {
  const movements = await client.stockMovement.findMany({
    where: { stockLotId },
    select: { movementType: true, quantity: true }
  });

  return calculateStockPosition(movements);
}

async function withSerializableRetry<T>(operation: () => Promise<T>, maxAttempts = 16): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableSerializableConflict(error) || attempt === maxAttempts) {
        throw error;
      }
      await delayBeforeRetry(attempt);
    }
  }

  throw lastError;
}

function delayBeforeRetry(attempt: number) {
  const delayMs = Math.min(15 * 2 ** (attempt - 1), 500);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetryableSerializableConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
