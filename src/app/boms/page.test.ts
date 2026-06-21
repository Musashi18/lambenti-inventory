import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("BOM Builder page source contract", () => {
  it("uses a dynamic BOM Builder instead of the old active-items coverage table", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const builderSource = readFileSync(join(__dirname, "bom-builder.tsx"), "utf8");

    expect(pageSource).toContain("BomBuilder");
    expect(pageSource).toContain("finishedUnitItems");
    expect(pageSource).not.toContain("Active items imported from item master");
    expect(builderSource).toContain("Create Another Finished Unit Section");
    expect(builderSource).toContain("No finished units available");
    expect(builderSource).toContain("Add Component Line");
    expect(builderSource).toContain("Remove Row");
    expect(builderSource).toContain("selectedComponentDetails");
    expect(builderSource).toContain("Build Constraint");
    expect(builderSource).toContain("Launch-Critical BOM");
    expect(builderSource).toContain("ItemSelectOptions");
    expect(builderSource).toContain("sortItemsByUseGroup");
    expect(builderSource).toContain('min="0.0001"');
    expect(builderSource).toContain('step="0.0001"');
  });
});
