import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Order email import page source contract", () => {
  it("collapses manual email import by default and refreshes immediately after mailbox sync", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const syncButtonSource = readFileSync(join(__dirname, "mailbox-sync-button.tsx"), "utf8");

    expect(pageSource).toContain("MailboxSyncButton");
    expect(pageSource).toContain("ReassessRecentImportsButton");
    expect(pageSource).toContain("<details");
    expect(pageSource).not.toContain("<details open");
    expect(syncButtonSource).toContain("useRouter");
    expect(syncButtonSource).toContain("router.refresh()");
    expect(syncButtonSource).toContain("animate-spin");
    expect(syncButtonSource).toContain("describeReassessResult");
    expect(pageSource).not.toContain("disabled={imports.length === 0}");
  });

  it("labels synced/manual CSV sources and exposes archived unarchive/delete controls with confirmation", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const actionsSource = readFileSync(join(__dirname, "actions.ts"), "utf8");
    const refreshingFormSource = readFileSync(join(__dirname, "..", "..", "refreshing-action-form.tsx"), "utf8");

    expect(pageSource).toContain("displayEmailImportSource");
    expect(pageSource).toContain("SYNCED_EMAIL");
    expect(pageSource).toContain("MANUAL_CSV_IMPORT");
    expect(pageSource).toContain("unarchiveAlibabaEmailImportAction");
    expect(pageSource).toContain("deleteArchivedAlibabaEmailImportAction");
    expect(pageSource).toContain("Permanently delete archived email");
    expect(actionsSource).toContain("unarchiveEmailOrderImport");
    expect(actionsSource).toContain("deleteArchivedEmailOrderImport");
    expect(refreshingFormSource).toContain("confirmMessage");
    expect(refreshingFormSource).toContain("window.confirm");
  });
});
