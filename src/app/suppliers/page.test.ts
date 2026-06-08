import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Suppliers page source contract", () => {
  it("merges supplier contacts into the suppliers section with display-first edit controls", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain("getItemSupplierEntries");
    expect(source).toContain("getUniqueSupplierProfiles");
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
    expect(source).toContain("Edit dropdown confirmation");
    expect(source).toContain("archiveSupplierAction");
    expect(source).toContain("deleteArchivedSupplierAction");
    expect(source).toContain("Archive supplier");
    expect(source).toContain("Archived suppliers");
    expect(source).toContain("Delete archived supplier");
    expect(source).toContain("Unarchive supplier");
    expect(source).toContain("ArchiveSupplierControl");
    expect(source).toContain("inline-block max-w-full");
    expect(source).toContain("inline-flex w-fit");
    expect(source).toContain("text-[10px]");
    expect(source).toContain("px-1.5");
    expect(source).toContain("Clean item type");
    expect(source).toContain("Unit price (USD)");
    expect(source).toContain("Confirmed supplier for item dropdown");
    expect(source).not.toContain("Supplier contact profiles");
    expect(source).not.toContain("Supplier offers");
    expect(source).not.toContain("No supplier offers found.");
  });
});
