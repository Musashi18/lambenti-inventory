import { describe, expect, it } from "vitest";
import { extractAccountingDocumentText } from "./extract";

describe("accounting document extraction", () => {
  it("falls back to OCR on rendered PDF pages when a PDF has no embedded text", async () => {
    const result = await extractAccountingDocumentText(
      {
        buffer: Buffer.from("%PDF-1.3 image-only test"),
        mimeType: "application/pdf",
        originalFileName: "scanned-invoice.pdf"
      },
      {
        pdfTextExtractor: async () => undefined,
        pdfPageImageExtractor: async () => [
          { content: Buffer.from("page-one"), contentType: "image/png", filename: "scanned-invoice-page-1.png" },
          { content: Buffer.from("page-two"), contentType: "image/png", filename: "scanned-invoice-page-2.png" }
        ],
        recognizeImageText: async ({ filename }) => filename.endsWith("1.png")
          ? "Supplier invoice INV-42\nSupplier: OCR Widgets Inc."
          : "Subtotal USD 10.00\nShipping USD 2.00\nTotal USD 12.00"
      }
    );

    expect(result.text).toContain("Supplier invoice INV-42");
    expect(result.text).toContain("Total USD 12.00");
    expect(result.warnings).toContain("PDF had no embedded text; OCR was used on rendered page images. Review extracted fields carefully.");
  });

  it("returns a manual-review warning when neither PDF text nor OCR is available", async () => {
    const result = await extractAccountingDocumentText(
      {
        buffer: Buffer.from("%PDF-1.3 image-only test"),
        mimeType: "application/pdf",
        originalFileName: "unreadable.pdf"
      },
      {
        pdfTextExtractor: async () => undefined,
        pdfPageImageExtractor: async () => [],
        recognizeImageText: async () => null
      }
    );

    expect(result.text).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("Paste extracted text manually");
  });
});
