import { afterEach, describe, expect, it } from "vitest";
import { parseAlibabaEmail } from "./alibaba-email";
import { getAlibabaMailboxConfigStatus, isSupplierOrderEmailText, sourceToImportTexts } from "./mailbox";

const originalMarkSeen = process.env.LAMBENTI_EMAIL_MARK_IMPORTED_SEEN;

afterEach(() => {
  if (originalMarkSeen === undefined) {
    delete process.env.LAMBENTI_EMAIL_MARK_IMPORTED_SEEN;
  } else {
    process.env.LAMBENTI_EMAIL_MARK_IMPORTED_SEEN = originalMarkSeen;
  }
});

describe("mailbox order relevance", () => {
  it("accepts non-Alibaba supplier order emails and rejects login/security codes", () => {
    expect(isSupplierOrderEmailText(`
Subject: Order confirmation #ACME-42
From: sales@example-components.com
Supplier: Example Components Ltd.
Order ID: ACME-42
Product: LED-COB-12V-3000K qty 20 unit price USD 1.10 total USD 22.00
Shipping: USD 5.00
Total: USD 27.00
`)).toBe(true);

    expect(isSupplierOrderEmailText(`
Subject: Your sign-in security code
From: security@example-components.com
Security code: 123456
This code expires in 10 minutes.
`)).toBe(false);
  });
});

describe("mailbox configuration", () => {
  it("does not mark imported mailbox messages seen unless explicitly enabled", () => {
    delete process.env.LAMBENTI_EMAIL_MARK_IMPORTED_SEEN;
    expect(getAlibabaMailboxConfigStatus().markSeen).toBe(false);

    process.env.LAMBENTI_EMAIL_MARK_IMPORTED_SEEN = "true";
    expect(getAlibabaMailboxConfigStatus().markSeen).toBe(true);
  });
});

describe("mailbox email extraction", () => {
  it("extracts forwarded Alibaba emails attached as .eml files", async () => {
    const attachedEmail = [
      "Subject: Alibaba order confirmation",
      "From: supplier@notice.alibaba.com",
      "Message-ID: <attached-order@example.com>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Order ID: 123456789",
      "Supplier: Shenzhen LED Supplier Co., Ltd.",
      "Product: LED-COB-12V-3000K qty 100 unit price USD 0.86 total USD 86.00",
      "Shipping: USD 20.00",
      "Total: USD 106.00"
    ].join("\r\n");

    const wrapperEmail = [
      "Subject: Fwd: Alibaba order emails",
      "From: team@lambenti.com",
      "MIME-Version: 1.0",
      "Content-Type: multipart/mixed; boundary=mail-boundary",
      "",
      "--mail-boundary",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Forwarding the Alibaba order as an attachment.",
      "--mail-boundary",
      "Content-Type: message/rfc822; name=alibaba-order.eml",
      "Content-Disposition: attachment; filename=alibaba-order.eml",
      "",
      attachedEmail,
      "--mail-boundary--",
      ""
    ].join("\r\n");

    const texts = await sourceToImportTexts(Buffer.from(wrapperEmail, "utf8"));

    expect(texts.some((text) => text.includes("Order ID: 123456789"))).toBe(true);
    expect(texts.some((text) => text.includes("LED-COB-12V-3000K"))).toBe(true);
  });

  it("runs OCR against image attachments and includes recognized order text", async () => {
    const imagePayload = Buffer.from("fake png bytes for mocked OCR");
    const wrapperEmail = [
      "Subject: Alibaba invoice image",
      "From: supplier@notice.alibaba.com",
      "MIME-Version: 1.0",
      "Content-Type: multipart/mixed; boundary=image-boundary",
      "",
      "--image-boundary",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Invoice is attached as an image.",
      "--image-boundary",
      "Content-Type: image/png; name=invoice.png",
      "Content-Disposition: attachment; filename=invoice.png",
      "Content-Transfer-Encoding: base64",
      "",
      imagePayload.toString("base64"),
      "--image-boundary--",
      ""
    ].join("\r\n");

    const texts = await sourceToImportTexts(Buffer.from(wrapperEmail, "utf8"), {
      ocrImageText: async ({ content, contentType, filename }) => {
        expect(content.equals(imagePayload)).toBe(true);
        expect(contentType).toBe("image/png");
        expect(filename).toBe("invoice.png");
        return "Order ID: IMG-42\nSupplier: OCR Components Ltd.\nProduct: MMC5603NJ qty 30 unit price USD 1.20 total USD 36.00";
      }
    });

    expect(texts.some((text) => text.includes("Order ID: IMG-42"))).toBe(true);
    expect(texts.some((text) => text.includes("MMC5603NJ"))).toBe(true);
  });

  it("keeps multiple OCR image attachments together so one graphical email becomes one multi-item import", async () => {
    const warmImage = Buffer.from("warm image bytes");
    const coolImage = Buffer.from("cool image bytes");
    const wrapperEmail = [
      "Subject: Visual supplier receipt #VIS-IMG-42",
      "From: visual@example.com",
      "MIME-Version: 1.0",
      "Content-Type: multipart/mixed; boundary=multi-image-boundary",
      "",
      "--multi-image-boundary",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Order #VIS-IMG-42",
      "Seller: Visual Supplier Factory",
      "Order total USD 51.00",
      "--multi-image-boundary",
      "Content-Type: image/jpeg; name=led-cob-strip-3000k-warm.jpg",
      "Content-Disposition: attachment; filename=led-cob-strip-3000k-warm.jpg",
      "Content-Transfer-Encoding: base64",
      "",
      warmImage.toString("base64"),
      "--multi-image-boundary",
      "Content-Type: image/jpeg; name=led-cob-strip-6500k-cool.jpg",
      "Content-Disposition: attachment; filename=led-cob-strip-6500k-cool.jpg",
      "Content-Transfer-Encoding: base64",
      "",
      coolImage.toString("base64"),
      "--multi-image-boundary--",
      ""
    ].join("\r\n");

    const texts = await sourceToImportTexts(Buffer.from(wrapperEmail, "utf8"), {
      ocrImageText: async ({ content, filename }) => {
        if (content.equals(warmImage)) {
          expect(filename).toBe("led-cob-strip-3000k-warm.jpg");
          return "COB LED strip\nQty\n10\nUnit price\nUSD 2.50\nLine total\nUSD 25.00";
        }
        expect(content.equals(coolImage)).toBe(true);
        expect(filename).toBe("led-cob-strip-6500k-cool.jpg");
        return "COB LED strip\nQty\n8\nUnit price\nUSD 2.75\nLine total\nUSD 22.00";
      }
    });

    const combined = texts.find((text) => text.includes("led-cob-strip-3000k-warm.jpg") && text.includes("led-cob-strip-6500k-cool.jpg"));
    expect(combined).toBeTruthy();
    const parsed = parseAlibabaEmail(combined!);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.rawDescription)).toEqual([
      "Receipt — COB LED strip - image led cob strip 3000k warm",
      "Receipt — COB LED strip - image led cob strip 6500k cool"
    ]);
  });

});
