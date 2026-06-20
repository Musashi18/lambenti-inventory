import { describe, expect, it } from "vitest";
import { extractAccountingDocumentText } from "./extract";

describe("accounting document extraction", () => {
  it("extracts embedded text from uploaded PDF invoice contents", async () => {
    const result = await extractAccountingDocumentText({
      buffer: Buffer.from(textPdf("Supplier Invoice INV-42 Total USD 12.00")),
      mimeType: "application/pdf",
      originalFileName: "supplier-invoice.pdf"
    });

    expect(result.text).toContain("Supplier Invoice INV-42");
    expect(result.text).toContain("Total USD 12.00");
  });

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



  it("OCRs directly embedded PDF image streams before requiring pdftoppm", async () => {
    const result = await extractAccountingDocumentText(
      {
        buffer: Buffer.from(fakeImageOnlyPdf(), "latin1"),
        mimeType: "application/pdf",
        originalFileName: "embedded-scan.pdf"
      },
      {
        pdfTextExtractor: async () => undefined,
        recognizeImageText: async ({ content, contentType, filename }) => {
          expect(contentType).toBe("image/jpeg");
          expect(filename).toBe("embedded-scan-embedded-image-1.jpg");
          expect(content.toString("latin1")).toContain("FAKE-JPEG-INVOICE");
          return "Supplier invoice from embedded scan Total USD 24.00";
        }
      }
    );

    expect(result.text).toContain("Supplier invoice from embedded scan");
    expect(result.warnings.join(" ")).not.toContain("pdftoppm");
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

function textPdf(text: string) {
  return `%PDF-1.1
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length ${text.length + 34} >>
stream
BT /F1 24 Tf 100 700 Td (${text}) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000241 00000 n
0000000311 00000 n
trailer
<< /Root 1 0 R /Size 6 >>
startxref
417
%%EOF`;
}

function fakeImageOnlyPdf() {
  const image = "FAKE-JPEG-INVOICE-BYTES";
  return `%PDF-1.4
1 0 obj
<< /Type /XObject /Subtype /Image /Width 100 /Height 40 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>
stream
${image}
endstream
endobj
%%EOF`;
}
