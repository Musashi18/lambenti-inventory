import { ItemCategory, Prisma, PurchaseOrderStatus, PurchaseRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertPermission, type AuthenticatedActor } from "@/modules/auth/permissions";
import { getStockSummaries } from "@/modules/inventory/service";

const OPEN_PURCHASE_ORDER_STATUSES = [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED] as const;
const OPEN_PURCHASE_REQUEST_STATUSES = [PurchaseRequestStatus.DRAFT, PurchaseRequestStatus.PENDING_APPROVAL] as const;

export async function getPurchaseRecommendations() {
  const stock = await getStockSummaries();
  const itemIds = stock.map((item) => item.itemId);
  const [recommendableItems, incomingByItemId, openRequestsByItemId] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: itemIds }, lifecycleStatus: { not: "OBSOLETE" }, category: { not: ItemCategory.FINISHED_GOOD } },
      select: {
        id: true,
        preferredSupplierId: true,
        preferredSupplier: { select: { name: true, companyName: true } },
        supplierSku: true,
        estimatedUnitCost: true,
        costConfidence: true,
        leadTimeDays: true,
        manualLeadTimeDays: true
      }
    }),
    getIncomingPurchaseOrderQuantityByItem(itemIds),
    getOpenPurchaseRequestQuantityByItem(itemIds)
  ]);
  const recommendableItemIds = new Set(recommendableItems.map((item) => item.id));
  const recommendableItemById = new Map(recommendableItems.map((item) => [item.id, item]));

  return stock
    .filter((item) => recommendableItemIds.has(item.itemId))
    .filter((item) => item.available < item.reorderPoint)
    .map((item) => {
      const incomingQty = incomingByItemId.get(item.itemId) ?? 0;
      const openDraftOrPendingRequestQty = openRequestsByItemId.get(item.itemId) ?? 0;
      const itemDetails = recommendableItemById.get(item.itemId);
      const leadTimeDays = itemDetails?.manualLeadTimeDays ?? itemDetails?.leadTimeDays ?? 0;
      const coveredAvailable = item.available + incomingQty + openDraftOrPendingRequestQty;
      const supplyGapToReorder = Math.max(item.reorderPoint - coveredAvailable, 0);
      const supplyGapToTarget = Math.max(item.targetStock - coveredAvailable, 0);
      const recommendedOrderQuantity = supplyGapToTarget;
      const leadTimePriorityDays = Math.max(leadTimeDays - 1, 0);
      const reorderPressure = item.reorderPoint > 0 ? supplyGapToReorder / item.reorderPoint : 0;
      const targetPressure = item.targetStock > 0 ? supplyGapToTarget / item.targetStock : 0;
      const priorityScore = Math.round((leadTimePriorityDays * 10) + (reorderPressure * 100) + (targetPressure * 25));
      return {
        ...item,
        incomingQty,
        openDraftOrPendingRequestQty,
        coveredAvailable,
        supplyGapToReorder,
        supplyGapToTarget,
        leadTimeDays,
        leadTimeSource: itemDetails?.manualLeadTimeDays !== null && itemDetails?.manualLeadTimeDays !== undefined ? "MANUAL" as const : "ITEM" as const,
        priorityScore,
        priority: classifyPurchasePriority({ leadTimeDays, supplyGapToReorder, available: item.available, priorityScore }),
        preferredSupplierId: itemDetails?.preferredSupplierId ?? null,
        preferredSupplierName: itemDetails?.preferredSupplier?.companyName ?? itemDetails?.preferredSupplier?.name ?? null,
        supplierSku: itemDetails?.supplierSku ?? null,
        estimatedUnitCost: itemDetails?.estimatedUnitCost?.toString() ?? null,
        costConfidence: itemDetails?.costConfidence ?? null,
        recommendedOrderQuantity
      };
    })
    .filter((item) => item.recommendedOrderQuantity > 0)
    .sort((left, right) => purchasePriorityRank(right.priority) - purchasePriorityRank(left.priority)
      || right.leadTimeDays - left.leadTimeDays
      || right.supplyGapToReorder - left.supplyGapToReorder
      || right.recommendedOrderQuantity - left.recommendedOrderQuantity
      || left.sku.localeCompare(right.sku));
}

export async function createDraftPurchaseRequest(input: {
  itemId: string;
  quantity: number;
  rationale: string;
  requestedBy: string;
  supplierId?: string;
  actorType: "USER" | "AGENT";
  actorId: string;
}) {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Draft purchase request quantity must be a positive whole number.");
  }

  return prisma.$transaction(async (tx) => {
    const item = await tx.item.findUnique({
      where: { id: input.itemId },
      select: { id: true, lifecycleStatus: true, category: true, sku: true }
    });
    if (!item) throw new Error("Item does not exist for draft purchase request.");
    if (item.lifecycleStatus === "OBSOLETE") throw new Error("Obsolete items cannot be recommended for purchase.");
    if (item.category === ItemCategory.FINISHED_GOOD) throw new Error("Finished goods are assembled internally and cannot be recommended for purchase.");

    const existingOpen = await tx.purchaseRequestLine.findFirst({
      where: {
        itemId: input.itemId,
        purchaseRequest: { status: { in: [...OPEN_PURCHASE_REQUEST_STATUSES] } }
      },
      select: { purchaseRequestId: true }
    });
    if (existingOpen) {
      throw new Error(`An open draft or pending purchase request already exists for ${item.sku}.`);
    }

    const request = await tx.purchaseRequest.create({
      data: {
        supplierId: input.supplierId,
        status: PurchaseRequestStatus.DRAFT,
        rationale: input.rationale,
        requestedBy: input.requestedBy,
        lines: {
          create: [
            {
              itemId: input.itemId,
              quantity: input.quantity
            }
          ]
        }
      },
      include: { lines: true }
    });

    await writeAuditLog({
      actorType: input.actorType,
      actorId: input.actorId,
      action: "CREATE_DRAFT_PURCHASE_REQUEST",
      entityType: "PurchaseRequest",
      entityId: request.id,
      payload: input
    }, tx);

    return request;
  });
}

export async function convertApprovedPurchaseRequestToDraftPurchaseOrder(input: {
  requestId: string;
  actor: AuthenticatedActor;
  comment?: string;
}) {
  assertPermission(input.actor, "purchaseOrder:create");

  return prisma.$transaction(async (tx) => {
    const request = await tx.purchaseRequest.findUniqueOrThrow({
      where: { id: input.requestId },
      include: {
        supplier: true,
        purchaseOrder: { include: { lines: { include: { item: true } }, supplier: true } },
        lines: { include: { item: true } }
      }
    });

    if (request.purchaseOrder) {
      return { purchaseRequest: request, purchaseOrder: request.purchaseOrder };
    }

    if (request.status !== PurchaseRequestStatus.APPROVED) {
      throw new Error(`Cannot convert purchase request from ${request.status} to a draft purchase order.`);
    }
    if (!request.supplierId) {
      throw new Error("Purchase request must have a supplier before it can be converted to a purchase order.");
    }
    if (request.lines.length === 0) {
      throw new Error("Purchase request must have at least one line before conversion.");
    }

    const lines = request.lines.map((line) => {
      if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
        throw new Error(`Purchase request line for ${line.item.sku} must have a positive whole-number quantity.`);
      }
      const unitPrice = line.targetUnitPrice ?? line.item.estimatedUnitCost;
      if (!unitPrice || new Prisma.Decimal(unitPrice).lte(0)) {
        throw new Error(`Purchase request line for ${line.item.sku} is missing unit price evidence.`);
      }
      return {
        itemId: line.itemId,
        quantity: line.quantity,
        unitPrice: new Prisma.Decimal(unitPrice)
      };
    });

    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        supplierId: request.supplierId,
        purchaseRequestId: request.id,
        status: PurchaseOrderStatus.DRAFT,
        lines: { create: lines }
      },
      include: { lines: { include: { item: true } }, supplier: true }
    });

    const purchaseRequest = await tx.purchaseRequest.update({
      where: { id: request.id },
      data: { status: PurchaseRequestStatus.CONVERTED },
      include: { lines: { include: { item: true } }, supplier: true, purchaseOrder: true }
    });

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "CONVERT_PURCHASE_REQUEST_TO_DRAFT_PO",
      entityType: "PurchaseRequest",
      entityId: request.id,
      payload: {
        fromStatus: request.status,
        toStatus: PurchaseRequestStatus.CONVERTED,
        purchaseOrderId: purchaseOrder.id,
        comment: input.comment?.trim() || undefined,
        note: "Created DRAFT purchase order for human review. Physical stock was not received into inventory."
      }
    }, tx);

    return { purchaseRequest, purchaseOrder };
  });
}

export async function getIncomingOrders() {
  return prisma.purchaseOrder.findMany({
    where: {
      status: {
        in: [...OPEN_PURCHASE_ORDER_STATUSES]
      }
    },
    include: {
      supplier: true,
      lines: {
        include: {
          item: true
        }
      }
    },
    orderBy: { expectedAt: "asc" }
  });
}

async function getIncomingPurchaseOrderQuantityByItem(itemIds: string[]) {
  const totals = new Map<string, number>();
  if (itemIds.length === 0) return totals;

  const lines = await prisma.purchaseOrderLine.findMany({
    where: {
      itemId: { in: itemIds },
      purchaseOrder: { status: { in: [...OPEN_PURCHASE_ORDER_STATUSES] } }
    },
    select: { itemId: true, quantity: true, receivedQuantity: true }
  });

  for (const line of lines) {
    const remaining = Math.max(line.quantity - line.receivedQuantity, 0);
    totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + remaining);
  }
  return totals;
}

async function getOpenPurchaseRequestQuantityByItem(itemIds: string[]) {
  const totals = new Map<string, number>();
  if (itemIds.length === 0) return totals;

  const lines = await prisma.purchaseRequestLine.findMany({
    where: {
      itemId: { in: itemIds },
      purchaseRequest: { status: { in: [...OPEN_PURCHASE_REQUEST_STATUSES] } }
    },
    select: { itemId: true, quantity: true }
  });

  for (const line of lines) {
    totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity);
  }
  return totals;
}


type PurchasePriority = "URGENT" | "HIGH" | "NORMAL" | "LOW";

function classifyPurchasePriority(input: { leadTimeDays: number; supplyGapToReorder: number; available: number; priorityScore: number }): PurchasePriority {
  if (input.leadTimeDays <= 1) return "LOW";
  if (input.available <= 0 && input.supplyGapToReorder > 0 && input.leadTimeDays >= 7) return "URGENT";
  if (input.leadTimeDays >= 21 || input.priorityScore >= 180) return "URGENT";
  if (input.leadTimeDays >= 7 || input.supplyGapToReorder > 0) return "HIGH";
  return "NORMAL";
}

function purchasePriorityRank(priority: PurchasePriority) {
  if (priority === "URGENT") return 3;
  if (priority === "HIGH") return 2;
  if (priority === "NORMAL") return 1;
  return 0;
}
