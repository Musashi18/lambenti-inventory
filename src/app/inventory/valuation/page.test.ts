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
});
