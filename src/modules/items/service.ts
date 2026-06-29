import { CostConfidence, LifecycleStatus, MovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { resolveSupplierSelection } from "@/modules/suppliers/service";
import type { ItemFormInput } from "./form";

type ItemMutationInput = ItemFormInput & {
  actorId: string;
};

export async function getItems(options: { archivedOnly?: boolean } = {}) {
  return prisma.item.findMany({
    where: options.archivedOnly ? { lifecycleStatus: LifecycleStatus.OBSOLETE } : { lifecycleStatus: { not: LifecycleStatus.OBSOLETE } },
    include: {
      preferredSupplier: true,
      storageLocation: true
    },
    orderBy: { sku: "asc" }
  });
}

export async function createItem(input: ItemMutationInput & { storageLocationId: string }) {
  return prisma.$transaction(async (tx) => {
    const preferredSupplierId = await resolveSupplierSelection({
      preferredSupplierId: input.preferredSupplierId,
      customSupplierName: input.customSupplierName,
      actorId: input.actorId,
      client: tx
    });

    const item = await tx.item.create({
      data: {
        sku: input.sku,
        manufacturerPartNo: input.manufacturerPartNo ?? null,
        supplierSku: input.supplierSku ?? null,
        description: input.description,
        category: input.category,
        unit: input.unit,
        reorderPoint: input.reorderPoint,
        targetStock: input.targetStock,
        leadTimeDays: input.leadTimeDays,
        preferredSupplierId,
        lifecycleStatus: input.lifecycleStatus,
        storageLocationId: input.storageLocationId,
        estimatedUnitCost: input.estimatedUnitCost ?? null,
        costCurrency: input.costCurrency ?? "USD",
        costConfidence: input.costConfidence ?? CostConfidence.UNKNOWN,
        costSourceRef: input.costSourceRef ?? null
      }
    });

    await writeAuditLog({
      actorType: "USER",
      actorId: input.actorId,
      action: "CREATE_ITEM",
      entityType: "Item",
      entityId: item.id,
      payload: { ...input, preferredSupplierId }
    }, tx);

    return item;
  });
}

export async function updateItem(input: ItemMutationInput & { id: string }) {
  return prisma.$transaction(async (tx) => {
    const existingItem = await tx.item.findUniqueOrThrow({
      where: { id: input.id },
      select: { estimatedUnitCost: true, costCurrency: true }
    });
    const preferredSupplierId = await resolveSupplierSelection({
      preferredSupplierId: input.preferredSupplierId,
      customSupplierName: input.customSupplierName,
      actorId: input.actorId,
      client: tx
    });

    const item = await tx.item.update({
      where: { id: input.id },
      data: {
        sku: input.sku,
        manufacturerPartNo: input.manufacturerPartNo ?? null,
        supplierSku: input.supplierSku ?? null,
        description: input.description,
        category: input.category,
        unit: input.unit,
        reorderPoint: input.reorderPoint,
        targetStock: input.targetStock,
        leadTimeDays: input.leadTimeDays,
        preferredSupplierId,
        lifecycleStatus: input.lifecycleStatus,
        estimatedUnitCost: input.estimatedUnitCost ?? null,
        costCurrency: input.costCurrency ?? "USD",
        costConfidence: input.costConfidence ?? CostConfidence.UNKNOWN,
        costSourceRef: input.costSourceRef ?? null
      }
    });

    await writeAuditLog({
      actorType: "USER",
      actorId: input.actorId,
      action: "UPDATE_ITEM",
      entityType: "Item",
      entityId: item.id,
      payload: { ...input, preferredSupplierId }
    }, tx);

    await syncMostRecentReceiptLotCostFromManualItemPrice(tx, {
      itemId: item.id,
      actorId: input.actorId,
      newEstimatedUnitCost: input.estimatedUnitCost ?? null,
      newCostCurrency: input.costCurrency ?? "USD",
      previousEstimatedUnitCost: existingItem.estimatedUnitCost,
      previousCostCurrency: existingItem.costCurrency
    });

    return item;
  });
}

async function syncMostRecentReceiptLotCostFromManualItemPrice(
  tx: Prisma.TransactionClient,
  input: {
    itemId: string;
    actorId: string;
    newEstimatedUnitCost: number | null;
    newCostCurrency: string;
    previousEstimatedUnitCost: Prisma.Decimal | null;
    previousCostCurrency: string;
  }
) {
  if (input.newEstimatedUnitCost === null) return;
  const previousCost = input.previousEstimatedUnitCost === null ? null : Number(input.previousEstimatedUnitCost);
  const costChanged = previousCost === null
    || Math.abs(previousCost - input.newEstimatedUnitCost) >= 0.0001
    || input.previousCostCurrency !== input.newCostCurrency;
  if (!costChanged) return;

  const latestReceipt = await tx.stockMovement.findFirst({
    where: {
      itemId: input.itemId,
      movementType: MovementType.RECEIVE,
      stockLotId: { not: null },
      purchaseOrderLineId: { not: null }
    },
    include: { stockLot: true },
    orderBy: { createdAt: "desc" }
  });
  if (!latestReceipt?.stockLot) return;

  const previousLotCost = Number(latestReceipt.stockLot.unitCost);
  if (Math.abs(previousLotCost - input.newEstimatedUnitCost) < 0.0001 && latestReceipt.stockLot.currency === input.newCostCurrency) return;

  await tx.stockLot.update({
    where: { id: latestReceipt.stockLot.id },
    data: { unitCost: input.newEstimatedUnitCost, currency: input.newCostCurrency }
  });
  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "UPDATE_RECENT_RECEIPT_LOT_COST_FROM_ITEM_PRICE",
    entityType: "StockLot",
    entityId: latestReceipt.stockLot.id,
    payload: {
      itemId: input.itemId,
      stockMovementId: latestReceipt.id,
      purchaseOrderLineId: latestReceipt.purchaseOrderLineId,
      lotCode: latestReceipt.stockLot.lotCode,
      previousUnitCost: previousLotCost,
      previousCurrency: latestReceipt.stockLot.currency,
      newUnitCost: input.newEstimatedUnitCost,
      newCurrency: input.newCostCurrency,
      note: "Manual item price update syncs only the most recent PO receipt lot; older stock lots retain historical valuation."
    }
  }, tx);
}

export async function updateItemUseGroupOverride(input: { id: string; useGroupOverride?: string | null; actorId: string }) {
  const useGroupOverride = input.useGroupOverride?.trim() || null;
  const item = await prisma.item.update({
    where: { id: input.id },
    data: { useGroupOverride }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "UPDATE_ITEM_USE_GROUP_OVERRIDE",
    entityType: "Item",
    entityId: item.id,
    payload: { itemId: item.id, sku: item.sku, useGroupOverride }
  });

  return item;
}

export async function archiveItem(input: { id: string; actorId: string }) {
  const item = await prisma.item.update({
    where: { id: input.id },
    data: { lifecycleStatus: LifecycleStatus.OBSOLETE }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "ARCHIVE_ITEM",
    entityType: "Item",
    entityId: item.id,
    payload: input
  });

  return item;
}

export async function unarchiveItem(input: { id: string; actorId: string }) {
  const item = await prisma.item.update({
    where: { id: input.id },
    data: { lifecycleStatus: LifecycleStatus.ACTIVE }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "UNARCHIVE_ITEM",
    entityType: "Item",
    entityId: item.id,
    payload: input
  });

  return item;
}

