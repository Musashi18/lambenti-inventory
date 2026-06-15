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
    expect(pageSource).toContain("Existing invoices:");
    expect(pageSource).toContain("invoiceNumber");
    expect(pageSource).toContain("paymentAllocations");
    expect(pageSource).toContain("accountingDocuments");
    expect(pageSource).toContain("Download");
    expect(pageSource).toContain('name="paymentReference"');
    expect(pageSource).toContain("required");
    expect(pageSource).not.toContain("invoice.status !== InvoiceStatus.PAID ?");
  });
});
