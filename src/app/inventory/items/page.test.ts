import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("ItemsPage import/export source contract", () => {
  it("wires CSV export data and CSV import form panel into the inventory items page", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("exportItemsToCsv");
    expect(source).toContain("ItemImportExportPanel");
    expect(source).toContain("exportCsv=");
  });

  it("keeps CSV import/export collapsed at the bottom after the editable catalog", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const panelSource = readFileSync(join(__dirname, "item-import-export-panel.tsx"), "utf8");

    expect(pageSource.indexOf("<ItemsCatalog")).toBeGreaterThan(-1);
    expect(pageSource.indexOf("<ItemImportExportPanel")).toBeGreaterThan(pageSource.indexOf("<ItemsCatalog"));
    expect(panelSource).toContain("<details");
    expect(panelSource).not.toContain("<details open");
  });

  it("loads cleaned confirmed supplier options instead of raw supplier rows", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("getConfirmedSupplierOptions");
    expect(source).toContain("confirmedSupplierOptions");
  });
});

describe("active item catalog source contract", () => {
  it("shows unit price in USD instead of preferred supplier in the active row table", () => {
    const source = readFileSync(join(__dirname, "items-catalog.tsx"), "utf8");

    expect(source).toContain("Unit price (USD)");
    expect(source).toContain("formatUsdUnitPrice");
    expect(source).not.toContain('<th className="px-4 py-3 font-medium">Preferred supplier</th>');
  });
});
