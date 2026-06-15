import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Suppliers page source contract", () => {
  it("merges supplier contacts into the suppliers section with display-first edit controls", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("getItemSupplierEntries");
    expect(source).toContain("getActiveSupplierOptions");
    expect(source).toContain("updateItemSupplierEntryAction");
    expect(source).toContain("unarchiveSupplierAction");
    expect(source).toContain("<h2 className=\"font-medium\">Suppliers</h2>");
    expect(source).toContain("Company and contact name are shown by default");
    expect(source).toContain("SupplierAdditionalContactDetails");
    expect(source).toContain("Edit company");
    expect(source).toContain("Edit email");
    expect(source).toContain("Edit contact name");
    expect(source).toContain("Edit company revenue");
    expect(source).toContain("Edit founded year");
    expect(source).toContain("Edit address");
    expect(source).toContain("Edit human confirmation");
    expect(source).toContain("archiveSupplierAction");
    expect(source).toContain("deleteArchivedSupplierAction");
    expect(source).toContain("Archive supplier");
    expect(source).toContain("Archived suppliers");
    expect(source).toContain("Delete archived supplier");
    expect(source).toContain("Unarchive supplier");
    expect(source).toContain("ArchiveSupplierControl");
    expect(source).toContain("inline-block max-w-full text-xs text-slate-600");
    expect(source).toContain("text-[11px]");
    expect(source).toContain("hover:text-slate-800");
    expect(source).not.toContain("bg-amber-50");
    expect(source).not.toContain("border-amber-200");
    expect(source).not.toContain("text-amber-800");
    expect(source).toContain("Clean item type");
    expect(source).toContain("Unit price (USD)");
    expect(source).toContain("Add new supplier");
    expect(source).toContain("Human-confirmed supplier record");
    expect(source).not.toContain("Supplier contact profiles");
    expect(source).not.toContain("Supplier offers");
    expect(source).not.toContain("No supplier offers found.");
  });

  it("keeps custom supplier creation in one expandable section above archived suppliers", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    const addSectionMountIndex = source.indexOf("<AddNewSupplierSection supplierEntries={supplierEntries} costConfidences={costConfidences} />");
    const archivedSectionIndex = source.indexOf("Archived suppliers");
    expect(addSectionMountIndex).toBeGreaterThanOrEqual(0);
    expect(archivedSectionIndex).toBeGreaterThan(addSectionMountIndex);
    expect(source).not.toContain('form={formId} name="customSupplierName"');

    const addSectionStart = source.indexOf("function AddNewSupplierSection");
    const nextComponentStart = source.indexOf("function SupplierAdditionalContactDetails");
    expect(addSectionStart).toBeGreaterThanOrEqual(0);
    expect(nextComponentStart).toBeGreaterThan(addSectionStart);
    const addSectionSource = source.slice(addSectionStart, nextComponentStart);

    expect(addSectionSource).toContain("<summary");
    expect(addSectionSource).toContain("Add new supplier");
    expect(addSectionSource).toContain('name="itemId"');
    expect(addSectionSource).toContain('name="customSupplierName"');
    expect(addSectionSource).toContain('name="supplierSku"');
    expect(addSectionSource).toContain('name="estimatedUnitCost"');
    expect(addSectionSource).toContain('name="costConfidence"');
    expect(addSectionSource).toContain('name="costSourceRef"');
  });
});
