import { getStockSummaries } from "@/modules/inventory/service";
import { calculatePricedItemValuations } from "@/modules/inventory/valuation";
import { getIncomingOrders, getPurchaseRecommendations } from "@/modules/purchasing/service";
import { prisma } from "@/lib/prisma";
import type { ShortageSummary } from "@/types/inventory";

export async function getDashboardSummary() {
  const stock = await getStockSummaries();
  const lowStockItems = stock.filter((item) => item.available < item.reorderPoint);
  const [activeItems, activeFinishedBoms, reservations] = await Promise.all([
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      select: { id: true, sku: true, category: true }
    }),
    prisma.bOM.findMany({
      where: {
        active: true,
        parentItem: { lifecycleStatus: { not: "OBSOLETE" }, category: "FINISHED_GOOD" },
        lines: { some: { componentItem: { lifecycleStatus: { not: "OBSOLETE" } } } }
      },
      include: {
        parentItem: true,
        lines: {
          where: { componentItem: { lifecycleStatus: { not: "OBSOLETE" } } },
          include: { componentItem: true },
          orderBy: { id: "asc" }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.buildReservation.findMany({
      where: { item: { lifecycleStatus: { not: "OBSOLETE" } } },
      include: { item: true }
    })
  ]);

  const shortages: ShortageSummary[] = reservations
    .map((reservation) => {
      const current = stock.find((item) => item.itemId === reservation.itemId);
      const available = current?.available ?? 0;
      return {
        itemId: reservation.itemId,
        sku: reservation.item.sku,
        demand: reservation.quantity,
        available,
        shortage: Math.max(reservation.quantity - available, 0)
      };
    })
    .filter((item) => item.shortage > 0);

  const itemCategoryById = new Map(activeItems.map((item) => [item.id, item.category]));
  const stockByItemId = new Map(stock.map((item) => [item.itemId, item]));
  const componentsOnHand = stock
    .filter((item) => itemCategoryById.get(item.itemId) !== "FINISHED_GOOD")
    .reduce((total, item) => total + item.onHand, 0);
  const assembledPackages = stock
    .filter((item) => itemCategoryById.get(item.itemId) === "FINISHED_GOOD")
    .reduce((total, item) => total + item.onHand, 0);
  const buildCapacity = summarizeBuildCapacity(activeFinishedBoms, stockByItemId);

  const pricedItems = await prisma.item.findMany({
    where: { lifecycleStatus: { not: "OBSOLETE" }, estimatedUnitCost: { not: null } },
    include: { stockMovements: { select: { movementType: true, quantity: true } } },
    orderBy: { sku: "asc" }
  });

  const inventoryValuation = calculatePricedItemValuations(
    pricedItems.map((item) => ({
      itemId: item.id,
      sku: item.sku,
      description: item.description,
      unitCost: item.estimatedUnitCost === null ? null : Number(item.estimatedUnitCost),
      currency: item.costCurrency,
      movements: item.stockMovements
    }))
  ).totalValue;

  const recommendations = await getPurchaseRecommendations();
  const incomingOrders = await getIncomingOrders();
  const [emailImportsNeedingReview, pendingPurchaseRequests, invoicesNeedingAction, openAutomationFindings, failedAutomationRuns] = await Promise.all([
    prisma.emailOrderImport.findMany({
      where: {
        archivedAt: null,
        OR: [
          { status: "NEEDS_REVIEW" },
          { lines: { some: { OR: [{ matchedItemId: null }, { matchConfidence: "UNMATCHED" }] } } }
        ]
      },
      include: { lines: true, supplier: true },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.purchaseRequest.findMany({
      where: { status: { in: ["DRAFT", "PENDING_APPROVAL"] } },
      include: { supplier: true, lines: { include: { item: true } } },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.supplierInvoice.findMany({
      where: { status: { in: ["RECEIVED", "APPROVED"] } },
      include: { supplier: true },
      orderBy: { invoiceDate: "asc" },
      take: 5
    }),
    prisma.automationFinding.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 5
    }),
    prisma.automationRun.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 5
    })
  ]);

  const humanReviewActions = [
    ...emailImportsNeedingReview.map((orderImport) => ({
      kind: "Email import",
      label: orderImport.externalOrderId ? `Review order ${orderImport.externalOrderId}` : `Review ${orderImport.supplier?.name ?? orderImport.supplierName}`,
      reason: `${orderImport.lines.filter((line) => !line.matchedItemId || line.matchConfidence === "UNMATCHED").length} unmatched/uncertain line(s) need catalog matching before all effects are safe.`,
      href: "/integrations/email-import"
    })),
    ...recommendations.slice(0, 5).map((item) => ({
      kind: "Suggested PO",
      label: `Draft/order ${item.recommendedOrderQuantity} × ${item.sku}`,
      reason: `Available ${item.available}; reorder point ${item.reorderPoint}; target ${item.targetStock}.`,
      href: "/purchasing/recommendations"
    })),
    ...pendingPurchaseRequests.map((request) => ({
      kind: "Purchase request",
      label: `${request.status === "DRAFT" ? "Draft" : "Approve"} request ${request.id.slice(-8).toUpperCase()}`,
      reason: `${request.lines.map((line) => `${line.quantity} × ${line.item.sku}`).join(", ") || "No lines"}${request.supplier ? ` · ${request.supplier.name}` : ""}.`,
      href: "/purchasing/requests"
    })),
    ...invoicesNeedingAction.map((invoice) => ({
      kind: "Invoice/payment",
      label: `${invoice.status === "RECEIVED" ? "Approve" : "Pay"} invoice ${invoice.invoiceNumber}`,
      reason: `${invoice.supplier.name} · ${invoice.currency} ${invoice.total.toString()} · stock receiving remains separate.`,
      href: "/accounting/invoices"
    })),
    ...openAutomationFindings.map((finding) => ({
      kind: "Automation finding",
      label: finding.title,
      reason: `${finding.severity} · ${finding.message}`,
      href: "/automation"
    })),
    ...failedAutomationRuns.map((run) => ({
      kind: "Automation failure",
      label: `${run.kind} failed`,
      reason: run.errorMessage ?? "Automation run failed without a detailed error.",
      href: "/automation"
    }))
  ].slice(0, 12);

  return {
    stockItems: stock,
    totalOnHand: stock.reduce((total, item) => total + item.onHand, 0),
    componentsOnHand,
    buildCapacity,
    assembledPackages,
    totalAvailable: stock.reduce((total, item) => total + item.available, 0),
    lowStockItems,
    shortages,
    inventoryValuation,
    recommendations,
    incomingOrders,
    humanReviewActions,
    openAutomationFindings,
    failedAutomationRuns
  };
}

type DashboardStockEntry = {
  itemId: string;
  available: number;
};

type ActiveFinishedBom = {
  version: string;
  parentItem: { sku: string; description: string };
  lines: Array<{
    componentItemId: string;
    quantity: number;
    componentItem: { sku: string; description: string };
  }>;
};

function summarizeBuildCapacity(activeFinishedBoms: ActiveFinishedBom[], stockByItemId: Map<string, DashboardStockEntry>) {
  const candidates = activeFinishedBoms.map((bom) => {
    const componentCapacities = bom.lines.map((line) => {
      const available = stockByItemId.get(line.componentItemId)?.available ?? 0;
      return {
        sku: line.componentItem.sku,
        description: line.componentItem.description,
        requiredPerBuild: line.quantity,
        available,
        capacity: Math.floor(available / line.quantity)
      };
    });
    const bottleneck = componentCapacities.reduce<typeof componentCapacities[number] | undefined>((lowest, current) => {
      if (!lowest || current.capacity < lowest.capacity) return current;
      return lowest;
    }, undefined);

    return {
      finishedSku: bom.parentItem.sku,
      finishedDescription: bom.parentItem.description,
      bomVersion: bom.version,
      componentsRequiredPerBuild: bom.lines.length,
      finishedBuildCapacity: bottleneck?.capacity ?? 0,
      bottleneckSku: bottleneck?.sku ?? "",
      componentCapacities
    };
  });

  return candidates.reduce((best, current) => {
    if (!best || current.finishedBuildCapacity > best.finishedBuildCapacity) return current;
    return best;
  }, {
    finishedSku: "",
    finishedDescription: "",
    bomVersion: "",
    componentsRequiredPerBuild: 0,
    finishedBuildCapacity: 0,
    bottleneckSku: "",
    componentCapacities: [] as Array<{ sku: string; description: string; requiredPerBuild: number; available: number; capacity: number }>
  });
}

