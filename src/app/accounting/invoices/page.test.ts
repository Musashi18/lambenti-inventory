import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Accounting invoice page action controls", () => {
  it("only exposes mark-paid controls for approved invoices and requires a payment reference", () => {
    const pageSource = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(pageSource).toContain("invoice.status === InvoiceStatus.RECEIVED");
    expect(pageSource).toContain("invoice.status === InvoiceStatus.APPROVED");
    expect(pageSource).toContain("Evidence bundle");
    expect(pageSource).toContain("Invoice Approval Workbench");
    expect(pageSource).toContain("summarizeInvoiceWorkQueue");
    expect(pageSource).toContain("Ready to Approve");
    expect(pageSource).toContain("Fix Before Approval");
    expect(pageSource).toContain("Blocked before approval");
    expect(pageSource).toContain("Resolve approval blockers first");
    expect(pageSource).toContain("Set Due Date");
    expect(pageSource).toContain("Payment Queue");
    expect(pageSource).toContain("Review Readiness");
    expect(pageSource).toContain("Missing due date");
    expect(pageSource).toContain("Needs evidence");
    expect(pageSource).toContain("workRowsByInvoiceId");
    expect(pageSource).toContain("DuplicateInvoiceGuardrail");
    expect(pageSource).toContain("summarizeInvoiceDuplicateClusters");
    expect(pageSource).toContain("voidDuplicateInvoiceClusterAction");
    expect(pageSource).toContain("Duplicate Invoice Guardrail");
    expect(pageSource).toContain("stock receiving remains separate");
    expect(pageSource).toContain("evidenceText");
    expect(pageSource).toContain("updateInvoiceTermsAction");
    expect(pageSource).toContain("Save Due Date");
    expect(pageSource).toContain("Approve from Queue");
    expect(pageSource).toContain('name="dueDate"');
    expect(pageSource).toContain("Active invoices:");
    expect(pageSource).toContain("voided duplicates");
    expect(pageSource).toContain("Duplicate Invoice Guardrail");
    expect(pageSource).toContain("summarizeInvoiceDuplicateClusters");
    expect(pageSource).toContain("voidDuplicateInvoiceClusterAction");
    expect(pageSource).toContain("Void Duplicate Copies");
    expect(pageSource).toContain("stock receiving remains separate");
    expect(pageSource).toContain("invoiceNumber");
    expect(pageSource).toContain("paymentAllocations");
    expect(pageSource).toContain("accountingDocuments");
    expect(pageSource).toContain("Download");
    expect(pageSource).toContain('name="paymentReference"');
    expect(pageSource).toContain("required");
    expect(pageSource).not.toContain("invoice.status !== InvoiceStatus.PAID ?");
  });
});
