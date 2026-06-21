import { getStockSummaries } from "@/modules/inventory/service";
import { sortItemsByUseGroup } from "@/modules/inventory/item-option-groups";
import { calculatePricedItemValuations, type PricedItemValuationRow } from "@/modules/inventory/valuation";
import { getActivePricedItemValuationInputs } from "@/modules/inventory/pricing";
import { getIncomingOrders, getPurchaseRecommendations } from "@/modules/purchasing/service";
import { getLeadTimeLog, type LeadTimeLog } from "@/modules/tracking/service";
import { prisma } from "@/lib/prisma";
import type { ShortageSummary } from "@/types/inventory";
import type { Prisma } from "@prisma/client";

const LAMBENTI_ASSEMBLED_PACKAGE_SKU = "LAMBENTI_PACKAGE";
const LAMBENTI_ASSEMBLED_PACKAGE_DESCRIPTION_PATTERNS = [/lambenti\s+assembled\s+package/i, /complete\s+package\s+assembly/i];

export async function getDashboardSummary() {
  const stock = await getStockSummaries();
  const stockItems = sortItemsByUseGroup(stock);
  const lowStockItems = sortItemsByUseGroup(stock.filter((item) => item.available < item.reorderPoint));
  const [activeItems, activeFinishedBoms, reservations] = await Promise.all([
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      select: { id: true, sku: true, description: true, category: true, useGroupOverride: true }
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
        description: reservation.item.description,
        category: reservation.item.category,
        useGroupOverride: reservation.item.useGroupOverride,
        demand: reservation.quantity,
        available,
        shortage: Math.max(reservation.quantity - available, 0)
      };
    })
    .filter((item) => item.shortage > 0);
  const upcomingShortages = sortItemsByUseGroup(shortages);

  const itemCategoryById = new Map(activeItems.map((item) => [item.id, item.category]));
  const stockByItemId = new Map(stock.map((item) => [item.itemId, item]));
  const componentsOnHand = stock
    .filter((item) => itemCategoryById.get(item.itemId) !== "FINISHED_GOOD")
    .reduce((total, item) => total + item.onHand, 0);
  const assembledPackageItem = findLambentiAssembledPackageItem(activeItems);
  const assembledPackages = assembledPackageItem ? stockByItemId.get(assembledPackageItem.id)?.onHand ?? 0 : 0;
  const packageBoms = assembledPackageItem
    ? activeFinishedBoms.filter((bom) => bom.parentItem.id === assembledPackageItem.id)
    : activeFinishedBoms.filter((bom) => isLambentiAssembledPackageItem(bom.parentItem));
  const buildCapacity = summarizeBuildCapacity(packageBoms, stockByItemId);

  const pricedItemInputs = await getActivePricedItemValuationInputs();
  const itemValuations = calculatePricedItemValuations(pricedItemInputs);
  const inventoryValuation = itemValuations.totalValue;
  const inventoryValueByCategory = summarizeInventoryValueByCategory(
    itemValuations.rows,
    itemCategoryById
  );

  const [recommendations, incomingOrders, leadTimeLog] = await Promise.all([
    getPurchaseRecommendations(),
    getIncomingOrders(),
    getLeadTimeLog()
  ]);
  const [pendingPurchaseRequests, invoicesNeedingAction, openAutomationFindings, failedAutomationRuns] = await Promise.all([
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
    ...recommendations.slice(0, 5).map((item) => ({
      kind: "Suggested PO",
      label: `Draft/order ${item.recommendedOrderQuantity} × ${item.sku}`,
      reason: `${item.priority} priority · ${item.leadTimeDays}d lead time · covered supply ${item.coveredAvailable}; reorder gap ${item.supplyGapToReorder}; target ${item.targetStock}.`,
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

  const launchReadiness = summarizeLaunchReadiness({
    assembledPackages,
    buildCapacityNow: buildCapacity.finishedBuildCapacity,
    bottleneckSku: buildCapacity.bottleneckSku,
    recommendationCount: recommendations.length,
    recommendedUnits: recommendations.reduce((total, item) => total + item.recommendedOrderQuantity, 0),
    incomingOrderCount: incomingOrders.length,
    reviewActionCount: humanReviewActions.length
  });

  const dashboardGraphs = summarizeDashboardGraphs({
    launchReadiness,
    buildCapacity,
    lowStockItems,
    leadTimeLog,
    inventoryValueByCategory,
    operations: {
      recommendationRows: recommendations.length,
      incomingOrders: incomingOrders.length,
      reviewActions: humanReviewActions.length,
      automationWork: openAutomationFindings.length + failedAutomationRuns.length,
      recommendationSummaries: recommendations.slice(0, 4).map((item) => `${item.priority}: ${item.sku} · ${item.leadTimeDays}d lead · gap ${item.supplyGapToReorder}`),
      incomingSummaries: incomingOrders.slice(0, 4).map((order) => `${order.supplier.name} · ${order.lines.map((line) => `${line.quantity - line.receivedQuantity}×${line.item.sku}`).join(", ") || "no open lines"}`),
      reviewActionSummaries: humanReviewActions.slice(0, 4).map((action) => `${action.kind}: ${action.label}`),
      automationSummaries: [...openAutomationFindings.map((finding) => `${finding.severity}: ${finding.title}`), ...failedAutomationRuns.map((run) => `${run.kind}: ${run.errorMessage ?? "failed"}`)].slice(0, 4)
    }
  });

  return {
    stockItems,
    totalOnHand: stock.reduce((total, item) => total + item.onHand, 0),
    componentsOnHand,
    buildCapacity,
    assembledPackages,
    launchReadiness,
    dashboardGraphs,
    totalAvailable: stock.reduce((total, item) => total + item.available, 0),
    lowStockItems,
    shortages: upcomingShortages,
    inventoryValuation,
    recommendations,
    incomingOrders,
    humanReviewActions,
    openAutomationFindings,
    failedAutomationRuns
  };
}

export type LaunchReadinessStatus = "BLOCKED" | "IN_PROGRESS" | "COVERED";

type LaunchReadinessInput = {
  assembledPackages: number;
  buildCapacityNow: number;
  bottleneckSku: string;
  recommendationCount: number;
  recommendedUnits: number;
  incomingOrderCount: number;
  reviewActionCount: number;
};

type LaunchReadinessAction = {
  label: string;
  reason: string;
  href: string;
  mutationBoundary: string;
};

const PHASE_ONE_TARGET_UNITS = 25;
const READ_ONLY_LAUNCH_BOUNDARY = "Requires explicit human action; no stock, purchasing, or accounting mutation is performed here.";

export function summarizeLaunchReadiness(input: LaunchReadinessInput) {
  const readyNow = input.assembledPackages + input.buildCapacityNow;
  const remainingToTarget = Math.max(PHASE_ONE_TARGET_UNITS - readyNow, 0);
  const status: LaunchReadinessStatus = remainingToTarget === 0
    ? "COVERED"
    : input.buildCapacityNow <= 0
      ? "BLOCKED"
      : "IN_PROGRESS";
  const nextActions: LaunchReadinessAction[] = [];

  if (status === "COVERED") {
    nextActions.push({
      label: "Prepare Phase I build/ship routine",
      reason: `${readyNow} unit(s) are assembled or buildable against the 25-unit Phase I target. Prepare QA, packaging, and shipping workflow before committing stock.`,
      href: "/inventory/movements",
      mutationBoundary: READ_ONLY_LAUNCH_BOUNDARY
    });
  } else {
    if (input.buildCapacityNow > 0) {
      nextActions.push({
        label: "Plan the next package build batch",
        reason: `${input.buildCapacityNow} unit(s) are buildable now; ${remainingToTarget} still needed for the 25-unit Phase I target.`,
        href: "/inventory/movements",
        mutationBoundary: READ_ONLY_LAUNCH_BOUNDARY
      });
    }

    if (input.recommendationCount > 0) {
      nextActions.push({
        label: "Draft component purchase requests",
        reason: `${input.recommendationCount} low-stock recommendation row(s) cover ${input.recommendedUnits} recommended unit(s).`,
        href: "/purchasing/recommendations",
        mutationBoundary: READ_ONLY_LAUNCH_BOUNDARY
      });
    }

    if (input.incomingOrderCount > 0) {
      nextActions.push({
        label: "Receive incoming POs after count",
        reason: `${input.incomingOrderCount} open incoming order(s) can improve readiness only after physical count in Receiving.`,
        href: "/incoming",
        mutationBoundary: READ_ONLY_LAUNCH_BOUNDARY
      });
    }

    if (input.reviewActionCount > 0) {
      nextActions.push({
        label: "Clear review queue",
        reason: `${input.reviewActionCount} human review action(s) remain across purchasing, invoices, or automation.`,
        href: "/#human-approval-queue",
        mutationBoundary: READ_ONLY_LAUNCH_BOUNDARY
      });
    }
  }

  return {
    targetPackages: PHASE_ONE_TARGET_UNITS,
    assembledPackages: input.assembledPackages,
    buildCapacityNow: input.buildCapacityNow,
    readyNow,
    remainingToTarget,
    bottleneckSku: input.bottleneckSku,
    status,
    nextActions
  };
}

export type DashboardGraphInput = {
  launchReadiness: ReturnType<typeof summarizeLaunchReadiness>;
  buildCapacity: {
    bottleneckSku: string;
    componentCapacities: Array<{
      sku: string;
      description: string;
      requiredPerBuild: number;
      available: number;
      capacity: number;
    }>;
  };
  lowStockItems: Array<{
    sku: string;
    description: string;
    available: number;
    reorderPoint: number;
    targetStock: number;
  }>;
  leadTimeLog: LeadTimeLog;
  inventoryValueByCategory: Array<{
    category: string;
    label: string;
    value: number;
  }>;
  operations: {
    recommendationRows: number;
    incomingOrders: number;
    reviewActions: number;
    automationWork: number;
    recommendationSummaries?: string[];
    incomingSummaries?: string[];
    reviewActionSummaries?: string[];
    automationSummaries?: string[];
  };
};

export function summarizeDashboardGraphs(input: DashboardGraphInput) {
  const launchProgress = {
    readyPercent: boundedPercent(input.launchReadiness.readyNow, input.launchReadiness.targetPackages),
    gapPercent: boundedPercent(input.launchReadiness.remainingToTarget, input.launchReadiness.targetPackages)
  };
  const launchCoverageSegments = summarizeLaunchCoverageSegments(input.launchReadiness);

  const componentCapacityMax = Math.max(0, ...input.buildCapacity.componentCapacities.map((component) => component.capacity));
  const componentCapacityBars = [...input.buildCapacity.componentCapacities]
    .sort((left, right) => left.capacity - right.capacity || left.sku.localeCompare(right.sku))
    .slice(0, 8)
    .map((component) => ({
      ...component,
      percentOfMax: boundedPercent(component.capacity, componentCapacityMax),
      isBottleneck: component.sku === input.buildCapacity.bottleneckSku || component.capacity === 0
    }));

  const stockPressureBars = input.lowStockItems
    .map((item) => {
      const coveragePercent = item.reorderPoint > 0 ? boundedPercent(item.available, item.reorderPoint) : 100;
      return {
        sku: item.sku,
        description: item.description,
        available: item.available,
        reorderPoint: item.reorderPoint,
        targetStock: item.targetStock,
        shortageToReorder: Math.max(item.reorderPoint - item.available, 0),
        coveragePercent,
        severity: coveragePercent === 0 ? "blocked" : coveragePercent < 50 ? "critical" : "watch"
      };
    })
    .sort((left, right) => left.coveragePercent - right.coveragePercent || right.shortageToReorder - left.shortageToReorder || left.sku.localeCompare(right.sku))
    .slice(0, 8);

  const leadTimeRows = input.leadTimeLog.items
    .map((item) => ({
      sku: item.itemSku,
      description: item.itemDescription,
      days: item.currentLeadTimeDays,
      source: item.leadTimeSource,
      sampleCount: item.sampleCount,
      label: item.leadTimeLabel
    }))
    .sort((left, right) => right.days - left.days || left.sku.localeCompare(right.sku));
  const leadTimeMaxDays = Math.max(1, ...leadTimeRows.map((item) => item.days));
  const leadTimeBars = leadTimeRows.slice(0, 10).map((item) => ({
    ...item,
    percentOfMax: boundedPercent(item.days, leadTimeMaxDays)
  }));

  const operationQueue = [
    { label: "Recommendations", count: input.operations.recommendationRows, href: "/purchasing/recommendations", summaries: input.operations.recommendationSummaries ?? [] },
    { label: "Incoming Orders", count: input.operations.incomingOrders, href: "/incoming", summaries: input.operations.incomingSummaries ?? [] },
    { label: "Review Actions", count: input.operations.reviewActions, href: "/#human-approval-queue", summaries: input.operations.reviewActionSummaries ?? [] },
    { label: "Automation", count: input.operations.automationWork, href: "/automation", summaries: input.operations.automationSummaries ?? [] }
  ];
  const operationMax = Math.max(1, ...operationQueue.map((item) => item.count));
  const operationsFlow = operationQueue.map((item) => ({
    ...item,
    percentOfMax: boundedPercent(item.count, operationMax)
  }));

  const valuationTotal = input.inventoryValueByCategory.reduce((total, item) => total + item.value, 0);
  const valuationMix = input.inventoryValueByCategory
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .map((item) => ({
      ...item,
      sharePercent: boundedPercent(item.value, valuationTotal)
    }));

  return {
    launchProgress,
    launchCoverageSegments,
    componentCapacityBars,
    stockPressureBars,
    leadTimeBars,
    operationsFlow,
    valuationMix
  };
}

function summarizeLaunchCoverageSegments(readiness: ReturnType<typeof summarizeLaunchReadiness>) {
  const target = Math.max(0, readiness.targetPackages);
  const assembledUnits = Math.min(readiness.assembledPackages, target);
  const buildableUnits = Math.min(readiness.buildCapacityNow, Math.max(target - assembledUnits, 0));
  const gapUnits = Math.max(target - assembledUnits - buildableUnits, 0);
  return [
    { label: "Assembled", units: assembledUnits + buildableUnits, percent: boundedPercent(assembledUnits + buildableUnits, target), tone: "emerald" },
    { label: "Remaining gap", units: gapUnits, percent: boundedPercent(gapUnits, target), tone: "slate" }
  ];
}

function summarizeInventoryValueByCategory(rows: PricedItemValuationRow[], categoryByItemId: Map<string, string>) {
  const valueByCategory = new Map<string, number>();
  for (const row of rows) {
    const category = categoryByItemId.get(row.itemId) ?? "UNKNOWN";
    valueByCategory.set(category, (valueByCategory.get(category) ?? 0) + row.value);
  }

  return [...valueByCategory.entries()]
    .map(([category, value]) => ({ category, label: formatCategoryLabel(category), value: roundCurrency(value) }))
    .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
}

function formatCategoryLabel(category: string) {
  return category
    .toLowerCase()
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function boundedPercent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type DashboardStockEntry = {
  itemId: string;
  onHand: number;
  available: number;
};

type DashboardItemOption = {
  id: string;
  sku: string;
  description: string;
  category: string;
  useGroupOverride?: string | null;
};

type ActiveFinishedBom = {
  version: string;
  parentItem: DashboardItemOption;
  lines: Array<{
    componentItemId: string;
    quantity: Prisma.Decimal | number;
    componentItem: { sku: string; description: string };
  }>;
};

function findLambentiAssembledPackageItem(items: DashboardItemOption[]) {
  return items.find((item) => item.sku === LAMBENTI_ASSEMBLED_PACKAGE_SKU)
    ?? items.find(isLambentiAssembledPackageItem);
}

function isLambentiAssembledPackageItem(item: Pick<DashboardItemOption, "sku" | "description" | "category">) {
  return item.category === "FINISHED_GOOD"
    && (item.sku === LAMBENTI_ASSEMBLED_PACKAGE_SKU
      || LAMBENTI_ASSEMBLED_PACKAGE_DESCRIPTION_PATTERNS.some((pattern) => pattern.test(item.description)));
}

function summarizeBuildCapacity(activeFinishedBoms: ActiveFinishedBom[], stockByItemId: Map<string, DashboardStockEntry>) {
  const candidates = activeFinishedBoms.map((bom) => {
    const componentCapacities = bom.lines.map((line) => {
      const available = stockByItemId.get(line.componentItemId)?.available ?? 0;
      const requiredPerBuild = Number(line.quantity);
      return {
        sku: line.componentItem.sku,
        description: line.componentItem.description,
        requiredPerBuild,
        available,
        capacity: requiredPerBuild > 0 ? Math.floor(available / requiredPerBuild) : 0
      };
    });
    const bottleneck = componentCapacities.reduce<typeof componentCapacities[number] | undefined>((lowest, current) => {
      if (!lowest || current.capacity < lowest.capacity) return current;
      return lowest;
    }, undefined);
    const componentsRequiredPerBuild = componentCapacities.reduce((total, component) => total + component.requiredPerBuild, 0);

    return {
      finishedSku: bom.parentItem.sku,
      finishedDescription: bom.parentItem.description,
      bomVersion: bom.version,
      componentsRequiredPerBuild,
      finishedBuildCapacity: bottleneck?.capacity ?? 0,
      bottleneckSku: bottleneck?.sku ?? "",
      componentCapacities
    };
  });

  return candidates.reduce((best, current) => {
    if (!best.finishedSku || current.finishedBuildCapacity > best.finishedBuildCapacity) return current;
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

