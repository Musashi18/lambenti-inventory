import { CostConfidence, LifecycleStatus } from "@prisma/client";
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

    return item;
  });
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

