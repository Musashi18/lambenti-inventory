import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("BOM builder page source contract", () => {
  it("uses a dynamic BOM builder instead of the old active-items coverage table", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const builderSource = readFileSync(join(__dirname, "bom-builder.tsx"), "utf8");

    expect(pageSource).toContain("BomBuilder");
    expect(pageSource).toContain("finishedUnitItems");
    expect(pageSource).not.toContain("Active items imported from item master");
    expect(builderSource).toContain("Create another finished unit section");
    expect(builderSource).toContain("No finished units available");
    expect(builderSource).toContain("Add component line");
    expect(builderSource).toContain("Remove row");
    expect(builderSource).toContain("selectedComponentDetails");
  });
});
