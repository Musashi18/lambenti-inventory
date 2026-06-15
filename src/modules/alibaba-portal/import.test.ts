import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/email-imports/alibaba-email", () => ({
  importAlibabaEmailOrder: vi.fn(async () => ({
    created: true,
    import: { id: "email-import-1", status: "IMPORTED" },
    purchaseOrder: null
  }))
}));

vi.mock("@/modules/accounting/invoices", () => ({
  createInvoiceFromPurchaseOrder: vi.fn()
}));

vi.mock("@/modules/tracking/service", () => ({
  captureTrackingNumbersFromPortalSnapshot: vi.fn(async () => ({ saved: 1, updated: 0, skipped: 0, records: [] }))
}));

import { importAlibabaPortalSnapshot } from "./import";
import { captureTrackingNumbersFromPortalSnapshot } from "@/modules/tracking/service";

describe("Alibaba portal import tracking capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs tracking capture for portal snapshots whose text contains a tracking number even when no parsed trackingNumbers array is present", async () => {
    const result = await importAlibabaPortalSnapshot({
      actorId: "portal-agent",
      autoApply: false,
      autoCreateInvoice: false,
      snapshot: {
        sourceUrl: "https://biz.alibaba.com/order/detail.htm?orderId=304716450001023166",
        orderId: "304716450001023166",
        supplierName: "Huizhou Shengye Electronics Co., Ltd",
        capturedAt: "2026-06-14T02:00:00.000Z",
        text: "Trade Assurance logistics details for order 304716450001023166. Tracking no. 888071620741 has shipment events."
      }
    });

    expect(captureTrackingNumbersFromPortalSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "portal-agent",
      emailOrderImportId: "email-import-1",
      snapshot: expect.objectContaining({ orderId: "304716450001023166" })
    }));
    expect(result.tracking).toMatchObject({ saved: 1, updated: 0, skipped: 0 });
  });
});
