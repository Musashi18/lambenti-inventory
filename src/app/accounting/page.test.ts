import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Accounting workbench page", () => {
  it("exposes document drag/drop analysis and serious accounting guardrails", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");
    const dropzoneSource = readFileSync(join(__dirname, "accounting-document-dropzone.tsx"), "utf8");

    expect(pageSource).toContain("Accounting workbench");
    expect(pageSource).toContain("Accounting documents do not receive stock");
    expect(pageSource).toContain("Canadian GST/HST and audit-ready records");
    expect(pageSource).toContain("source document");
    expect(pageSource).toContain("applyAccountingDocumentAction");
    expect(pageSource).toContain("attachAccountingDocumentEvidenceAction");
    expect(pageSource).toContain("Attach as evidence");
    expect(pageSource).toContain("Attach only — does not receive stock or mark paid.");
    expect(pageSource).toContain("Customer invoices / AR");
    expect(pageSource).toContain("GL mapping");
    expect(pageSource).toContain("Posted journals");
    expect(pageSource).toContain("/accounting/journals");
    expect(pageSource).toContain("Payment reconciliation");
    expect(pageSource).toContain("Attention queue");
    expect(pageSource).toContain("Source document triage");
    expect(pageSource).toContain("Ready to apply");
    expect(pageSource).toContain("Needs manual review");
    expect(pageSource).toContain("Upload → review → apply/attach → approve/pay → post/export");
    expect(pageSource).toContain("data-testid=\"accounting-document-status");
    expect(pageSource).toContain("retryAccountingDocumentExtractionAction");
    expect(pageSource).toContain("deleteAccountingDocumentAction");
    expect(pageSource).toContain("Delete source document");
    expect(pageSource).toContain("This permanently removes the saved file and analysis row");
    expect(pageSource).toContain("Paste extracted text / OCR and re-analyze");
    expect(pageSource).toContain("Save text & analyze");
    expect(dropzoneSource).toContain("onDrop");
    expect(dropzoneSource).toContain("useRouter");
    expect(dropzoneSource).toContain("router.refresh()");
    expect(dropzoneSource).toContain("Upload & analyze");
  });
});
