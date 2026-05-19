import { ItemCategory, LifecycleStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";

export async function getItems() {
  return prisma.item.findMany({
    include: {
      preferredSupplier: true
    },
    orderBy: { sku: "asc" }
  });
}

export async function createItem(input: {
  sku: string;
  manufacturerPartNo?: string;
  supplierSku?: string;
  description: string;
  category: ItemCategory;
  unit: Unit;
  reorderPoint: number;
  targetStock: number;
  leadTimeDays: number;
  preferredSupplierId?: string;
  lifecycleStatus: LifecycleStatus;
  storageLocation: string;
  actorId: string;
}) {
  const item = await prisma.item.create({
    data: {
      sku: input.sku,
      manufacturerPartNo: input.manufacturerPartNo,
      supplierSku: input.supplierSku,
      description: input.description,
      category: input.category,
      unit: input.unit,
      reorderPoint: input.reorderPoint,
      targetStock: input.targetStock,
      leadTimeDays: input.leadTimeDays,
      preferredSupplierId: input.preferredSupplierId,
      lifecycleStatus: input.lifecycleStatus,
      storageLocation: input.storageLocation
    }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "CREATE_ITEM",
    entityType: "Item",
    entityId: item.id,
    payload: input
  });

  return item;
}

