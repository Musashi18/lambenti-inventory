import { describe, expect, it } from "vitest";
import {
  buildPortalMessageId,
  extractConversationContext,
  extractOrderId,
  extractPortalEvidenceDate,
  extractSupplierName,
  extractTrackingNumbers,
  hasShippingTrackingMessageContext,
  isSafeAlibabaPortalCandidateText,
  isRecentPortalEvidence,
  looksRelevant
} from "./alibaba-portal-extraction.mjs";

describe("Alibaba portal extraction helpers", () => {
  it("extracts explicit Alibaba order IDs without mistaking tracking-only text for an order", () => {
    expect(extractOrderId("Trade Assurance Order no. 304447618001023166\nSupplier: Mark Tang")).toBe("304447618001023166");
    expect(extractOrderId("https://biz.alibaba.com/order/detail.htm?orderId=303671327001023166")).toBe("303671327001023166");
    expect(extractOrderId("Carrier UPS\nTracking Number: 1Z999AA10123456784\nShipment picked up")).toBeUndefined();
  });

  it("extracts tracking numbers from labels, carrier-context lines, and Chinese waybill text", () => {
    const text = [
      "Tracking Number: UPS 1Z999AA10123456784",
      "Carrier: FedEx 777777777777",
      "物流 运单号 YT1234567890123456",
      "Order Number: 304447618001023166"
    ].join("\n");

    expect(extractTrackingNumbers(text)).toEqual([
      "UPS 1Z999AA10123456784",
      "FedEx 777777777777",
      "YT1234567890123456"
    ]);
  });

  it("does not mistake message-composer logistics UI for a tracking number", () => {
    expect(extractTrackingNumbers('Logistics Inquiry Press "Enter" to send Send')).toEqual([]);
    expect(extractTrackingNumbers("Tracking Number as soon as the logistics company provides it to me")).toEqual([]);
    expect(extractTrackingNumbers("Logistics update: Tracking Number 888071620741 is active.")).toEqual(["888071620741"]);
  });

  it("builds stable distinct message IDs for message threads that do not expose order IDs", () => {
    const first = buildPortalMessageId({ sourceUrl: "https://message.alibaba.com/", text: "Supplier A says your shipment is ready." });
    const repeat = buildPortalMessageId({ sourceUrl: "https://message.alibaba.com/", text: "Supplier A says your shipment is ready." });
    const second = buildPortalMessageId({ sourceUrl: "https://message.alibaba.com/", text: "Supplier B sent tracking number 1Z999AA10123456784." });

    expect(first).toBe(repeat);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^<alibaba-portal:message:[a-f0-9]{16}>$/);
    expect(buildPortalMessageId({ orderId: "304447618001023166", sourceUrl: "https://message.alibaba.com/", text: "anything" })).toBe("<alibaba-portal:304447618001023166>");
  });

  it("keeps autonomous navigation to read-only evidence links and blocks side-effect buttons", () => {
    expect(isSafeAlibabaPortalCandidateText("View order details", "detail")).toBe(true);
    expect(isSafeAlibabaPortalCandidateText("Open message thread", "detail")).toBe(true);
    expect(isSafeAlibabaPortalCandidateText("Open message thread", "trackingDetail")).toBe(false);
    expect(isSafeAlibabaPortalCandidateText("Track package", "trackingDetail")).toBe(true);
    expect(isSafeAlibabaPortalCandidateText("Message conversation history", "detail")).toBe(true);
    expect(isSafeAlibabaPortalCandidateText("Logistics details / tracking", "detail")).toBe(true);
    expect(isSafeAlibabaPortalCandidateText("Download commercial invoice PDF", "invoice")).toBe(true);

    expect(isSafeAlibabaPortalCandidateText("Pay now", "detail")).toBe(false);
    expect(isSafeAlibabaPortalCandidateText("Confirm receipt", "detail")).toBe(false);
    expect(isSafeAlibabaPortalCandidateText("Release payment", "detail")).toBe(false);
    expect(isSafeAlibabaPortalCandidateText("Send message", "detail")).toBe(false);
    expect(isSafeAlibabaPortalCandidateText("Reply to supplier", "detail")).toBe(false);
    expect(isSafeAlibabaPortalCandidateText("Send inquiry", "detail")).toBe(false);
    expect(isSafeAlibabaPortalCandidateText("Chat now", "detail")).toBe(false);
    expect(isSafeAlibabaPortalCandidateText("Delete order", "detail")).toBe(false);
  });

  it("identifies recent completed/shipment evidence and excludes portal tracking evidence older than three months", () => {
    const now = new Date("2026-06-14T12:00:00.000Z");
    const recent = "Status: Completed\nOrder date: 2026-05-01\nTracking Number: LL270153423CN";
    const old = "Status: Completed\nOrder date: 2026-01-10\nTracking Number: LL270153423CN";

    expect(extractPortalEvidenceDate(recent)?.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(isRecentPortalEvidence(recent, { now, months: 3 })).toBe(true);
    expect(isRecentPortalEvidence(old, { now, months: 3 })).toBe(false);
  });

  it("extracts shipment-relevant message conversation context without retaining composer/send UI text", () => {
    const context = extractConversationContext(`
      Message Center
      Type a message to the supplier
      Send
      Supplier: Winnie XU
      Order Number: 304716450001023166
      May 31, 2026 Supplier: Your order has shipped, ETA Jun 15.
      Logistics update: Tracking Number 888071620741 is active.
      Thanks for your order.
      Reply to supplier
    `);

    expect(context).toContain("Order Number: 304716450001023166");
    expect(context).toContain("Your order has shipped, ETA Jun 15");
    expect(context).toContain("Tracking Number 888071620741");
    expect(context).not.toMatch(/Type a message|^Send$|Reply to supplier/i);
  });

  it("treats only shipping/tracking-related message sections as capture-worthy", () => {
    expect(hasShippingTrackingMessageContext("Winnie XU: Will ship out your order soon. Tracking Number 888071620741 will follow.")).toBe(true);
    expect(hasShippingTrackingMessageContext("Logistics update: package delivered to Toronto hub.")).toBe(true);
    expect(hasShippingTrackingMessageContext("Glad to assist! Please check the product catalog when you have time.")).toBe(false);

    const context = extractConversationContext(`
      Message section — Vivian Yu
      Glad to assist with your sample quote.
      Message section — Mark Tang
      Supplier: Mark Tang
      Order Number: 304447618001023166
      Will ship out your order soon.
      Type a message
      Send
    `);

    expect(context).toContain("Supplier: Mark Tang");
    expect(context).toContain("Order Number: 304447618001023166");
    expect(context).toContain("Will ship out your order soon.");
    expect(context).not.toContain("Glad to assist with your sample quote");
    expect(context).not.toMatch(/Type a message|^Send$/i);
  });

  it("recognizes order/message/logistics pages as relevant evidence", () => {
    expect(looksRelevant("Alibaba message from supplier with shipment tracking number 1Z999AA10123456784")).toBe(true);
    expect(looksRelevant("Unread notifications only, generic account updates")).toBe(false);
  });

  it("extracts supplier names conservatively from common portal labels", () => {
    expect(extractSupplierName("Supplier: Mark Tang\nOrder Number: 304447618001023166")).toBe("Mark Tang");
    expect(extractSupplierName("Seller - Shenzhen Example Lighting Co., Ltd.\nTotal USD 50.00")).toBe("Shenzhen Example Lighting Co., Ltd.");
  });
});
