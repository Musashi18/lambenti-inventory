import type { AtlasEvidence } from "./types";

type DashboardEvidenceSource = {
  launchReadiness: {
    targetPackages: number;
    readyNow: number;
    remainingToTarget: number;
    bottleneckSku: string;
    status: string;
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

export function collectDashboardEvidence(summary: DashboardEvidenceSource, observedAt: string): AtlasEvidence[] {
  const target = Math.max(summary.launchReadiness.targetPackages, 1);
  const readyPct = boundedPercent(summary.launchReadiness.readyNow, target);
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
      summary: `${summary.launchReadiness.readyNow}/${summary.launchReadiness.targetPackages} Phase I units are assembled or buildable; ${summary.launchReadiness.remainingToTarget} remain uncovered.`,
      confidencePct: 88,
      observedAt,
      href: "/",
      completionPct: readyPct,
      impactScore: 100,
      riskScore: summary.launchReadiness.remainingToTarget > 0 ? Math.min(90, 35 + summary.launchReadiness.remainingToTarget * 2) : 10,
      estimatedHours: summary.launchReadiness.remainingToTarget > 0 ? 20 : 5,
      validatedProgress: true
    },
    {
      id: "dashboard:production-unit",
      nodeId: "phase1.production-unit",
      sourceType: "INVENTORY",
      sourceRef: "getDashboardSummary.launchReadiness",
      summary: summary.launchReadiness.status === "COVERED"
        ? "Phase I package coverage is ready for the production-unit routine."
        : `Production-unit path is constrained by ${summary.launchReadiness.bottleneckSku || "unresolved package coverage"}.`,
      confidencePct: 82,
      observedAt,
      href: "/",
      completionPct: Math.max(readyPct - 10, 0),
      impactScore: 100,
      riskScore: summary.launchReadiness.status === "COVERED" ? 20 : 70,
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
      completionPct: readyPct,
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
      completionPct: Math.max(15, 70 - recommendations.length * 8),
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
      completionPct: 70,
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
      completionPct: 45,
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
      completionPct: summary.summary.total > 0 ? Math.max(30, Math.min(85, summary.summary.delivered * 20 + (summary.service.configured ? 25 : 0) - summary.summary.failed * 10)) : 30,
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
      completionPct: needsReview.length > 0 ? Math.max(20, 70 - needsReview.length * 8) : 72,
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
      completionPct: riskScore > 60 ? 35 : 58,
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
