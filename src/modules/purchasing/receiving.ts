import { LifecycleStatus, MovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertPermission, AuthorizationError, type AuthenticatedActor } from "@/modules/auth/permissions";
import { createStockMovementInTransaction } from "@/modules/inventory/service";
import { syncLeadTimeAveragesForPurchaseOrder } from "@/modules/tracking/service";

type ReceiveLotInput =
  | { stockLotId: string; lot?: never }
  | {
      stockLotId?: never;
      lot: {
        lotCode: string;
        receivedAt: Date;
        unitCost: number;
        currency?: string;
      };
    };

export type ReceivePurchaseOrderLineInput = ReceiveLotInput & {
  purchaseOrderLineId: string;
  quantity: number;
  actor: AuthenticatedActor;
  reference: string;
  notes: string;
  overrideReason?: string;
};

const receivableStatuses = new Set(["ORDERED", "PARTIALLY_RECEIVED"]);

export async function receivePurchaseOrderLine(input: ReceivePurchaseOrderLineInput) {
  assertHumanReceivingActor(input.actor);
  assertPermission(input.actor, "receiving:confirm");
  const receiveLot = normalizeReceiveLotInput(input);

  const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const line = await tx.purchaseOrderLine.findUniqueOrThrow({
      where: { id: input.purchaseOrderLineId },
      include: {
        item: true,
        purchaseOrder: { include: { supplier: true, invoices: true } }
      }
    });

    if (!receivableStatuses.has(line.purchaseOrder.status)) {
      throw new Error(`Cannot receive against a ${line.purchaseOrder.status.toLowerCase()} purchase order.`);
    }

    if (input.quantity <= 0) {
      throw new Error("Receive quantity must be positive.");
    }

    const remaining = line.quantity - line.receivedQuantity;
    const overReceipt = input.quantity > remaining;
    if (overReceipt && (input.actor.role !== "ADMIN" || !input.overrideReason?.trim())) {
      throw new Error(`Cannot receive more than remaining ordered quantity (${remaining}) without admin override reason.`);
    }

    if (line.item.lifecycleStatus === LifecycleStatus.OBSOLETE && (input.actor.role !== "ADMIN" || !input.overrideReason?.trim())) {
      throw new Error("Cannot receive obsolete items without admin override reason.");
    }

    const movement = await createStockMovementInTransaction(tx, {
      itemId: line.itemId,
      stockLotId: receiveLot.stockLotId,
      newLot: receiveLot.newLot,
      purchaseOrderLineId: line.id,
      movementType: MovementType.RECEIVE,
      quantity: input.quantity,
      reason: input.notes,
      reference: input.reference,
      actorType: "USER",
      actorId: input.actor.id
    });

    const updatedLine = await tx.purchaseOrderLine.update({
      where: { id: line.id },
      data: { receivedQuantity: { increment: input.quantity } }
    });

    const orderLines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: line.purchaseOrderId },
      select: { quantity: true, receivedQuantity: true }
    });
    const status = orderLines.every((orderLine) => orderLine.receivedQuantity >= orderLine.quantity)
      ? "RECEIVED"
      : "PARTIALLY_RECEIVED";

    const updatedOrder = await tx.purchaseOrder.update({
      where: { id: line.purchaseOrderId },
      data: { status },
      include: { supplier: true, lines: true }
    });

    await writeAuditLog({
      actorType: "USER",
      actorId: input.actor.id,
      action: "RECEIVE_PURCHASE_ORDER_LINE",
      entityType: "PurchaseOrderLine",
      entityId: line.id,
      payload: {
        purchaseOrderId: line.purchaseOrderId,
        stockMovementId: movement.id,
        quantity: input.quantity,
        reference: input.reference,
        notes: input.notes,
        overrideReason: input.overrideReason,
        stockLotId: movement.stockLotId
      }
    }, tx);

    return {
      stockMovement: movement,
      purchaseOrderLine: updatedLine,
      purchaseOrder: updatedOrder
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  await syncLeadTimeAveragesForPurchaseOrder(result.purchaseOrder.id, input.actor.id, "USER").catch(() => undefined);
  return result;
}

function assertHumanReceivingActor(actor: AuthenticatedActor) {
  if (actor.type !== "HUMAN" || actor.actorType !== "USER") {
    throw new AuthorizationError("Physical stock receiving requires an authenticated human actor.", 403);
  }
}

function normalizeReceiveLotInput(input: ReceivePurchaseOrderLineInput) {
  const runtimeInput = input as { stockLotId?: unknown; lot?: unknown };
  const stockLotId = typeof runtimeInput.stockLotId === "string" ? runtimeInput.stockLotId.trim() : "";
  const lot = normalizeNewLot(runtimeInput.lot);

  if ((stockLotId.length > 0 && lot) || (stockLotId.length === 0 && !lot)) {
    throw new Error("Receiving requires exactly one selected or newly created lot with cost/provenance.");
  }

  if (stockLotId.length > 0) return { stockLotId, newLot: undefined };
  return { stockLotId: undefined, newLot: lot };
}

function normalizeNewLot(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const lot = value as { lotCode?: unknown; receivedAt?: unknown; unitCost?: unknown; currency?: unknown };
  const lotCode = typeof lot.lotCode === "string" ? lot.lotCode.trim() : "";
  const receivedAt = lot.receivedAt instanceof Date ? lot.receivedAt : undefined;
  const unitCost = typeof lot.unitCost === "number" ? lot.unitCost : Number.NaN;
  const currency = typeof lot.currency === "string" && lot.currency.trim() ? lot.currency.trim() : undefined;

  if (!lotCode || !receivedAt || Number.isNaN(receivedAt.getTime()) || !Number.isFinite(unitCost) || unitCost < 0) {
    return undefined;
  }

  return { lotCode, receivedAt, unitCost, currency };
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
