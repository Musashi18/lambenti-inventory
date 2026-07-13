import { describe, expect, it } from "vitest";
import { collectAccountingEvidence, collectDashboardEvidence, collectTrackingEvidence, getAtlasPhaseOneReadiness } from "./evidence-adapters";

const observedAt = "2026-07-01T12:00:00.000Z";

describe("Atlas evidence adapters", () => {
  it("maps launch readiness into validated inventory evidence without mutation authority", () => {
    const evidence = collectDashboardEvidence({
      launchReadiness: {
        targetPackages: 25,
        readyNow: 5,
        remainingToTarget: 20,
        bottleneckSku: "MAIN_UNIT",
        status: "BLOCKED",
        nextActions: [{ label: "Draft component purchase requests", reason: "Stock gap remains.", href: "/purchasing/recommendations" }]
      },
      dashboardGraphs: {
        componentCapacityBars: [{ sku: "MAIN_UNIT", capacity: 0, isBottleneck: true }],
        stockPressureBars: [{ sku: "CLIP", shortageToReorder: 500, severity: "blocked" }]
      },
      recommendations: [{ sku: "CLIP", recommendedOrderQuantity: 500, priority: "HIGH", leadTimeDays: 18 }],
      incomingOrders: [{}],
      humanReviewActions: []
    }, observedAt);

    expect(evidence.find((item) => item.id === "dashboard:phase1-coverage")).toMatchObject({
      nodeId: "inventory.phase1-coverage",
      sourceType: "INVENTORY",
      completionPct: 20,
      validatedProgress: true
    });
    expect(evidence.map((item) => item.href)).toContain("/purchasing/recommendations");
    expect(evidence.every((item) => item.summary.toLowerCase().includes("receive stock") === false)).toBe(true);
  });

  it("keeps exact ledger-built, direct-buildable, and material-covered units distinct", () => {
    const readiness = getAtlasPhaseOneReadiness({
      launchReadiness: {
        packageSku: "LAMBENTI_PACKAGE",
        packageDescription: "Complete Package Assembly",
        packageDisplayName: "LAMBENTI_PACKAGE — Complete Package Assembly",
        targetPackages: 25,
        assembledPackages: 2,
        readyNow: 2,
        buildCapacityNow: 3,
        buildableTowardTarget: 3,
        materialCoverageNow: 5,
        materialCoveredTowardTarget: 5,
        remainingBuildGap: 23,
        remainingMaterialGap: 20,
        bottleneckSku: "MAIN_UNIT",
        status: "BLOCKED",
        nextActions: [{ label: "Draft component purchase requests", reason: "Stock gap remains.", href: "/purchasing/recommendations" }]
      },
      recommendations: [],
      incomingOrders: [],
      humanReviewActions: []
    });

    expect(readiness).toMatchObject({
      assembledPackages: 2,
      buildableTowardTarget: 3,
      materialCoveredTowardTarget: 5,
      remainingBuildGap: 23,
      remainingMaterialGap: 20,
      status: "BLOCKED"
    });
    expect(readiness.assembledPackages).not.toBe(readiness.materialCoveredTowardTarget);
  });

  it("maps tracking provider failures to operations risk", () => {
    const evidence = collectTrackingEvidence({
      service: { configured: true, provider: "SHIP24" },
      summary: { total: 3, due: 1, delivered: 1, archived: 0, needsConfiguration: 0, failed: 1 },
      rows: [{ trackingNumber: "1ZTEST", currentStatus: "IN_TRANSIT", supplierName: "Supplier", latestEvent: { description: "Departed" } }],
      deliveredRows: [{}]
    }, observedAt);

    expect(evidence[0]).toMatchObject({ nodeId: "operations.shipping", sourceType: "TRACKING" });
    expect(evidence[0].riskScore).toBeGreaterThanOrEqual(70);
  });

  it("maps unreadable accounting documents to finance risk", () => {
    const evidence = collectAccountingEvidence({
      documents: [
        { status: "NEEDS_REVIEW", originalFileName: "invoice.pdf" },
        { status: "ANALYZED", originalFileName: "receipt.pdf" }
      ]
    }, observedAt);

    expect(evidence[0]).toMatchObject({ nodeId: "finance.cash-runway", sourceType: "ACCOUNTING" });
    expect(evidence[0].summary).toContain("1 accounting source document");
  });
});
