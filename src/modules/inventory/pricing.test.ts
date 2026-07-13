import { describe, expect, it } from "vitest";
import { resolveItemUnitCostIndex } from "./pricing";

describe("resolveItemUnitCostIndex", () => {
  it("uses landed evidence before item estimates and BOM rollups", () => {
    const costs = resolveItemUnitCostIndex([
      { id: "led", sku: "LED", category: "COMPONENT", estimatedUnitCost: 0.9, costCurrency: "USD" },
      { id: "psu", sku: "PSU", category: "COMPONENT", estimatedUnitCost: 2, costCurrency: "USD" },
      { id: "pkg", sku: "LAMBENTI_PACKAGE", category: "FINISHED_GOOD", estimatedUnitCost: null, costCurrency: "USD" }
    ], [
      {
        parentItemId: "pkg",
        version: "v1",
        lines: [
          { componentItemId: "led", quantity: 2, componentItem: { sku: "LED" } },
          { componentItemId: "psu", quantity: 1, componentItem: { sku: "PSU" } }
        ]
      }
    ], new Map([
      ["led", { itemId: "led", sku: "LED", landedUnitCost: 1.2345, totalLandedCost: 123.45, quantity: 100, currency: "USD", sourceRefs: ["invoice-1"] }]
    ]));

    expect(costs.get("led")).toMatchObject({ unitCost: 1.2345, source: "ACCOUNTING_LANDED_COST" });
    expect(costs.get("pkg")).toMatchObject({ unitCost: 4.469, source: "BOM_ROLLUP" });
  });

  it("lets a manual finished-good item cost override the BOM-derived default", () => {
    const costs = resolveItemUnitCostIndex([
      { id: "component", sku: "COMP", category: "COMPONENT", estimatedUnitCost: 1, costCurrency: "USD" },
      { id: "finished", sku: "FG", category: "FINISHED_GOOD", estimatedUnitCost: 9.99, costCurrency: "USD", costSourceRef: "manual override" }
    ], [
      { parentItemId: "finished", version: "v1", lines: [{ componentItemId: "component", quantity: 2, componentItem: { sku: "COMP" } }] }
    ]);

    expect(costs.get("finished")).toMatchObject({ unitCost: 9.99, source: "ITEM_UNIT_COST", sourceRefs: ["manual override"] });
  });

  it("keeps accounting landed cost ahead of manual finished-good overrides and BOM rollups", () => {
    const costs = resolveItemUnitCostIndex([
      { id: "component", sku: "COMP", category: "COMPONENT", estimatedUnitCost: 1, costCurrency: "USD" },
      { id: "finished", sku: "FG", category: "FINISHED_GOOD", estimatedUnitCost: 9.99, costCurrency: "USD", costSourceRef: "manual override" }
    ], [
      { parentItemId: "finished", version: "v1", lines: [{ componentItemId: "component", quantity: 2, componentItem: { sku: "COMP" } }] }
    ], new Map([
      ["finished", { itemId: "finished", sku: "FG", landedUnitCost: 12.34, totalLandedCost: 123.4, quantity: 10, currency: "USD", sourceRefs: ["invoice-fg"] }]
    ]));

    expect(costs.get("finished")).toMatchObject({
      unitCost: 12.34,
      source: "ACCOUNTING_LANDED_COST",
      sourceLabel: "Accounting landed cost · 10 units",
      sourceRefs: ["invoice-fg"]
    });
  });

  it("does not understate a finished-good cost when any component cost is missing", () => {
    const costs = resolveItemUnitCostIndex([
      { id: "known", sku: "KNOWN", category: "COMPONENT", estimatedUnitCost: 1, costCurrency: "USD" },
      { id: "missing", sku: "MISSING", category: "COMPONENT", estimatedUnitCost: null, costCurrency: "USD" },
      { id: "finished", sku: "FG", category: "FINISHED_GOOD", estimatedUnitCost: null, costCurrency: "USD" }
    ], [
      {
        parentItemId: "finished",
        version: "v1",
        lines: [
          { componentItemId: "known", quantity: 1, componentItem: { sku: "KNOWN" } },
          { componentItemId: "missing", quantity: 1, componentItem: { sku: "MISSING" } }
        ]
      }
    ]);

    expect(costs.get("finished")).toBeUndefined();
  });

  it("recalculates nested downstream finished-good rollups whenever a constituent price becomes available or changes", () => {
    const items = [
      { id: "pcb", sku: "PCB", category: "COMPONENT", estimatedUnitCost: 1, costCurrency: "USD" },
      { id: "housing", sku: "HOUSING", category: "COMPONENT", estimatedUnitCost: 2, costCurrency: "USD" },
      { id: "packaging", sku: "PACKAGING", category: "COMPONENT", estimatedUnitCost: null as number | null, costCurrency: "USD" },
      { id: "main", sku: "LAMBENTI_MAIN_UNIT", category: "FINISHED_GOOD", estimatedUnitCost: null as number | null, costCurrency: "USD" },
      { id: "connector", sku: "LED_CONN", category: "FINISHED_GOOD", estimatedUnitCost: null as number | null, costCurrency: "USD" },
      { id: "package", sku: "LAMBENTI_PACKAGE", category: "FINISHED_GOOD", estimatedUnitCost: null as number | null, costCurrency: "USD" }
    ];
    const boms = [
      { parentItemId: "main", version: "main-v1", lines: [{ componentItemId: "pcb", quantity: 2, componentItem: { sku: "PCB" } }] },
      { parentItemId: "connector", version: "connector-v1", lines: [{ componentItemId: "housing", quantity: 1, componentItem: { sku: "HOUSING" } }] },
      {
        parentItemId: "package",
        version: "package-v1",
        lines: [
          { componentItemId: "main", quantity: 1, componentItem: { sku: "LAMBENTI_MAIN_UNIT" } },
          { componentItemId: "connector", quantity: 2, componentItem: { sku: "LED_CONN" } },
          { componentItemId: "packaging", quantity: 1, componentItem: { sku: "PACKAGING" } }
        ]
      }
    ];

    expect(resolveItemUnitCostIndex(items, boms).get("package")).toBeUndefined();

    items[2].estimatedUnitCost = 4;
    expect(resolveItemUnitCostIndex(items, boms).get("package")).toMatchObject({ unitCost: 10, source: "BOM_ROLLUP" });

    items[0].estimatedUnitCost = 1.5;
    items[1].estimatedUnitCost = 2.5;
    expect(resolveItemUnitCostIndex(items, boms).get("package")).toMatchObject({ unitCost: 12, source: "BOM_ROLLUP" });
  });

  it("contains malformed circular BOM cost dependencies without blocking unrelated rollups", () => {
    const costs = resolveItemUnitCostIndex([
      { id: "a", sku: "ASSEMBLY_A", category: "FINISHED_GOOD", estimatedUnitCost: null, costCurrency: "USD" },
      { id: "b", sku: "ASSEMBLY_B", category: "FINISHED_GOOD", estimatedUnitCost: null, costCurrency: "USD" },
      { id: "component", sku: "KNOWN_COMPONENT", category: "COMPONENT", estimatedUnitCost: 3, costCurrency: "USD" },
      { id: "healthy", sku: "HEALTHY_PACKAGE", category: "FINISHED_GOOD", estimatedUnitCost: null, costCurrency: "USD" }
    ], [
      { parentItemId: "a", version: "a-v1", lines: [{ componentItemId: "b", quantity: 1, componentItem: { sku: "ASSEMBLY_B" } }] },
      { parentItemId: "b", version: "b-v1", lines: [{ componentItemId: "a", quantity: 1, componentItem: { sku: "ASSEMBLY_A" } }] },
      { parentItemId: "healthy", version: "healthy-v1", lines: [{ componentItemId: "component", quantity: 2, componentItem: { sku: "KNOWN_COMPONENT" } }] }
    ]);

    expect(costs.get("a")).toBeUndefined();
    expect(costs.get("b")).toBeUndefined();
    expect(costs.get("healthy")).toMatchObject({ unitCost: 6, source: "BOM_ROLLUP" });
  });
});
