import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ValuationPage source contract", () => {
  it("surfaces price-source provenance so valuation prices are auditable", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("Price Source");
    expect(source).toContain("formatCostSource(row)");
    expect(source).toContain("costSourceRefs");
    expect(source).toContain("getActivePricedItemValuationInputs owns the active-item query");
  });

  it("groups priced valuation rows by item type so new items land in their section", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("groupPricedItemValuationsByItemType(itemValuation.rows)");
    expect(source).toContain("Priced Item Valuation by Item Type");
    expect(source).toContain("future items fall into the right section automatically");
  });

  it("renders a share-based value concentration visual for valuation risk", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("Top 5 Share");
    expect(source).toContain("Largest Position");
    expect(source).toContain("Long Tail");
    expect(source).toContain("Concentration Reading");
    expect(source).toContain("percentOfTotal");
    expect(source).toContain("Value concentration share of total priced inventory");
  });
});
