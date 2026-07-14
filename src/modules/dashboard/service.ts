import { getStockSummaries } from "@/modules/inventory/service";
import { sortItemsByUseGroup } from "@/modules/inventory/item-option-groups";
import { calculatePricedItemValuations, type PricedItemValuationRow } from "@/modules/inventory/valuation";
import { getActivePricedItemValuationInputs } from "@/modules/inventory/pricing";
import { roundDisplayQuantity } from "@/modules/inventory/quantity-format";
import { getIncomingOrders, getPurchaseRecommendations } from "@/modules/purchasing/service";
import { getLeadTimeLog, type LeadTimeLog } from "@/modules/tracking/service";
import { prisma } from "@/lib/prisma";
import type { ShortageSummary, StockSummary } from "@/types/inventory";
import type { Prisma } from "@prisma/client";

const PHASE_ONE_LAUNCH_PACKAGE_SKU = "LAMBENTI_PACKAGE";
const PHASE_ONE_LAUNCH_PACKAGE_DESCRIPTION = "Complete Package Assembly";
const PHASE_ONE_LAUNCH_PACKAGE_DISPLAY_NAME = `${PHASE_ONE_LAUNCH_PACKAGE_SKU} — ${PHASE_ONE_LAUNCH_PACKAGE_DESCRIPTION}`;

export async function getDashboardSummary() {
  const stock = await getStockSummaries();
  const stockItems = sortItemsByUseGroup(stock);
  const lowStockCandidates = stock.filter((item) => item.available < item.reorderPoint);
  const [activeItems, activeFinishedBoms, reservations] = await Promise.all([
    prisma.item.findMany({
      where: { lifecycleStatus: { not: "OBSOLETE" } },
      select: { id: true, sku: true, description: true, category: true, useGroupOverride: true, reorderPoint: true }
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
  const lowStockPartition = partitionLowStockByFinishedGoodNeed(lowStockCandidates, activeFinishedBoms, stockByItemId);
  const lowStockItems = sortItemsByUseGroup(lowStockPartition.currentlyNeeded);
  const lowStockNotCurrentlyNeededItems = sortItemsByUseGroup(lowStockPartition.notCurrentlyNeeded);
  const componentsOnHand = stock
    .filter((item) => itemCategoryById.get(item.itemId) !== "FINISHED_GOOD")
    .reduce((total, item) => total + item.onHand, 0);
  const assembledPackageItem = findPhaseOneLaunchPackageItem(activeItems);
  const assembledPackages = assembledPackageItem ? stockByItemId.get(assembledPackageItem.id)?.onHand ?? 0 : 0;
  const packageBoms = assembledPackageItem
    ? activeFinishedBoms.filter((bom) => bom.parentItem.id === assembledPackageItem.id)
    : activeFinishedBoms.filter((bom) => isPhaseOneLaunchPackageItem(bom.parentItem));
  const buildCapacity = summarizeBuildCapacity(packageBoms, stockByItemId, activeFinishedBoms);

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
    totalOnHand: roundDisplayQuantity(stock.reduce((total, item) => total + item.onHand, 0)),
    componentsOnHand: roundDisplayQuantity(componentsOnHand),
    buildCapacity,
    assembledPackages,
    launchReadiness,
    dashboardGraphs,
    totalAvailable: roundDisplayQuantity(stock.reduce((total, item) => total + item.available, 0)),
    lowStockItems,
    lowStockNotCurrentlyNeededItems,
    shortages: upcomingShortages,
    inventoryValuation,
    recommendations,
    incomingOrders,
    humanReviewActions,
    openAutomationFindings,
    failedAutomationRuns
  };
}

export type LaunchReadinessStatus = "BLOCKED" | "IN_PROGRESS" | "BUILD_READY" | "COVERED";

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
  const readyNow = input.assembledPackages;
  const remainingBuildGap = Math.max(PHASE_ONE_TARGET_UNITS - readyNow, 0);
  const buildableTowardTarget = Math.min(input.buildCapacityNow, remainingBuildGap);
  const materialCoverageNow = readyNow + input.buildCapacityNow;
  const materialCoveredTowardTarget = Math.min(PHASE_ONE_TARGET_UNITS, readyNow + buildableTowardTarget);
  const remainingMaterialGap = Math.max(PHASE_ONE_TARGET_UNITS - materialCoverageNow, 0);
  const status: LaunchReadinessStatus = remainingBuildGap === 0
    ? "COVERED"
    : remainingMaterialGap === 0
      ? "BUILD_READY"
      : input.buildCapacityNow <= 0
        ? "BLOCKED"
        : "IN_PROGRESS";
  const nextActions: LaunchReadinessAction[] = [];

  if (status === "COVERED") {
    nextActions.push({
      label: "Prepare Phase I QA/ship routine",
      reason: `${readyNow} assembled package unit(s) are ledger-built against the 25-unit Phase I target. Prepare QA, packaging, and shipping workflow before committing stock.`,
      href: "/inventory/movements",
      mutationBoundary: READ_ONLY_LAUNCH_BOUNDARY
    });
  } else {
    if (input.buildCapacityNow > 0) {
      nextActions.push({
        label: "Plan the next package build batch",
        reason: `${input.buildCapacityNow} package unit(s) are buildable now; ${remainingBuildGap} still need explicit BUILD movements before Phase I is ready.`,
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
    packageSku: PHASE_ONE_LAUNCH_PACKAGE_SKU,
    packageDescription: PHASE_ONE_LAUNCH_PACKAGE_DESCRIPTION,
    packageDisplayName: PHASE_ONE_LAUNCH_PACKAGE_DISPLAY_NAME,
    targetPackages: PHASE_ONE_TARGET_UNITS,
    assembledPackages: input.assembledPackages,
    buildCapacityNow: input.buildCapacityNow,
    buildableTowardTarget,
    materialCoverageNow,
    materialCoveredTowardTarget,
    readyNow,
    remainingToTarget: remainingMaterialGap,
    remainingBuildGap,
    remainingMaterialGap,
    bottleneckSku: input.bottleneckSku,
    status,
    nextActions
  };
}

export type DashboardGraphInput = {
  launchReadiness: ReturnType<typeof summarizeLaunchReadiness>;
  buildCapacity: {
    bottleneckSku: string;
    buildRows?: Array<{
      sku: string;
      description: string;
      buildableUnits: number;
      availableBuiltUnits: number;
      isPackageTarget?: boolean;
      isBottleneck?: boolean;
    }>;
    componentCapacities: Array<{
      sku: string;
      description: string;
      requiredPerBuild: number;
      available: number;
      buildableSubassemblyCapacity?: number;
      effectiveAvailable?: number;
      isLeafConstraint?: boolean;
      capacity: number;
    }>;
    materialComponentsRequired?: number;
    materialComponentsInStock?: number;
    materialComponentsMissing?: number;
    materialCoveragePercent?: number;
    missingMaterialSkus?: string[];
  };
  lowStockItems: Array<{
    sku: string;
    description: string;
    category?: string | null;
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
    materialPercent: input.buildCapacity.materialCoveragePercent ?? boundedPercent(input.launchReadiness.materialCoveredTowardTarget, input.launchReadiness.targetPackages),
    materialComponentsInStock: input.buildCapacity.materialComponentsInStock ?? 0,
    materialComponentsRequired: input.buildCapacity.materialComponentsRequired ?? 0,
    materialComponentsMissing: input.buildCapacity.materialComponentsMissing ?? 0,
    gapPercent: boundedPercent(input.launchReadiness.remainingMaterialGap, input.launchReadiness.targetPackages)
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

  const buildCapacityMax = Math.max(0, ...(input.buildCapacity.buildRows ?? []).map((build) => build.buildableUnits));
  const buildCapacityBars = [...(input.buildCapacity.buildRows ?? [])]
    .sort((left, right) => Number(Boolean(right.isPackageTarget)) - Number(Boolean(left.isPackageTarget)) || Number(Boolean(right.isBottleneck)) - Number(Boolean(left.isBottleneck)) || left.buildableUnits - right.buildableUnits || left.sku.localeCompare(right.sku))
    .slice(0, 8)
    .map((build) => ({
      ...build,
      percentOfMax: boundedPercent(build.buildableUnits, buildCapacityMax),
      isBottleneck: Boolean(build.isBottleneck)
    }));

  const stockPressureBars = input.lowStockItems
    .filter((item) => item.category !== "FINISHED_GOOD")
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
  const leadTimeBars = leadTimeRows.slice(0, 16).map((item) => ({
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
    buildCapacityBars,
    stockPressureBars,
    leadTimeBars,
    operationsFlow,
    valuationMix
  };
}

function summarizeLaunchCoverageSegments(readiness: ReturnType<typeof summarizeLaunchReadiness>) {
  const target = Math.max(0, readiness.targetPackages);
  const assembledUnits = Math.min(readiness.assembledPackages, target);
  const buildableUnits = readiness.buildableTowardTarget;
  const bufferUnits = Math.max(readiness.materialCoverageNow - target, 0);
  const gapUnits = readiness.remainingMaterialGap;
  return [
    { label: "Built", units: assembledUnits, percent: boundedPercent(assembledUnits, target), tone: "emerald" },
    { label: "Buildable", units: buildableUnits, percent: boundedPercent(buildableUnits, target), tone: "cyan" },
    { label: "Buffer beyond target", units: bufferUnits, percent: 0, tone: "sky" },
    { label: "Material gap", units: gapUnits, percent: boundedPercent(gapUnits, target), tone: "slate" }
  ].filter((segment) => segment.units > 0 || segment.label !== "Buffer beyond target");
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
  reorderPoint: number;
  useGroupOverride?: string | null;
};

type NotCurrentlyNeededLowStockItem = StockSummary & {
  notCurrentlyNeededReason: string;
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

type BuildCapacityComponent = {
  itemId: string;
  sku: string;
  description: string;
  requiredPerBuild: number;
  available: number;
  buildableSubassemblyCapacity: number;
  effectiveAvailable: number;
  isLeafConstraint?: boolean;
  capacity: number;
};

type BuildCapacityBuild = {
  sku: string;
  description: string;
  buildableUnits: number;
  availableBuiltUnits: number;
  isPackageTarget: boolean;
  isBottleneck: boolean;
};

type BuildCapacitySummary = {
  finishedSku: string;
  finishedDescription: string;
  bomVersion: string;
  componentsRequiredPerBuild: number;
  finishedBuildCapacity: number;
  bottleneckSku: string;
  componentCapacities: BuildCapacityComponent[];
  buildRows: BuildCapacityBuild[];
  materialComponentsRequired: number;
  materialComponentsInStock: number;
  materialComponentsMissing: number;
  materialCoveragePercent: number;
  missingMaterialSkus: string[];
};

function findPhaseOneLaunchPackageItem(items: DashboardItemOption[]) {
  return items.find(isPhaseOneLaunchPackageItem);
}

function isPhaseOneLaunchPackageItem(item: Pick<DashboardItemOption, "sku" | "category">) {
  return item.category === "FINISHED_GOOD" && item.sku === PHASE_ONE_LAUNCH_PACKAGE_SKU;
}

function partitionLowStockByFinishedGoodNeed(
  lowStockItems: StockSummary[],
  activeFinishedBoms: ActiveFinishedBom[],
  stockByItemId: Map<string, DashboardStockEntry>
) {
  const finishedGoodsByComponent = new Map<string, Array<{ sku: string; available: number; reorderPoint: number; sufficient: boolean }>>();

  for (const bom of activeFinishedBoms) {
    const parentAvailable = stockByItemId.get(bom.parentItem.id)?.available ?? 0;
    const sufficient = bom.parentItem.reorderPoint > 0
      ? parentAvailable >= bom.parentItem.reorderPoint
      : parentAvailable > 0;

    for (const line of bom.lines) {
      const parents = finishedGoodsByComponent.get(line.componentItemId) ?? [];
      parents.push({
        sku: bom.parentItem.sku,
        available: parentAvailable,
        reorderPoint: bom.parentItem.reorderPoint,
        sufficient
      });
      finishedGoodsByComponent.set(line.componentItemId, parents);
    }
  }

  const currentlyNeeded: StockSummary[] = [];
  const notCurrentlyNeeded: NotCurrentlyNeededLowStockItem[] = [];

  for (const item of lowStockItems) {
    const finishedGoodParents = finishedGoodsByComponent.get(item.itemId) ?? [];
    if (finishedGoodParents.length === 0 || finishedGoodParents.some((parent) => !parent.sufficient)) {
      currentlyNeeded.push(item);
      continue;
    }

    const parentSummary = finishedGoodParents
      .map((parent) => `${parent.sku} ${parent.available}/${parent.reorderPoint}`)
      .join(", ");
    notCurrentlyNeeded.push({
      ...item,
      notCurrentlyNeededReason: `Finished build coverage is sufficient: ${parentSummary}`
    });
  }

  return { currentlyNeeded, notCurrentlyNeeded };
}

export function summarizeBuildCapacity(
  activeFinishedBoms: ActiveFinishedBom[],
  stockByItemId: Map<string, DashboardStockEntry>,
  allActiveFinishedBoms: ActiveFinishedBom[] = activeFinishedBoms
) {
  const bomsByParentItemId = new Map<string, ActiveFinishedBom[]>();
  const itemDetailsById = new Map<string, { sku: string; description: string }>();
  for (const bom of allActiveFinishedBoms) {
    const boms = bomsByParentItemId.get(bom.parentItem.id) ?? [];
    boms.push(bom);
    bomsByParentItemId.set(bom.parentItem.id, boms);
    itemDetailsById.set(bom.parentItem.id, { sku: bom.parentItem.sku, description: bom.parentItem.description });
    for (const line of bom.lines) {
      itemDetailsById.set(line.componentItemId, { sku: line.componentItem.sku, description: line.componentItem.description });
    }
  }

  const emptySummary: BuildCapacitySummary = {
    finishedSku: "",
    finishedDescription: "",
    bomVersion: "",
    componentsRequiredPerBuild: 0,
    finishedBuildCapacity: 0,
    bottleneckSku: "",
    componentCapacities: [],
    buildRows: [],
    materialComponentsRequired: 0,
    materialComponentsInStock: 0,
    materialComponentsMissing: 0,
    materialCoveragePercent: 0,
    missingMaterialSkus: []
  };

  function summarizeBom(bom: ActiveFinishedBom, visitedParentIds: Set<string>): BuildCapacitySummary {
    const componentRequirements = new Map<string, BuildCapacityComponent>();

    for (const line of bom.lines) {
      const requiredPerBuild = Number(line.quantity);
      const existing = componentRequirements.get(line.componentItemId);
      if (existing) {
        existing.requiredPerBuild += requiredPerBuild;
        continue;
      }

      const available = stockByItemId.get(line.componentItemId)?.available ?? 0;
      const buildableSubassemblyCapacity = summarizeNestedBuildCapacity(line.componentItemId, visitedParentIds);
      const effectiveAvailable = available + buildableSubassemblyCapacity;
      componentRequirements.set(line.componentItemId, {
        itemId: line.componentItemId,
        sku: line.componentItem.sku,
        description: line.componentItem.description,
        requiredPerBuild,
        available,
        buildableSubassemblyCapacity,
        effectiveAvailable,
        capacity: 0
      });
    }

    const componentCapacities = [...componentRequirements.values()].map((component) => ({
      ...component,
      capacity: component.requiredPerBuild > 0 ? Math.floor(component.available / component.requiredPerBuild) : 0
    }));
    const finishedBuildCapacity = calculateBuildableUnitsForBom(bom);
    const failedBottleneckId = findFirstFailedRequirement(bom, finishedBuildCapacity + 1);
    const directBottleneck = componentCapacities.reduce<typeof componentCapacities[number] | undefined>((lowest, current) => {
      if (!lowest || current.capacity < lowest.capacity) return current;
      return lowest;
    }, undefined);
    const failedBottleneckDetails = failedBottleneckId ? itemDetailsById.get(failedBottleneckId) : undefined;
    const bottleneckSku = failedBottleneckDetails?.sku ?? directBottleneck?.sku ?? "";
    const componentsRequiredPerBuild = componentCapacities.reduce((total, component) => total + component.requiredPerBuild, 0);
    const materialCoverage = summarizeMaterialComponentCoverage(bom);

    return {
      finishedSku: bom.parentItem.sku,
      finishedDescription: bom.parentItem.description,
      bomVersion: bom.version,
      componentsRequiredPerBuild,
      finishedBuildCapacity,
      bottleneckSku,
      componentCapacities,
      buildRows: [],
      ...materialCoverage
    };
  }

  function summarizeMaterialComponentCoverage(bom: ActiveFinishedBom) {
    const requirements = new Map<string, { itemId: string; sku: string; requiredQuantity: number; available: number }>();
    for (const line of bom.lines) {
      collectLeafMaterialRequirement(
        line.componentItemId,
        Number(line.quantity),
        requirements,
        new Set([bom.parentItem.id])
      );
    }

    const componentRequirements = [...requirements.values()].filter((requirement) => requirement.requiredQuantity > 0);
    const stockedComponents = componentRequirements.filter((requirement) => requirement.available >= requirement.requiredQuantity);
    const missingMaterialSkus = componentRequirements
      .filter((requirement) => requirement.available < requirement.requiredQuantity)
      .map((requirement) => requirement.sku)
      .sort((left, right) => left.localeCompare(right));

    return {
      materialComponentsRequired: componentRequirements.length,
      materialComponentsInStock: stockedComponents.length,
      materialComponentsMissing: missingMaterialSkus.length,
      materialCoveragePercent: boundedPercent(stockedComponents.length, componentRequirements.length),
      missingMaterialSkus
    };
  }

  function collectLeafMaterialRequirement(
    itemId: string,
    requiredQuantity: number,
    requirements: Map<string, { itemId: string; sku: string; requiredQuantity: number; available: number }>,
    visitedParentIds: Set<string>
  ) {
    const nestedBom = (bomsByParentItemId.get(itemId) ?? [])[0];
    if (nestedBom && !visitedParentIds.has(itemId)) {
      const nextVisited = new Set(visitedParentIds);
      nextVisited.add(itemId);
      for (const line of nestedBom.lines) {
        collectLeafMaterialRequirement(
          line.componentItemId,
          requiredQuantity * Number(line.quantity),
          requirements,
          nextVisited
        );
      }
      return;
    }

    const itemDetails = itemDetailsById.get(itemId);
    const existing = requirements.get(itemId);
    const available = stockByItemId.get(itemId)?.available ?? 0;
    requirements.set(itemId, {
      itemId,
      sku: itemDetails?.sku ?? itemId,
      requiredQuantity: roundQuantity((existing?.requiredQuantity ?? 0) + requiredQuantity),
      available
    });
  }

  function summarizeNestedBuildCapacity(itemId: string, visitedParentIds: Set<string>) {
    if (visitedParentIds.has(itemId)) return 0;
    const nestedBoms = bomsByParentItemId.get(itemId) ?? [];
    if (nestedBoms.length === 0) return 0;

    const nextVisited = new Set(visitedParentIds);
    nextVisited.add(itemId);
    return Math.max(0, ...nestedBoms.map((bom) => summarizeBom(bom, nextVisited).finishedBuildCapacity));
  }

  function calculateBuildableUnitsForBom(bom: ActiveFinishedBom) {
    const simpleUpperBound = Math.max(
      0,
      ...bom.lines.map((line) => {
        const requiredPerBuild = Number(line.quantity);
        if (requiredPerBuild <= 0) return 0;
        const available = stockByItemId.get(line.componentItemId)?.available ?? 0;
        return Math.floor(available / requiredPerBuild);
      })
    );
    let low = 0;
    let high = Math.max(simpleUpperBound, 0);
    while (low < high) {
      const midpoint = Math.ceil((low + high + 1) / 2);
      if (canBuildBomUnits(bom, midpoint)) {
        low = midpoint;
      } else {
        high = midpoint - 1;
      }
    }
    return low;
  }

  function findFirstFailedRequirement(bom: ActiveFinishedBom, units: number) {
    const stock = cloneStockByItemId(stockByItemId);
    const result = consumeBomRequirements(bom, units, stock);
    return result.ok === false ? result.bottleneckItemId : undefined;
  }

  function canBuildBomUnits(bom: ActiveFinishedBom, units: number) {
    const stock = cloneStockByItemId(stockByItemId);
    return consumeBomRequirements(bom, units, stock).ok;
  }

  function consumeBomRequirements(
    bom: ActiveFinishedBom,
    units: number,
    stock: Map<string, number>
  ): { ok: true } | { ok: false; bottleneckItemId: string } {
    for (const line of bom.lines) {
      const result = consumeItemRequirement(
        line.componentItemId,
        units * Number(line.quantity),
        stock
      );
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  function consumeItemRequirement(
    itemId: string,
    quantity: number,
    stock: Map<string, number>
  ): { ok: true } | { ok: false; bottleneckItemId: string } {
    if (quantity <= 0) return { ok: true };
    const available = stock.get(itemId) ?? 0;
    const consumed = Math.min(available, quantity);
    stock.set(itemId, roundQuantity(available - consumed));
    const remaining = roundQuantity(quantity - consumed);
    if (remaining <= 0) return { ok: true };
    return { ok: false, bottleneckItemId: itemId };
  }

  function cloneStockByItemId(entries: Map<string, DashboardStockEntry>) {
    return new Map([...entries.entries()].map(([itemId, entry]) => [itemId, entry.available]));
  }


  function collectReachableBuildBoms(rootBoms: ActiveFinishedBom[]) {
    const reachable: ActiveFinishedBom[] = [];
    const seen = new Set<string>();

    function visit(bom: ActiveFinishedBom) {
      const key = `${bom.parentItem.id}:${bom.version}`;
      if (seen.has(key)) return;
      seen.add(key);
      reachable.push(bom);

      for (const line of bom.lines) {
        for (const nestedBom of bomsByParentItemId.get(line.componentItemId) ?? []) {
          visit(nestedBom);
        }
      }
    }

    for (const bom of rootBoms) visit(bom);
    return reachable;
  }

  const candidates = activeFinishedBoms.map((bom) => ({
    bom,
    summary: summarizeBom(bom, new Set([bom.parentItem.id]))
  }));
  const selected = candidates[0];
  const summary = selected?.summary ?? emptySummary;
  if (!selected || !summary.finishedSku) return summary;

  const reachableBuildBoms = collectReachableBuildBoms([selected.bom]);
  const buildRows = reachableBuildBoms.map((bom) => {
    const buildSummary = summarizeBom(bom, new Set([bom.parentItem.id]));
    const availableBuiltUnits = stockByItemId.get(bom.parentItem.id)?.available ?? 0;
    const isPackageTarget = bom.parentItem.sku === summary.finishedSku;
    return {
      sku: bom.parentItem.sku,
      description: bom.parentItem.description,
      buildableUnits: buildSummary.finishedBuildCapacity,
      availableBuiltUnits,
      isPackageTarget,
      isBottleneck: !isPackageTarget && availableBuiltUnits + buildSummary.finishedBuildCapacity <= summary.finishedBuildCapacity
    } satisfies BuildCapacityBuild;
  });

  return {
    ...summary,
    buildRows
  };
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

