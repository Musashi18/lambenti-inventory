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
    expect(source).toContain("Edit Company");
    expect(source).toContain("Edit Email");
    expect(source).toContain("Edit Contact Name");
    expect(source).toContain("Edit Company Revenue");
    expect(source).toContain("Edit Founded Year");
    expect(source).toContain("Edit Address");
    expect(source).toContain("Edit Human Confirmation");
    expect(source).toContain("archiveSupplierAction");
    expect(source).toContain("archiveSupplierCleanupCandidatesAction");
    expect(source).toContain("SupplierCleanupSection");
    expect(source).toContain("Supplier Cleanup Queue");
    expect(source).toContain("preserving historical email evidence");
    expect(source).toContain("Archive Cleanup Candidates");
    expect(source).toContain("deleteArchivedSupplierAction");
    expect(source).toContain("Archive Supplier");
    expect(source).toContain("Archived Suppliers");
    expect(source).toContain("Delete Archived Supplier");
    expect(source).toContain("Unarchive Supplier");
    expect(source).toContain("ArchiveSupplierControl");
    expect(source).toContain("inline-block max-w-full text-xs text-slate-600");
    expect(source).toContain("text-[11px]");
    expect(source).toContain("hover:text-slate-800");
    expect(source).toContain("Clean Item Type");
    expect(source).toContain("Unit Price (USD)");
    expect(source).toContain("Add New Supplier");
    expect(source).toContain("Human-Confirmed Supplier Record");
    expect(source).not.toContain("Supplier contact profiles");
    expect(source).not.toContain("Supplier offers");
    expect(source).not.toContain("No supplier offers found.");
  });

  it("keeps custom supplier creation in one expandable section above archived suppliers", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    const addSectionMountIndex = source.indexOf("<AddNewSupplierSection supplierEntries={supplierEntries} costConfidences={costConfidences} />");
    const archivedSectionIndex = source.indexOf("Archived Suppliers");
    expect(addSectionMountIndex).toBeGreaterThanOrEqual(0);
    expect(archivedSectionIndex).toBeGreaterThan(addSectionMountIndex);
    expect(source).not.toContain('form={formId} name="customSupplierName"');

    const addSectionStart = source.indexOf("function AddNewSupplierSection");
    const nextComponentStart = source.indexOf("function SupplierAdditionalContactDetails");
    expect(addSectionStart).toBeGreaterThanOrEqual(0);
    expect(nextComponentStart).toBeGreaterThan(addSectionStart);
    const addSectionSource = source.slice(addSectionStart, nextComponentStart);

    expect(addSectionSource).toContain("<summary");
    expect(addSectionSource).toContain("Add New Supplier");
    expect(addSectionSource).toContain('name="itemId"');
    expect(addSectionSource).toContain('name="customSupplierName"');
    expect(addSectionSource).toContain('name="supplierSku"');
    expect(addSectionSource).toContain('name="estimatedUnitCost"');
    expect(addSectionSource).toContain('name="costConfidence"');
    expect(addSectionSource).toContain('name="costSourceRef"');
    expect(addSectionSource).toContain("ItemSelectOptions");
    expect(addSectionSource).toContain("category: entry.category");
  });
});
