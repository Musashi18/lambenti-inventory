import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = dirname(fileURLToPath(import.meta.url));

function readAppFile(relativePath: string) {
  return readFileSync(join(appDir, relativePath), "utf8");
}

describe("app-wide refresh contract for information-changing buttons", () => {
  it("provides a reusable client form that refreshes the route after server actions finish", () => {
    const source = readAppFile("refreshing-action-form.tsx");

    expect(source).toContain("useRouter");
    expect(source).toContain("router.refresh()");
    expect(source).toContain("window.location.reload()");
    expect(source).toContain("onSubmit");
    expect(source).toContain("finally");
    expect(source).toContain("aria-busy");
  });

  it("uses the refreshing form for server-action buttons that mutate or fetch displayed data", () => {
    const pages = [
      "integrations/alibaba-email/page.tsx",
      "suppliers/page.tsx",
      "purchasing/requests/page.tsx",
      "accounting/invoices/page.tsx"
    ];

    for (const page of pages) {
      const source = readAppFile(page);
      expect(source, page).toContain("RefreshingActionForm");
      expect(source, page).not.toMatch(/<form\s+[^>]*action=\{[A-Za-z0-9_]+Action\}/);
    }
  });

  it("refreshes client action-state forms after successful creates/imports/movements", () => {
    const clientForms = [
      "inventory/items/item-create-form.tsx",
      "inventory/items/item-import-export-panel.tsx",
      "inventory/movements/movement-form.tsx",
      "inventory/movements/void-movement-button.tsx"
    ];

    for (const file of clientForms) {
      const source = readAppFile(file);
      expect(source, file).toContain("useRouter");
      expect(source, file).toContain("router.refresh()");
      expect(source, file).toContain("window.location.reload()");
    }
  });

  it("hard-reloads existing client mutation and external-fetch controls after success", () => {
    const clientControls = [
      "automation/automation-scan-controls.tsx",
      "boms/bom-builder.tsx",
      "inventory/items/items-catalog.tsx",
      "integrations/alibaba-email/mailbox-sync-button.tsx"
    ];

    for (const file of clientControls) {
      const source = readAppFile(file);
      expect(source, file).toContain("router.refresh()");
      expect(source, file).toContain("window.location.reload()");
    }
  });
});
