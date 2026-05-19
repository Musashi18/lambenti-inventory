import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getStockSummaries } from "@/modules/inventory/service";

export async function getPurchaseRecommendations() {
  const stock = await getStockSummaries();
  return stock
    .filter((item) => item.available < item.reorderPoint)
    .map((item) => ({
      ...item,
      recommendedOrderQuantity: Math.max(item.targetStock - item.available, 0)
    }));
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
  const request = await prisma.purchaseRequest.create({
    data: {
      supplierId: input.supplierId,
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
  });

  return request;
}

export async function getIncomingOrders() {
  return prisma.purchaseOrder.findMany({
    where: {
      status: {
        in: ["ORDERED", "PARTIALLY_RECEIVED"]
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

