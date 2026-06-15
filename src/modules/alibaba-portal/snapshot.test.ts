import { describe, expect, it } from "vitest";
import { parseAlibabaEmail } from "../email-imports/alibaba-email";
import { extractPortalInvoiceMetadata, portalSnapshotToImportText } from "./snapshot";

describe("Alibaba portal snapshots", () => {
  it("combines portal message text and downloaded invoice text into one importable order document", () => {
    const rawText = portalSnapshotToImportText({
      sourceUrl: "https://biz.alibaba.com/order/detail.htm?orderId=304447618001023166",
      capturedAt: "2026-06-06T12:00:00.000Z",
      supplierName: "Mark Tang",
      trackingNumbers: ["UPS 1Z999AA10123456784"],
      text: `
        Trade Assurance Order no. 304447618001023166
        Supplier: Mark Tang
        Order date 2026-06-05 19:22:59 PST
        Product and delivery information Stock Wholesale Back to Back Hook and Loop Strap Fastener Cable Organizer Colorful Reusable Cable Ties
        Quantity: 1000
        Item subtotal: USD 15.00
        Shipping fee USD 36.50
        Total USD 51.50
      `,
      invoiceDocuments: [
        {
          fileName: "invoice-304447618001023166.pdf",
          localPath: "var/alibaba-invoices/invoice-304447618001023166.pdf",
          sourceUrl: "https://biz.alibaba.com/invoice/304447618001023166.pdf",
          sha256: "abc123",
          text: `
            Commercial Invoice
            Invoice No: INV-304447618001023166
            Order Number: 304447618001023166
            Seller: Mark Tang
            Description: Stock Wholesale Back to Back Hook and Loop Strap Fastener Cable Organizer Colorful Reusable Cable Ties
            Qty: 1000
            Unit Price: USD 0.015
            Line Total: USD 15.00
            Shipping: USD 36.50
            Grand Total: USD 51.50
          `
        }
      ]
    });

    expect(rawText).toContain("Source: Alibaba portal");
    expect(rawText).toContain("Invoice No: INV-304447618001023166");
    expect(rawText).toContain("Tracking Number: UPS 1Z999AA10123456784");
    expect(rawText).toContain("Local invoice path: var/alibaba-invoices/invoice-304447618001023166.pdf");

    const parsed = parseAlibabaEmail(rawText);
    expect(parsed.externalOrderId).toBe("304447618001023166");
    expect(parsed.supplierName).toBe("Mark Tang");
    expect(parsed.totalCost).toBe(51.5);
    expect(parsed.shippingCost).toBe(36.5);
    expect(parsed.lines[0]).toMatchObject({
      quantity: 1000,
      unitPrice: 0.015,
      lineTotal: 15,
      landedUnitCost: 0.0515
    });
  });

  it("extracts invoice number and source-document provenance from portal invoice text", () => {
    const metadata = extractPortalInvoiceMetadata({
      sourceUrl: "https://biz.alibaba.com/invoice/download?id=INV-42",
      localPath: "var/alibaba-invoices/INV-42.pdf",
      sha256: "deadbeef",
      text: "Commercial Invoice\nInvoice Number: INV-42\nOrder Number: 987654321\nGrand Total USD 84.94"
    });

    expect(metadata).toEqual({
      invoiceNumber: "INV-42",
      sourceDocumentPath: "var/alibaba-invoices/INV-42.pdf",
      sourceDocumentHash: "deadbeef",
      externalSourceUrl: "https://biz.alibaba.com/invoice/download?id=INV-42"
    });
  });

  it("persists extracted message-conversation context in the importable portal evidence text", () => {
    const rawText = portalSnapshotToImportText({
      sourceUrl: "https://message.alibaba.com/thread?orderId=304716450001023166",
      capturedAt: "2026-06-14T12:00:00.000Z",
      orderId: "304716450001023166",
      orderStatus: "Completed",
      orderDate: "2026-05-31T00:00:00.000Z",
      subject: "Alibaba portal message conversation",
      conversationContext: [
        "Supplier: Winnie XU",
        "Order Number: 304716450001023166",
        "Supplier confirmed this completed order shipped.",
        "Tracking Number: 888071620741"
      ].join("\n"),
      text: "Full message thread text with product chatter and tracking number 888071620741."
    });

    expect(rawText).toContain("Order Status: Completed");
    expect(rawText).toContain("Order Date: 2026-05-31T00:00:00.000Z");
    expect(rawText).toContain("Conversation context:");
    expect(rawText).toContain("Supplier confirmed this completed order shipped.");
    expect(rawText).toContain("Tracking Number: 888071620741");
  });
});
