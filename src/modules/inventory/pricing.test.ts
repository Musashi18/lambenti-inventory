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
});
