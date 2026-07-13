import type { AtlasEvidence, AtlasPhaseOneReadinessInput } from "./types";

type DashboardEvidenceSource = {
  launchReadiness: {
    packageSku?: string;
    packageDescription?: string;
    packageDisplayName?: string;
    targetPackages: number;
    assembledPackages?: number;
    readyNow: number;
    buildCapacityNow?: number;
    buildableTowardTarget?: number;
    materialCoverageNow?: number;
    materialCoveredTowardTarget?: number;
    remainingBuildGap?: number;
    remainingMaterialGap?: number;
    remainingToTarget?: number;
    bottleneckSku: string;
    status: AtlasPhaseOneReadinessInput["status"];
    nextActions: Array<{ label: string; reason: string; href: string }>;
  };
  dashboardGraphs?: {
    stockPressureBars?: Array<{ sku: string; shortageToReorder: number; severity: string }>;
    componentCapacityBars?: Array<{ sku: string; capacity: number; isBottleneck?: boolean }>;
    leadTimeBars?: Array<{ sku: string; days: number; source: string }>;
  };
  recommendations?: Array<{ sku: string; recommendedOrderQuantity: number; priority?: string; leadTimeDays?: number }>;
  incomingOrders?: Array<unknown>;
  humanReviewActions?: Array<{ kind: string; label: string; reason: string; href: string }>;
};

type TrackingEvidenceSource = {
  service: { configured: boolean; provider: string };
  summary: { total: number; due: number; delivered: number; archived: number; needsConfiguration: number; failed: number };
  rows: Array<{ trackingNumber: string; currentStatus: string; supplierName: string | null; latestEvent?: { description: string } | null }>;
  deliveredRows?: Array<unknown>;
};

type AccountingEvidenceSource = {
  documents: Array<{ status: string; originalFileName: string; errorMessage?: string | null }>;
};

type AutomationEvidenceSource = {
  openFindings: Array<{ severity: string; title: string; message: string }>;
  failedRuns: Array<{ kind: string; errorMessage?: string | null }>;
};

export function collectAtlasOperationalEvidence(input: {
  dashboard: DashboardEvidenceSource;
  tracking: TrackingEvidenceSource;
  accounting: AccountingEvidenceSource;
  automation: AutomationEvidenceSource;
  now?: Date;
}): AtlasEvidence[] {
  const now = (input.now ?? new Date()).toISOString();
  return [
    ...collectDashboardEvidence(input.dashboard, now),
    ...collectTrackingEvidence(input.tracking, now),
    ...collectAccountingEvidence(input.accounting, now),
    ...collectAutomationEvidence(input.automation, now)
  ];
}

/**
 * Keeps the exact 25-unit package position separate from graph/scenario scores.
 * `assembledPackages` is ledger-built physical output only; buildable and material coverage are
 * explicitly adjacent readiness states, never quietly treated as completed units.
 */
export function getAtlasPhaseOneReadiness(summary: DashboardEvidenceSource): AtlasPhaseOneReadinessInput {
  const readiness = summary.launchReadiness;
  const targetPackages = Math.max(readiness.targetPackages, 1);
  const assembledPackages = Math.max(0, readiness.assembledPackages ?? readiness.readyNow);
  const buildCapacityNow = Math.max(0, readiness.buildCapacityNow ?? 0);
  const remainingBuildGap = Math.max(0, readiness.remainingBuildGap ?? targetPackages - assembledPackages);
  const buildableTowardTarget = Math.min(Math.max(0, readiness.buildableTowardTarget ?? buildCapacityNow), remainingBuildGap);
  const materialCoverageNow = Math.max(assembledPackages, readiness.materialCoverageNow ?? assembledPackages + buildCapacityNow);
  const materialCoveredTowardTarget = Math.min(targetPackages, Math.max(assembledPackages, readiness.materialCoveredTowardTarget ?? assembledPackages + buildableTowardTarget));
  const remainingMaterialGap = Math.max(0, readiness.remainingMaterialGap ?? readiness.remainingToTarget ?? targetPackages - materialCoverageNow);

  return {
    packageSku: readiness.packageSku ?? "LAMBENTI_PACKAGE",
    packageDescription: readiness.packageDescription ?? "Complete Package Assembly",
    packageDisplayName: readiness.packageDisplayName ?? "LAMBENTI_PACKAGE — Complete Package Assembly",
    targetPackages,
    assembledPackages,
    buildCapacityNow,
    buildableTowardTarget,
    materialCoverageNow,
    materialCoveredTowardTarget,
    remainingBuildGap,
    remainingMaterialGap,
    bottleneckSku: readiness.bottleneckSku,
    status: readiness.status,
    nextActions: readiness.nextActions.map((action) => ({ label: action.label, reason: action.reason, href: action.href }))
  };
}

export function collectDashboardEvidence(summary: DashboardEvidenceSource, observedAt: string): AtlasEvidence[] {
  const target = Math.max(summary.launchReadiness.targetPackages, 1);
  const ledgerBuilt = Math.max(0, summary.launchReadiness.assembledPackages ?? summary.launchReadiness.readyNow);
  const materialCoveredTowardTarget = summary.launchReadiness.materialCoveredTowardTarget ?? ledgerBuilt;
  const materialPct = boundedPercent(materialCoveredTowardTarget, target);
  const remainingBuildGap = Math.max(0, summary.launchReadiness.remainingBuildGap ?? target - ledgerBuilt);
  const remainingMaterialGap = Math.max(0, summary.launchReadiness.remainingMaterialGap ?? summary.launchReadiness.remainingToTarget ?? target - materialCoveredTowardTarget);
  const recommendations = summary.recommendations ?? [];
  const incomingOrders = summary.incomingOrders ?? [];
  const stockPressure = summary.dashboardGraphs?.stockPressureBars ?? [];
  const bottleneck = summary.dashboardGraphs?.componentCapacityBars?.find((component) => component.isBottleneck) ?? null;
  const nextAction = summary.launchReadiness.nextActions[0];

  const evidence: AtlasEvidence[] = [
    {
      id: "dashboard:phase1-coverage",
      nodeId: "inventory.phase1-coverage",
      sourceType: "INVENTORY",
      sourceRef: "getDashboardSummary.launchReadiness",
      summary: `${ledgerBuilt}/${summary.launchReadiness.targetPackages} Phase I packages are ledger-built; ${summary.launchReadiness.buildCapacityNow ?? 0} more package build action(s) are possible from already-built package inputs, leaving ${remainingBuildGap} explicit build(s) and ${remainingMaterialGap} package-input gap unit(s).`,
      confidencePct: 88,
      observedAt,
      href: "/",
      completionPct: materialPct,
      impactScore: 100,
      riskScore: remainingMaterialGap > 0 ? Math.min(90, 35 + remainingMaterialGap * 2) : remainingBuildGap > 0 ? 45 : 10,
      estimatedHours: remainingBuildGap > 0 ? 20 : 5,
      validatedProgress: true
    },
    {
      id: "dashboard:production-unit",
      nodeId: "phase1.production-unit",
      sourceType: "INVENTORY",
      sourceRef: "getDashboardSummary.launchReadiness",
      summary: summary.launchReadiness.status === "COVERED"
        ? "Phase I package assemblies are built for the production-unit routine."
        : summary.launchReadiness.status === "BUILD_READY"
          ? "Phase I package materials are covered, but explicit BUILD movements are still needed before units are ready."
          : `Production-unit path is constrained by ${summary.launchReadiness.bottleneckSku || "unresolved package coverage"}.`,
      confidencePct: 82,
      observedAt,
      href: "/",

      impactScore: 100,
      riskScore: summary.launchReadiness.status === "COVERED" ? 20 : summary.launchReadiness.status === "BUILD_READY" ? 45 : 70,
      validatedProgress: true
    }
  ];

  if (bottleneck) {
    evidence.push({
      id: `dashboard:bom-bottleneck:${bottleneck.sku}`,
      nodeId: "phase1.first-batch",
      sourceType: "BOM",
      sourceRef: "dashboardGraphs.componentCapacityBars",
      summary: `${bottleneck.sku} is the current package BOM bottleneck with capacity ${bottleneck.capacity}.`,
      confidencePct: 82,
      observedAt,
      href: "/boms",
      impactScore: 96,
      riskScore: bottleneck.capacity <= 0 ? 85 : 62,
      estimatedHours: 18,
      validatedProgress: true
    });
  }

  if (recommendations.length > 0) {
    const top = recommendations[0];
    evidence.push({
      id: "dashboard:purchasing-recommendations",
      nodeId: "manufacturing.supplier-qualification",
      sourceType: "PURCHASING",
      sourceRef: "getPurchaseRecommendations",
      summary: `${recommendations.length} purchasing recommendation(s) remain; top row is ${top.recommendedOrderQuantity} × ${top.sku}${top.leadTimeDays ? ` with ${top.leadTimeDays}d lead time` : ""}.`,
      confidencePct: 80,
      observedAt,
      href: "/purchasing/recommendations",
      impactScore: 94,
      riskScore: Math.min(90, 50 + recommendations.length * 6),
      estimatedHours: 12,
      validatedProgress: true
    });
  } else {
    evidence.push({
      id: "dashboard:purchasing-clear",
      nodeId: "manufacturing.supplier-qualification",
      sourceType: "PURCHASING",
      sourceRef: "getPurchaseRecommendations",
      summary: "No current component purchase recommendation rows are open.",
      confidencePct: 75,
      observedAt,
      href: "/purchasing/recommendations",
      impactScore: 80,
      riskScore: 25,
      validatedProgress: true
    });
  }

  if (incomingOrders.length > 0) {
    evidence.push({
      id: "dashboard:incoming-orders",
      nodeId: "operations.shipping",
      sourceType: "PURCHASING",
      sourceRef: "getIncomingOrders",
      summary: `${incomingOrders.length} incoming order(s) may improve readiness after physical count and receiving.`,
      confidencePct: 78,
      observedAt,
      href: "/incoming",
      impactScore: 78,
      riskScore: 52,
      estimatedHours: 8,
      validatedProgress: true
    });
  }

  if (stockPressure.length > 0) {
    evidence.push({
      id: "dashboard:stock-pressure",
      nodeId: "inventory.phase1-coverage",
      sourceType: "INVENTORY",
      sourceRef: "dashboardGraphs.stockPressureBars",
      summary: `${stockPressure.length} low-stock pressure signal(s) remain; highest pressure is ${stockPressure[0].sku}.`,
      confidencePct: 82,
      observedAt,
      href: "/inventory/items",
      impactScore: 86,
      riskScore: stockPressure[0].severity === "blocked" ? 76 : 58,
      estimatedHours: 10,
      validatedProgress: true
    });
  }

  if (nextAction) {
    evidence.push({
      id: "dashboard:next-action",
      nodeId: nextAction.href.includes("purchasing") ? "manufacturing.supplier-qualification" : nextAction.href.includes("incoming") ? "operations.shipping" : "inventory.phase1-coverage",
      sourceType: "INVENTORY",
      sourceRef: "launchReadiness.nextActions[0]",
      summary: `${nextAction.label}: ${nextAction.reason}`,
      confidencePct: 80,
      observedAt,
      href: nextAction.href,
      impactScore: 92,
      riskScore: 60,
      estimatedHours: 8,
      validatedProgress: true
    });
  }

  evidence.push({
    id: "dashboard:first-batch-built",
    nodeId: "phase1.first-batch",
    sourceType: "INVENTORY",
    sourceRef: "getDashboardSummary.launchReadiness",
    summary: `${ledgerBuilt}/${summary.launchReadiness.targetPackages} Phase I package assemblies are ledger-built. This measures completed package output only; material coverage and incoming orders remain separate evidence.`,
    confidencePct: 90,
    observedAt,
    href: "/",
    completionPct: boundedPercent(ledgerBuilt, target),
    impactScore: 100,
    riskScore: remainingBuildGap > 0 ? 75 : 20,
    validatedProgress: true
  });

  return evidence;
}

export function collectTrackingEvidence(summary: TrackingEvidenceSource, observedAt: string): AtlasEvidence[] {
  const riskScore = summary.summary.failed > 0
    ? 78
    : summary.summary.needsConfiguration > 0
      ? 70
      : summary.summary.due > 0
        ? 55
        : 25;
  const openRows = summary.rows.length;
  return [
    {
      id: "tracking:shipment-reliability",
      nodeId: "operations.shipping",
      sourceType: "TRACKING",
      sourceRef: "getTrackingDashboard.summary",
      summary: `${summary.service.provider} tracking: ${summary.summary.total} total, ${openRows} active, ${summary.summary.delivered} delivered, ${summary.summary.failed} failed refresh, ${summary.summary.due} due refresh.`,
      confidencePct: summary.service.configured ? 82 : 50,
      observedAt,
      href: "/tracking",
      impactScore: 78,
      riskScore,
      estimatedHours: riskScore >= 60 ? 6 : 3,
      validatedProgress: true
    }
  ];
}

export function collectAccountingEvidence(workbench: AccountingEvidenceSource, observedAt: string): AtlasEvidence[] {
  const needsReview = workbench.documents.filter((document) => ["UPLOADED", "NEEDS_REVIEW", "FAILED"].includes(document.status));
  return [
    {
      id: "accounting:document-control",
      nodeId: "finance.cash-runway",
      sourceType: "ACCOUNTING",
      sourceRef: "getAccountingWorkbench.documents",
      summary: needsReview.length > 0
        ? `${needsReview.length} accounting source document(s) still need review or extraction repair.`
        : "Recent accounting source documents are not showing unreadable/review-blocking statuses.",
      confidencePct: 76,
      observedAt,
      href: "/accounting",
      impactScore: 72,
      riskScore: needsReview.length > 0 ? Math.min(80, 45 + needsReview.length * 8) : 28,
      estimatedHours: needsReview.length > 0 ? Math.min(12, needsReview.length * 2) : 2,
      validatedProgress: true
    }
  ];
}

export function collectAutomationEvidence(overview: AutomationEvidenceSource, observedAt: string): AtlasEvidence[] {
  const criticalFindings = overview.openFindings.filter((finding) => ["CRITICAL", "HIGH"].includes(finding.severity));
  const riskScore = overview.failedRuns.length > 0 ? 72 : criticalFindings.length > 0 ? 68 : overview.openFindings.length > 0 ? 48 : 22;
  return [
    {
      id: "automation:execution-findings",
      nodeId: "manufacturing.qa",
      sourceType: "AUTOMATION",
      sourceRef: "getAutomationOverview",
      summary: `${overview.openFindings.length} open automation finding(s), ${criticalFindings.length} high/critical, ${overview.failedRuns.length} failed run(s).`,
      confidencePct: 70,
      observedAt,
      href: "/automation",
      impactScore: 80,
      riskScore,
      estimatedHours: riskScore > 60 ? 10 : 4,
      validatedProgress: true
    }
  ];
}

function boundedPercent(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}
