import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ItemsCatalog client interaction source contract", () => {
  it("wires edit saves through an explicit submit handler and exposes an unarchive control", () => {
    const source = readFileSync(join(__dirname, "items-catalog.tsx"), "utf8");

    expect(source).toContain("updateItemFormAction");
    expect(source).toContain("onSubmit={(event) =>");
    expect(source).toContain("runItemAction(`update:${item.id}`");
    expect(source).toContain("Saving changes");
    expect(source).toContain("unarchiveItemFormAction");
    expect(source).toContain("runItemAction(`unarchive:${item.id}`");
    expect(source).toContain("Unarchive");
  });

  it("renders blank unit costs as an em dash instead of USD 0.00", () => {
    const source = readFileSync(join(__dirname, "items-catalog.tsx"), "utf8");

    expect(source).toContain('const rawUnitCost = (item.displayUnitCost ?? item.estimatedUnitCost).trim();');
    expect(source).toContain('if (rawUnitCost === "") return "—";');
    expect(source).toContain("Number(rawUnitCost)");
    expect(source).toContain("displayCostSource");
  });

  it("keeps item price inputs at 4-decimal resolution while table display stays cents-rounded", () => {
    const source = readFileSync(join(__dirname, "items-catalog.tsx"), "utf8");

    expect(source).toContain('step="0.0001"');
    expect(source).toContain("toFixed(2)");
  });

  it("exposes a custom supplier name input in the edit modal", () => {
    const source = readFileSync(join(__dirname, "items-catalog.tsx"), "utf8");

    expect(source).toContain('name="customSupplierName"');
    expect(source).toContain("Custom Supplier");
  });

  it("keeps the current preferred supplier option available when active supplier filtering omits it", () => {
    const source = readFileSync(join(__dirname, "items-catalog.tsx"), "utf8");

    expect(source).toContain("supplierOptionsForItem");
    expect(source).toContain("current preferred supplier");
    expect(source).toContain("item.preferredSupplierId");
    expect(source).toContain("item.preferredSupplierName");
    expect(source).toContain("getStockHealth");
    expect(source).toContain("No Supplier");
    expect(source).toContain("Below Reorder");
    expect(source).toContain("Needs Cost");
  });

  it("keeps the stock-health legend visible even when live data has no rows in a status", () => {
    const source = readFileSync(join(__dirname, "items-catalog.tsx"), "utf8");

    expect(source).toContain("stockHealthLegend");
    expect(source).toContain('aria-label="Stock health status legend"');
    expect(source).toContain("No Supplier");
    expect(source).toContain("Needs Cost");
    expect(source).toContain("Below Reorder");
    expect(source).toContain("OK");
  });

  it("groups the active catalog by item-use section and exposes manual section moves", () => {
    const source = readFileSync(join(__dirname, "items-catalog.tsx"), "utf8");

    expect(source).toContain("groupItemOptionsByUse(items)");
    expect(source).toContain("ITEM_USE_GROUP_RULES.map");
    expect(source).toContain("updateItemUseGroupFormAction");
    expect(source).toContain('name="useGroupOverride"');
    expect(source).toContain("Manual section override");
  });
});
