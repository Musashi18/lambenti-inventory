import { describe, expect, it } from "vitest";
import { summarizeBuildCapacity, summarizeDashboardGraphs, summarizeLaunchReadiness } from "./service";

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
      packageSku: "LAMBENTI_PACKAGE",
      packageDescription: "Complete Package Assembly",
      packageDisplayName: "LAMBENTI_PACKAGE — Complete Package Assembly",
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

  it("marks the Phase I target build-ready only when material exists but package assemblies are not built", () => {
    const summary = summarizeLaunchReadiness({
      assembledPackages: 12,
      buildCapacityNow: 13,
      bottleneckSku: "LED_STRIP",
      recommendationCount: 0,
      recommendedUnits: 0,
      incomingOrderCount: 0,
      reviewActionCount: 0
    });

    expect(summary.status).toBe("BUILD_READY");
    expect(summary.readyNow).toBe(12);
    expect(summary.materialCoverageNow).toBe(25);
    expect(summary.remainingBuildGap).toBe(13);
    expect(summary.remainingMaterialGap).toBe(0);
    expect(summary.nextActions).toEqual([
      expect.objectContaining({ label: "Plan the next package build batch", href: "/inventory/movements" })
    ]);
  });

  it("marks Phase I covered only when package assemblies are built", () => {
    const summary = summarizeLaunchReadiness({
      assembledPackages: 25,
      buildCapacityNow: 0,
      bottleneckSku: "",
      recommendationCount: 0,
      recommendedUnits: 0,
      incomingOrderCount: 0,
      reviewActionCount: 0
    });

    expect(summary.status).toBe("COVERED");
    expect(summary.readyNow).toBe(25);
    expect(summary.remainingBuildGap).toBe(0);
    expect(summary.nextActions).toEqual([
      expect.objectContaining({ label: "Prepare Phase I QA/ship routine", href: "/inventory/movements" })
    ]);
  });
});

describe("summarizeBuildCapacity", () => {
  function item(id: string, sku: string) {
    return { id, sku, description: `${sku} description`, category: "FINISHED_GOOD", reorderPoint: 0 };
  }

  it("does not count unbuilt finished-good subassemblies as package-buildable units", () => {
    const packageBom = {
      version: "package-v1",
      parentItem: item("pkg", "LAMBENTI_PACKAGE"),
      lines: [
        { componentItemId: "ledConn", quantity: 1, componentItem: { sku: "LED_CONN", description: "LED connector assembly" } },
        { componentItemId: "psu", quantity: 1, componentItem: { sku: "PSU", description: "Power supply" } }
      ]
    };
    const ledConnBom = {
      version: "led-conn-v1",
      parentItem: item("ledConn", "LED_CONN"),
      lines: [
        { componentItemId: "housing", quantity: 1, componentItem: { sku: "CONN_HOUSING", description: "Connector housing" } },
        { componentItemId: "pcbAsm", quantity: 1, componentItem: { sku: "LED_CONN_ASSEMBLED_PCB", description: "Connector PCB assembly" } }
      ]
    };
    const pcbAssemblyBom = {
      version: "pcb-assembly-v1",
      parentItem: item("pcbAsm", "LED_CONN_ASSEMBLED_PCB"),
      lines: [
        { componentItemId: "pcb", quantity: 1, componentItem: { sku: "LED_CONN_PCB", description: "LED connector PCB" } },
        { componentItemId: "microFit", quantity: 1, componentItem: { sku: "430450200", description: "Micro-Fit connector" } }
      ]
    };
    const stock = new Map([
      ["ledConn", { itemId: "ledConn", onHand: 0, available: 0 }],
      ["psu", { itemId: "psu", onHand: 3, available: 3 }],
      ["housing", { itemId: "housing", onHand: 9, available: 9 }],
      ["pcbAsm", { itemId: "pcbAsm", onHand: 1, available: 1 }],
      ["pcb", { itemId: "pcb", onHand: 4, available: 4 }],
      ["microFit", { itemId: "microFit", onHand: 10, available: 10 }]
    ]);

    const summary = summarizeBuildCapacity([packageBom], stock, [packageBom, ledConnBom, pcbAssemblyBom]);

    expect(summary.finishedBuildCapacity).toBe(0);
    expect(summary.bottleneckSku).toBe("LED_CONN");
    expect(summary.componentCapacities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sku: "LED_CONN",
        available: 0,
        buildableSubassemblyCapacity: 1,
        effectiveAvailable: 1,
        capacity: 0
      }),
      expect.objectContaining({ sku: "PSU", capacity: 3 })
    ]));
    expect(summary.buildRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "LAMBENTI_PACKAGE", buildableUnits: 0, isPackageTarget: true }),
      expect.objectContaining({ sku: "LED_CONN", buildableUnits: 1 })
    ]));
  });

  it("keeps package capacity at zero until required subassemblies are ledger-built", () => {
    const packageBom = {
      version: "package-v1",
      parentItem: item("pkg", "LAMBENTI_PACKAGE"),
      lines: [
        { componentItemId: "subA", quantity: 1, componentItem: { sku: "SUB_A", description: "Subassembly A" } },
        { componentItemId: "subB", quantity: 1, componentItem: { sku: "SUB_B", description: "Subassembly B" } }
      ]
    };
    const subABom = {
      version: "sub-a-v1",
      parentItem: item("subA", "SUB_A"),
      lines: [
        { componentItemId: "shared", quantity: 1, componentItem: { sku: "SHARED_PART", description: "Shared nested component" } }
      ]
    };
    const subBBom = {
      version: "sub-b-v1",
      parentItem: item("subB", "SUB_B"),
      lines: [
        { componentItemId: "shared", quantity: 1, componentItem: { sku: "SHARED_PART", description: "Shared nested component" } }
      ]
    };
    const stock = new Map([
      ["subA", { itemId: "subA", onHand: 0, available: 0 }],
      ["subB", { itemId: "subB", onHand: 0, available: 0 }],
      ["shared", { itemId: "shared", onHand: 5, available: 5 }]
    ]);

    const summary = summarizeBuildCapacity([packageBom], stock, [packageBom, subABom, subBBom]);

    expect(summary.finishedBuildCapacity).toBe(0);
    expect(summary.bottleneckSku).toBe("SUB_A");
    expect(summary.componentCapacities).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "SUB_A", buildableSubassemblyCapacity: 5, effectiveAvailable: 5, capacity: 0 }),
      expect.objectContaining({ sku: "SUB_B", buildableSubassemblyCapacity: 5, effectiveAvailable: 5, capacity: 0 })
    ]));
    expect(summary.buildRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "LAMBENTI_PACKAGE", buildableUnits: 0, isPackageTarget: true }),
      expect.objectContaining({ sku: "SUB_A", buildableUnits: 5 }),
      expect.objectContaining({ sku: "SUB_B", buildableUnits: 5 })
    ]));
  });

  it("calculates material coverage from stocked exploded package components, not package build capacity", () => {
    const packageBom = {
      version: "package-v1",
      parentItem: item("pkg", "LAMBENTI_PACKAGE"),
      lines: [
        { componentItemId: "subA", quantity: 1, componentItem: { sku: "SUB_A", description: "Subassembly A" } },
        { componentItemId: "psu", quantity: 1, componentItem: { sku: "PSU", description: "Power supply" } }
      ]
    };
    const subABom = {
      version: "sub-a-v1",
      parentItem: item("subA", "SUB_A"),
      lines: [
        { componentItemId: "stockedLeaf", quantity: 1, componentItem: { sku: "STOCKED_LEAF", description: "Stocked package component" } },
        { componentItemId: "missingLeaf", quantity: 1, componentItem: { sku: "MISSING_LEAF", description: "Missing package component" } }
      ]
    };
    const stock = new Map([
      ["subA", { itemId: "subA", onHand: 0, available: 0 }],
      ["psu", { itemId: "psu", onHand: 1, available: 1 }],
      ["stockedLeaf", { itemId: "stockedLeaf", onHand: 1, available: 1 }],
      ["missingLeaf", { itemId: "missingLeaf", onHand: 0, available: 0 }]
    ]);

    const summary = summarizeBuildCapacity([packageBom], stock, [packageBom, subABom]);

    expect(summary.finishedBuildCapacity).toBe(0);
    expect(summary).toMatchObject({
      materialComponentsRequired: 3,
      materialComponentsInStock: 2,
      materialComponentsMissing: 1,
      materialCoveragePercent: 67,
      missingMaterialSkus: ["MISSING_LEAF"]
    });
  });

});

describe("summarizeDashboardGraphs", () => {
  it("keeps only useful dashboard graph data: launch gap, bottlenecks, stock pressure, operations, and valuation mix", () => {
    const launchReadiness = summarizeLaunchReadiness({
      assembledPackages: 5,
      buildCapacityNow: 10,
      bottleneckSku: "LAMBENTI_MAIN_UNIT",
      recommendationCount: 2,
      recommendedUnits: 100,
      incomingOrderCount: 3,
      reviewActionCount: 4
    });

    const graphs = summarizeDashboardGraphs({
      launchReadiness,
      buildCapacity: {
        bottleneckSku: "LAMBENTI_MAIN_UNIT",
        materialComponentsRequired: 18,
        materialComponentsInStock: 17,
        materialComponentsMissing: 1,
        materialCoveragePercent: 94,
        buildRows: [
          { sku: "LAMBENTI_PACKAGE", description: "Complete package", buildableUnits: 10, availableBuiltUnits: 5, isPackageTarget: true },
          { sku: "LAMBENTI_MAIN_UNIT", description: "Main unit", buildableUnits: 10, availableBuiltUnits: 0, isBottleneck: true },
          { sku: "LED_CONN", description: "LED connector", buildableUnits: 40, availableBuiltUnits: 0 }
        ],
        componentCapacities: [
          { sku: "LED_STRIP", description: "LED strip", requiredPerBuild: 1, available: 100, capacity: 100 },
          { sku: "LAMBENTI_MAIN_UNIT", description: "Main unit", requiredPerBuild: 1, available: 0, capacity: 0 },
          { sku: "PSU", description: "Power supply", requiredPerBuild: 1, available: 12, capacity: 12 }
        ]
      },
      lowStockItems: [
        { sku: "LAMBENTI_PACKAGE", description: "Complete package", category: "FINISHED_GOOD", available: 0, reorderPoint: 20, targetStock: 50 },
        { sku: "CLIP", description: "Clip", category: "COMPONENT", available: 0, reorderPoint: 500, targetStock: 2500 },
        { sku: "PSU", description: "Power supply", category: "COMPONENT", available: 12, reorderPoint: 20, targetStock: 100 },
        { sku: "SCREW", description: "Screw", category: "COMPONENT", available: 10, reorderPoint: 100, targetStock: 1000 }
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

    expect(graphs.launchProgress).toEqual({
      readyPercent: 20,
      materialPercent: 94,
      materialComponentsInStock: 17,
      materialComponentsRequired: 18,
      materialComponentsMissing: 1,
      gapPercent: 40
    });
    expect(graphs.launchCoverageSegments).toEqual([
      { label: "Built", units: 5, percent: 20, tone: "emerald" },
      { label: "Buildable", units: 10, percent: 40, tone: "cyan" },
      { label: "Material gap", units: 10, percent: 40, tone: "slate" }
    ]);
    expect(graphs.buildCapacityBars.map((item) => item.sku)).toEqual(["LAMBENTI_PACKAGE", "LAMBENTI_MAIN_UNIT", "LED_CONN"]);
    expect(graphs.buildCapacityBars).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "PCB-MAIN-REV-B" })
    ]));
    expect(graphs.componentCapacityBars[0]).toMatchObject({ sku: "LAMBENTI_MAIN_UNIT", capacity: 0, percentOfMax: 0, isBottleneck: true });
    expect(graphs.componentCapacityBars.at(-1)).toMatchObject({ sku: "LED_STRIP", capacity: 100, percentOfMax: 100 });
    expect(graphs.stockPressureBars.map((item) => item.sku)).toEqual(["CLIP", "SCREW", "PSU"]);
    expect(graphs.stockPressureBars.map((item) => item.sku)).not.toContain("LAMBENTI_PACKAGE");
    expect(graphs.stockPressureBars[0]).toMatchObject({ severity: "blocked", coveragePercent: 0, shortageToReorder: 500 });
    expect(graphs.leadTimeBars.map((item) => item.sku)).toEqual(["CLIP", "PSU"]);
    expect(graphs.leadTimeBars[0]).toMatchObject({ source: "MANUAL", days: 18, percentOfMax: 100 });
    expect(graphs.operationsFlow.find((item) => item.label === "Review Actions")).toMatchObject({ count: 4, percentOfMax: 100, href: "/#human-approval-queue" });
    expect(graphs.valuationMix).toEqual([
      expect.objectContaining({ category: "COMPONENT", sharePercent: 98 }),
      expect.objectContaining({ category: "FINISHED_GOOD", sharePercent: 2 })
    ]);
  });

  it("shows over-target launch capacity as a buffer instead of calling extra units required", () => {
    const launchReadiness = summarizeLaunchReadiness({
      assembledPackages: 0,
      buildCapacityNow: 26,
      bottleneckSku: "LAMBENTI_MAIN_UNIT",
      recommendationCount: 0,
      recommendedUnits: 0,
      incomingOrderCount: 0,
      reviewActionCount: 0
    });

    const graphs = summarizeDashboardGraphs({
      launchReadiness,
      buildCapacity: { bottleneckSku: "LAMBENTI_MAIN_UNIT", componentCapacities: [] },
      lowStockItems: [],
      leadTimeLog: { sampleCount: 0, itemCount: 0, totalQuantityOrdered: 0, averageLeadTimeDays: null, averageShipTimeDays: null, items: [] },
      inventoryValueByCategory: [],
      operations: { recommendationRows: 0, incomingOrders: 0, reviewActions: 0, automationWork: 0 }
    });

    expect(graphs.launchProgress).toEqual({
      readyPercent: 0,
      materialPercent: 100,
      materialComponentsInStock: 0,
      materialComponentsRequired: 0,
      materialComponentsMissing: 0,
      gapPercent: 0
    });
    expect(graphs.launchCoverageSegments).toEqual([
      { label: "Built", units: 0, percent: 0, tone: "emerald" },
      { label: "Buildable", units: 25, percent: 100, tone: "cyan" },
      { label: "Buffer beyond target", units: 1, percent: 0, tone: "sky" },
      { label: "Material gap", units: 0, percent: 0, tone: "slate" }
    ]);
  });

  it("fills the wide lead-time horizon with the 16 longest planning windows", () => {
    const leadTimeItems = Array.from({ length: 17 }, (_, index) => ({
      itemId: `item-${index}`,
      itemSku: `SKU-${String(index + 1).padStart(2, "0")}`,
      itemDescription: `Planning item ${index + 1}`,
      currentLeadTimeDays: 40 - index,
      manualLeadTimeDays: 40 - index,
      averageLeadTimeDays: 40 - index,
      weightedAverageLeadTimeDays: 40 - index,
      averageShipTimeDays: null,
      averageShipTimeLabel: null,
      leadTimeSource: "MANUAL" as const,
      leadTimeLabel: `${40 - index}d manual planning estimate`,
      sampleCount: 0,
      totalQuantityOrdered: 0,
      totalQuantityReceived: 0,
      entries: []
    }));
    const graphs = summarizeDashboardGraphs({
      launchReadiness: summarizeLaunchReadiness({ assembledPackages: 0, buildCapacityNow: 0, bottleneckSku: "LAMBENTI_MAIN_UNIT", recommendationCount: 0, recommendedUnits: 0, incomingOrderCount: 0, reviewActionCount: 0 }),
      buildCapacity: { bottleneckSku: "LAMBENTI_MAIN_UNIT", componentCapacities: [] },
      lowStockItems: [],
      leadTimeLog: { sampleCount: 0, itemCount: leadTimeItems.length, totalQuantityOrdered: 0, averageLeadTimeDays: null, averageShipTimeDays: null, items: leadTimeItems },
      inventoryValueByCategory: [],
      operations: { recommendationRows: 0, incomingOrders: 0, reviewActions: 0, automationWork: 0 }
    });

    expect(graphs.leadTimeBars).toHaveLength(16);
    expect(graphs.leadTimeBars.map((item) => item.sku)).toEqual(leadTimeItems.slice(0, 16).map((item) => item.itemSku));
    expect(graphs.leadTimeBars.at(-1)).toMatchObject({ sku: "SKU-16", days: 25 });
  });
});
