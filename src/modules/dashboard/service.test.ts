import { describe, expect, it } from "vitest";
import { summarizeDashboardGraphs, summarizeLaunchReadiness } from "./service";

describe("summarizeLaunchReadiness", () => {
  it("turns launch-blocking operations into a simple read-only next-action plan", () => {
    const summary = summarizeLaunchReadiness({
      assembledPackages: 0,
      buildCapacityNow: 0,
      bottleneckSku: "LAMBENTI_MAIN_UNIT",
      recommendationCount: 4,
      recommendedUnits: 2484,
      incomingOrderCount: 6,
      reviewActionCount: 1
    });

    expect(summary).toMatchObject({
      targetPackages: 25,
      readyNow: 0,
      remainingToTarget: 25,
      status: "BLOCKED"
    });
    expect(summary.nextActions.map((action) => action.label)).toEqual([
      "Draft component purchase requests",
      "Receive incoming POs after count",
      "Clear review queue"
    ]);
    expect(summary.nextActions.every((action) => action.reason.includes("Current build capacity is 0"))).toBe(false);
    expect(summary.nextActions.every((action) => action.label !== "Unblock package build capacity")).toBe(true);
    expect(summary.nextActions.every((action) => action.mutationBoundary.includes("explicit human action"))).toBe(true);
  });

  it("marks the Phase I target covered when assembled plus buildable units reach 25", () => {
    const summary = summarizeLaunchReadiness({
      assembledPackages: 12,
      buildCapacityNow: 13,
      bottleneckSku: "LED_STRIP",
      recommendationCount: 0,
      recommendedUnits: 0,
      incomingOrderCount: 0,
      reviewActionCount: 0
    });

    expect(summary.status).toBe("COVERED");
    expect(summary.readyNow).toBe(25);
    expect(summary.remainingToTarget).toBe(0);
    expect(summary.nextActions).toEqual([
      expect.objectContaining({ label: "Prepare Phase I build/ship routine", href: "/inventory/movements" })
    ]);
  });
});

describe("summarizeDashboardGraphs", () => {
  it("keeps only useful dashboard graph data: launch gap, bottlenecks, stock pressure, operations, and valuation mix", () => {
    const launchReadiness = summarizeLaunchReadiness({
      assembledPackages: 5,
      buildCapacityNow: 10,
      bottleneckSku: "MAIN_UNIT",
      recommendationCount: 2,
      recommendedUnits: 100,
      incomingOrderCount: 3,
      reviewActionCount: 4
    });

    const graphs = summarizeDashboardGraphs({
      launchReadiness,
      buildCapacity: {
        bottleneckSku: "MAIN_UNIT",
        componentCapacities: [
          { sku: "LED_STRIP", description: "LED strip", requiredPerBuild: 1, available: 100, capacity: 100 },
          { sku: "MAIN_UNIT", description: "Main unit", requiredPerBuild: 1, available: 0, capacity: 0 },
          { sku: "PSU", description: "Power supply", requiredPerBuild: 1, available: 12, capacity: 12 }
        ]
      },
      lowStockItems: [
        { sku: "CLIP", description: "Clip", available: 0, reorderPoint: 500, targetStock: 2500 },
        { sku: "PSU", description: "Power supply", available: 12, reorderPoint: 20, targetStock: 100 },
        { sku: "SCREW", description: "Screw", available: 10, reorderPoint: 100, targetStock: 1000 }
      ],
      leadTimeLog: {
        sampleCount: 1,
        itemCount: 2,
        totalQuantityOrdered: 10,
        averageLeadTimeDays: 12,
        averageShipTimeDays: null,
        items: [
          {
            itemId: "clip",
            itemSku: "CLIP",
            itemDescription: "Clip",
            currentLeadTimeDays: 18,
            manualLeadTimeDays: 18,
            averageLeadTimeDays: 18,
            weightedAverageLeadTimeDays: 18,
            averageShipTimeDays: null,
            averageShipTimeLabel: null,
            leadTimeSource: "MANUAL",
            leadTimeLabel: "18d manual planning estimate · no received sample yet",
            sampleCount: 0,
            totalQuantityOrdered: 0,
            totalQuantityReceived: 0,
            entries: []
          },
          {
            itemId: "psu",
            itemSku: "PSU",
            itemDescription: "Power supply",
            currentLeadTimeDays: 12,
            manualLeadTimeDays: null,
            averageLeadTimeDays: 12,
            weightedAverageLeadTimeDays: 11.5,
            averageShipTimeDays: null,
            averageShipTimeLabel: null,
            leadTimeSource: "OBSERVED",
            leadTimeLabel: "12d observed bottleneck · 1 completed sample",
            sampleCount: 1,
            totalQuantityOrdered: 10,
            totalQuantityReceived: 10,
            entries: []
          }
        ]
      },
      inventoryValueByCategory: [
        { category: "COMPONENT", label: "Component", value: 844.6 },
        { category: "FINISHED_GOOD", label: "Finished Good", value: 15.08 }
      ],
      operations: {
        recommendationRows: 2,
        incomingOrders: 3,
        reviewActions: 4,
        automationWork: 0
      }
    });

    expect(graphs.launchProgress).toEqual({ readyPercent: 60, gapPercent: 40 });
    expect(graphs.launchCoverageSegments).toEqual([
      { label: "Assembled", units: 15, percent: 60, tone: "emerald" },
      { label: "Remaining gap", units: 10, percent: 40, tone: "slate" }
    ]);
    expect(graphs.componentCapacityBars[0]).toMatchObject({ sku: "MAIN_UNIT", capacity: 0, percentOfMax: 0, isBottleneck: true });
    expect(graphs.componentCapacityBars.at(-1)).toMatchObject({ sku: "LED_STRIP", capacity: 100, percentOfMax: 100 });
    expect(graphs.stockPressureBars.map((item) => item.sku)).toEqual(["CLIP", "SCREW", "PSU"]);
    expect(graphs.stockPressureBars[0]).toMatchObject({ severity: "blocked", coveragePercent: 0, shortageToReorder: 500 });
    expect(graphs.leadTimeBars.map((item) => item.sku)).toEqual(["CLIP", "PSU"]);
    expect(graphs.leadTimeBars[0]).toMatchObject({ source: "MANUAL", days: 18, percentOfMax: 100 });
    expect(graphs.operationsFlow.find((item) => item.label === "Review Actions")).toMatchObject({ count: 4, percentOfMax: 100, href: "/#human-approval-queue" });
    expect(graphs.valuationMix).toEqual([
      expect.objectContaining({ category: "COMPONENT", sharePercent: 98 }),
      expect.objectContaining({ category: "FINISHED_GOOD", sharePercent: 2 })
    ]);
  });
});
