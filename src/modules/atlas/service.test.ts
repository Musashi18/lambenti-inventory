import { describe, expect, it } from "vitest";
import { buildAtlasMissionControlFromSources } from "./service";

const now = new Date("2026-07-01T12:00:00.000Z");

describe("Atlas mission-control service", () => {
  it("builds a read-only mission-control DTO from existing app sources", () => {
    const mission = buildAtlasMissionControlFromSources({
      now,
      sources: {
        dashboard: {
          launchReadiness: {
            targetPackages: 25,
            assembledPackages: 2,
            buildCapacityNow: 3,
            readyNow: 5,
            remainingToTarget: 20,
            bottleneckSku: "MAIN_UNIT",
            status: "BLOCKED",
            nextActions: [{ label: "Draft component purchase requests", reason: "Stock gap remains.", href: "/purchasing/recommendations", mutationBoundary: "human action required" }]
          },
          dashboardGraphs: {
            componentCapacityBars: [{ sku: "MAIN_UNIT", description: "Main unit", requiredPerBuild: 1, available: 0, capacity: 0, percentOfMax: 0, isBottleneck: true }],
            stockPressureBars: [{ sku: "CLIP", description: "Clip", available: 0, reorderPoint: 500, targetStock: 2500, shortageToReorder: 500, coveragePercent: 0, severity: "blocked" }],
            leadTimeBars: [],
            operationsFlow: [],
            valuationMix: [],
            launchProgress: { readyPercent: 20, gapPercent: 80 },
            launchCoverageSegments: []
          },
          recommendations: [{ sku: "CLIP", recommendedOrderQuantity: 500, priority: "HIGH", leadTimeDays: 18 }],
          incomingOrders: [{}],
          humanReviewActions: [],
          stockItems: [],
          totalOnHand: 0,
          componentsOnHand: 0,
          buildCapacity: { finishedBuildCapacity: 0, finishedSku: "LAMBENTI_PACKAGE", bottleneckSku: "MAIN_UNIT", componentCapacities: [] },
          assembledPackages: 2,
          totalAvailable: 0,
          lowStockItems: [],
          lowStockNotCurrentlyNeededItems: [],
          shortages: [],
          inventoryValuation: 0,
          openAutomationFindings: [],
          failedAutomationRuns: []
        } as never,
        tracking: {
          service: { configured: true, provider: "SHIP24", refreshIntervalMinutes: 360, lastCheckedAt: null, nextRefreshAt: null },
          summary: { total: 1, due: 0, delivered: 0, archived: 0, needsConfiguration: 0, failed: 0 },
          rows: [],
          deliveredRows: [],
          archivedRows: []
        } as never,
        accounting: { documents: [] } as never,
        automation: { recentRuns: [], openFindings: [], failedRuns: [] } as never
      }
    });

    expect(mission.graph.nodes.length).toBeGreaterThan(10);
    expect(mission.highestLeverageTask).not.toBeNull();
    expect(mission.evidenceCoverage.sourceCount).toBeGreaterThanOrEqual(4);
    expect(mission.goalPosition).toMatchObject({
      physicalTarget: {
        targetPackages: 25,
        assembledPackages: 2,
        buildableTowardTarget: 3,
        materialCoveredTowardTarget: 5,
        remainingBuildGap: 23,
        remainingMaterialGap: 20
      }
    });
    expect(mission.goalPosition?.milestones.map((item) => item.id)).toContain("phase1.first-batch");
    expect(mission.momentum.note).toContain("No Founder OS activity blocks are available yet");
  });
});
