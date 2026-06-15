import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCategory, PurchaseOrderStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  captureTrackingNumbersFromImports,
  captureTrackingNumbersFromPortalSnapshot,
  extractTrackingNumbersFromText,
  getTrackingDashboard,
  normalizeTrackingNumber,
  pruneOldAlibabaTrackingNumbers,
  refreshDueTrackingNumbers,
  refreshTrackingNumber
} from "./service";

const TEST_PREFIX = "TEST-TRACKING";

async function cleanupTestData() {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
  await prisma.trackingEvent.deleteMany({
    where: {
      trackingNumber: {
        OR: [
          { trackingNumber: { startsWith: TEST_PREFIX } },
          { externalOrderId: { startsWith: TEST_PREFIX } },
          { sourceUrl: { contains: TEST_PREFIX } }
        ]
      }
    }
  });
  await prisma.trackingNumber.deleteMany({
    where: {
      OR: [
        { trackingNumber: { startsWith: TEST_PREFIX } },
        { externalOrderId: { startsWith: TEST_PREFIX } },
        { sourceUrl: { contains: TEST_PREFIX } }
      ]
    }
  });
  await prisma.emailOrderLineImport.deleteMany({ where: { import: { externalOrderId: { startsWith: TEST_PREFIX } } } });
  await prisma.emailOrderImport.deleteMany({ where: { externalOrderId: { startsWith: TEST_PREFIX } } });

  const suppliers = await prisma.supplier.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const itemIds = items.map((item) => item.id);
  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
  }
  if (supplierIds.length > 0) await prisma.purchaseOrder.deleteMany({ where: { supplierId: { in: supplierIds } } });
  if (itemIds.length > 0) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  if (supplierIds.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
}

async function createOrderImportFixture(suffix = "ORDER") {
  const supplier = await prisma.supplier.create({
    data: { name: `${TEST_PREFIX}-${suffix}-SUPPLIER`, moq: 1, leadTimeDays: 7, shippingCost: 0, reliabilityScore: 0.9 }
  });
  const location = await prisma.storageLocation.create({
    data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `Tracking ${suffix}` }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `Tracking fixture ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 1,
      targetStock: 10,
      leadTimeDays: 7,
      storageLocationId: location.id,
      preferredSupplierId: supplier.id
    }
  });
  const order = await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      status: PurchaseOrderStatus.ORDERED,
      orderedAt: new Date("2026-06-10T00:00:00.000Z"),
      lines: { create: [{ itemId: item.id, quantity: 10, unitPrice: 1.25 }] }
    }
  });
  const externalOrderId = `${TEST_PREFIX}-${suffix}-304716450001023166`;
  const orderImport = await prisma.emailOrderImport.create({
    data: {
      source: "ALIBABA_PORTAL",
      sourceHash: `${TEST_PREFIX}-${suffix}-hash`,
      sourceMessageId: `<${TEST_PREFIX}-${suffix}>`,
      sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${externalOrderId}`,
      subject: `Alibaba portal order ${externalOrderId}`,
      rawText: `Order Number: ${externalOrderId}\nSupplier: ${supplier.name}\nTotal: USD 12.50`,
      externalOrderId,
      supplierName: supplier.name,
      supplierId: supplier.id,
      purchaseOrderId: order.id,
      status: "APPLIED",
      totalCost: 12.5,
      lines: {
        create: [{ lineNo: 1, rawDescription: item.description, quantity: 10, unitPrice: 1.25, lineTotal: 12.5, matchedItemId: item.id, matchConfidence: "MANUAL" }]
      }
    }
  });
  return { supplier, location, item, order, orderImport, externalOrderId };
}

describe("tracking service", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("normalizes tracking numbers without losing carrier prefixes", () => {
    expect(normalizeTrackingNumber(" ups 1z675ew60490310023 ")).toBe("UPS 1Z675EW60490310023");
    expect(normalizeTrackingNumber("ll270153423cn")).toBe("LL270153423CN");
  });

  it("extracts tracking numbers from shipment context without treating Alibaba order IDs or phone-like numbers as tracking", () => {
    const text = `
      Order Number: 13569030001023166
      Supplier phone: 18991984785
      Product code: 4379224229
      Tracking no.
      888071620741
      Logistics carrier update: LL270153423CN left Shenzhen.
    `;

    expect(extractTrackingNumbersFromText(text)).toEqual(["888071620741", "LL270153423CN"]);
  });

  it("captures Alibaba portal tracking numbers, links them to the matching purchase order, and stays idempotent without stock movement", async () => {
    const fixture = await createOrderImportFixture("PORTAL");
    const stockBefore = await prisma.stockMovement.count({ where: { itemId: fixture.item.id } });

    const first = await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        capturedAt: "2026-06-14T02:00:00.000Z",
        trackingNumbers: [" 888071620742 "],
        text: "Logistics details\nTracking no.\n888071620742\nDelivered"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const second = await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["888071620742"],
        text: "Repeat scan Tracking no. 888071620742"
      },
      actorId: `${TEST_PREFIX}-agent`
    });

    expect(first.saved).toBe(1);
    expect(second.saved).toBe(0);
    expect(second.updated).toBe(1);
    const trackingRows = await prisma.trackingNumber.findMany({ where: { trackingNumber: "888071620742" } });
    expect(trackingRows).toHaveLength(1);
    expect(trackingRows[0]).toMatchObject({
      source: "ALIBABA_PORTAL",
      externalOrderId: fixture.externalOrderId,
      purchaseOrderId: fixture.order.id,
      emailOrderImportId: fixture.orderImport.id,
      refreshStatus: "PENDING"
    });
    await expect(prisma.stockMovement.count({ where: { itemId: fixture.item.id } })).resolves.toBe(stockBefore);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-agent`, action: "CAPTURE_TRACKING_NUMBER" } })).resolves.toBeGreaterThanOrEqual(1);
  });

  it("links an existing manual tracking record without overwriting its manual source provenance", async () => {
    const fixture = await createOrderImportFixture("MANUAL");
    await prisma.trackingNumber.create({
      data: {
        trackingNumber: "1Z675EW60490310037",
        source: "MANUAL",
        sourceUrl: `${TEST_PREFIX}-manual-note`,
        refreshStatus: "PENDING"
      }
    });

    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        capturedAt: "2026-06-14T02:00:00.000Z",
        trackingNumbers: ["1Z675EW60490310037"],
        text: "Tracking Number: 1Z675EW60490310037"
      },
      actorId: `${TEST_PREFIX}-agent`
    });

    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310037" } })).resolves.toMatchObject({
      source: "MANUAL",
      sourceUrl: `${TEST_PREFIX}-manual-note`,
      externalOrderId: fixture.externalOrderId,
      purchaseOrderId: fixture.order.id,
      emailOrderImportId: fixture.orderImport.id
    });
  });

  it("does not resurrect refresh polling for an already delivered tracking record during capture backfill", async () => {
    const fixture = await createOrderImportFixture("DELIVERED-BACKFILL");
    await prisma.trackingNumber.create({
      data: {
        trackingNumber: "1Z675EW60490310040",
        source: "SYNCED_EMAIL",
        sourceUrl: `${TEST_PREFIX}-delivered-email`,
        currentStatus: "DELIVERED",
        deliveredAt: new Date("2026-06-14T03:00:00.000Z"),
        refreshStatus: "SUCCESS",
        nextRefreshAt: null
      }
    });

    const result = await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://message.alibaba.com/message/messenger.htm#${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        capturedAt: "2026-06-14T04:00:00.000Z",
        trackingNumbers: ["1Z675EW60490310040"],
        conversationContext: "Supplier confirmed the package was delivered. Tracking Number: 1Z675EW60490310040",
        text: "Status: Delivered\nOrder Date: 2026-06-10\nTracking Number: 1Z675EW60490310040"
      },
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T12:00:00.000Z")
    });

    expect(result.updated).toBe(1);
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310040" } })).resolves.toMatchObject({
      currentStatus: "DELIVERED",
      nextRefreshAt: null,
      externalOrderId: fixture.externalOrderId,
      purchaseOrderId: fixture.order.id,
      emailOrderImportId: fixture.orderImport.id
    });
  });

  it("does not save tracking numbers whose linked Alibaba order evidence is older than three months", async () => {
    const fixture = await createOrderImportFixture("OLD-CUTOFF");
    await prisma.emailOrderImport.update({
      where: { id: fixture.orderImport.id },
      data: { orderDate: new Date("2026-01-10T00:00:00.000Z") }
    });

    const result = await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        capturedAt: "2026-06-14T02:00:00.000Z",
        trackingNumbers: ["1Z675EW60490310038"],
        text: "Status: Completed\nOrder Date: 2026-01-10\nTracking Number: 1Z675EW60490310038"
      },
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T12:00:00.000Z"),
      recentMonths: 3
    });

    expect(result).toMatchObject({ saved: 0, updated: 0, skipped: 1 });
    await expect(prisma.trackingNumber.findUnique({ where: { trackingNumber: "1Z675EW60490310038" } })).resolves.toBeNull();
  });

  it("prunes previously saved Alibaba tracking rows whose linked order evidence is older than three months", async () => {
    const fixture = await createOrderImportFixture("PRUNE-OLD");
    await prisma.emailOrderImport.update({
      where: { id: fixture.orderImport.id },
      data: { orderDate: new Date("2026-01-10T00:00:00.000Z") }
    });
    await prisma.trackingNumber.create({
      data: {
        trackingNumber: "TEST-TRACKING-PRUNE-OLD",
        source: "ALIBABA_PORTAL",
        sourceUrl: `${TEST_PREFIX}-old-alibaba-portal`,
        externalOrderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        purchaseOrderId: fixture.order.id,
        emailOrderImportId: fixture.orderImport.id,
        refreshStatus: "PENDING"
      }
    });

    const result = await pruneOldAlibabaTrackingNumbers({
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T12:00:00.000Z"),
      recentMonths: 3,
      sourceUrlContains: `${TEST_PREFIX}-old-alibaba-portal`
    });

    expect(result).toMatchObject({ pruned: 1 });
    await expect(prisma.trackingNumber.findUnique({ where: { trackingNumber: "TEST-TRACKING-PRUNE-OLD" } })).resolves.toBeNull();
    await expect(prisma.auditLog.findFirst({
      where: { actorId: `${TEST_PREFIX}-agent`, action: "PRUNE_OLD_ALIBABA_TRACKING_NUMBER" }
    })).resolves.toMatchObject({ entityType: "TrackingNumber" });
  });

  it("links tracking numbers from recent completed Alibaba conversation context to an existing order", async () => {
    const fixture = await createOrderImportFixture("RECENT-COMPLETE");
    await prisma.emailOrderImport.update({
      where: { id: fixture.orderImport.id },
      data: { orderDate: new Date("2026-05-31T00:00:00.000Z") }
    });

    const result = await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://message.alibaba.com/thread?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        capturedAt: "2026-06-14T02:00:00.000Z",
        subject: "Alibaba portal message conversation",
        conversationContext: "Supplier confirmed this completed order shipped. Tracking Number: 1Z675EW60490310039",
        text: "Status: Completed\nOrder Date: 2026-05-31\nSupplier message: shipped. Tracking Number: 1Z675EW60490310039"
      },
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T12:00:00.000Z"),
      recentMonths: 3
    });

    expect(result.saved).toBe(1);
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310039" } })).resolves.toMatchObject({
      source: "ALIBABA_PORTAL",
      externalOrderId: fixture.externalOrderId,
      purchaseOrderId: fixture.order.id,
      emailOrderImportId: fixture.orderImport.id
    });
  });

  it("refreshes a tracking number from the configured tracking service and records checkpoint history", async () => {
    const fixture = await createOrderImportFixture("REFRESH");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["1Z675EW60490310033"],
        text: "Tracking Number: 1Z675EW60490310033"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      tracking_number: "1Z675EW60490310033",
      carrier: "UPS",
      status: "in_transit",
      statusDescription: "Arrived at Toronto hub",
      lastEventAt: "2026-06-14T01:30:00.000Z",
      events: [
        { status: "in_transit", description: "Arrived at Toronto hub", location: "Toronto, ON", occurredAt: "2026-06-14T01:30:00.000Z" }
      ]
    }), { status: 200 }));

    const refreshed = await refreshTrackingNumber({
      trackingNumber: "1Z675EW60490310033",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T02:30:00.000Z"),
      config: { urlTemplate: "https://tracking.local/track/{trackingNumber}", authToken: "[REDACTED]" },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith("https://tracking.local/track/1Z675EW60490310033", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer [REDACTED]" }) }));
    expect(refreshed.currentStatus).toBe("IN_TRANSIT");
    expect(refreshed.statusDescription).toBe("Arrived at Toronto hub");
    const events = await prisma.trackingEvent.findMany({ where: { trackingNumberId: refreshed.id } });
    expect(events).toEqual([expect.objectContaining({ description: "Arrived at Toronto hub", location: "Toronto, ON" })]);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-agent`, action: "REFRESH_TRACKING_NUMBER" } })).resolves.toBe(1);
  });

  it("refreshes a tracking number through the recommended Ship24 provider adapter", async () => {
    const fixture = await createOrderImportFixture("SHIP24");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["LL270153425CN"],
        text: "Tracking Number: LL270153425CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const tracking = await prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "LL270153425CN" } });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer ship24-test-key",
        "content-type": "application/json"
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        trackingNumber: "LL270153425CN",
        clientTrackerId: tracking.id,
        shipmentReference: fixture.externalOrderId,
        destinationCountryCode: "CA"
      });
      return new Response(JSON.stringify({
        data: {
          trackings: [{
            tracker: { trackerId: "ship24-tracker-1", trackingNumber: "LL270153425CN", courierCode: ["china-post"], clientTrackerId: tracking.id },
            shipment: {
              statusCode: "transit_in_transit",
              statusCategory: "transit",
              statusMilestone: "in_transit",
              originCountryCode: "CN",
              destinationCountryCode: "CA"
            },
            events: [{
              status: "Departed from sorting center",
              occurrenceDatetime: "2026-06-14T01:30:00.000Z",
              location: "Shenzhen, China",
              courierCode: "china-post",
              statusCode: "transit_departed",
              statusCategory: "transit",
              statusMilestone: "in_transit"
            }]
          }]
        }
      }), { status: 200 });
    });

    const refreshed = await refreshTrackingNumber({
      trackingNumber: "LL270153425CN",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T02:30:00.000Z"),
      config: { provider: "SHIP24", authToken: "ship24-test-key", ship24BaseUrl: "https://api.ship24.test", destinationCountryCode: "CA", refreshIntervalMinutes: 60 },
      fetcher
    });

    expect(fetcher).toHaveBeenCalledWith("https://api.ship24.test/public/v1/trackers/track", expect.any(Object));
    expect(refreshed.provider).toBe("SHIP24");
    expect(refreshed.currentStatus).toBe("IN_TRANSIT");
    expect(refreshed.statusDescription).toBe("Departed from sorting center");
    expect(refreshed.carrier).toBe("china-post");
    expect(refreshed.origin).toBe("CN");
    expect(refreshed.destination).toBe("CA");
    expect(refreshed.nextRefreshAt?.toISOString()).toBe("2026-06-14T03:30:00.000Z");
    const events = await prisma.trackingEvent.findMany({ where: { trackingNumberId: refreshed.id } });
    expect(events).toEqual([expect.objectContaining({ description: "Departed from sorting center", location: "Shenzhen, China", status: "IN_TRANSIT" })]);
  });

  it("backfills tracking numbers from archived email evidence without receiving stock", async () => {
    const fixture = await createOrderImportFixture("ARCHIVED");
    const stockBefore = await prisma.stockMovement.count({ where: { itemId: fixture.item.id } });
    await prisma.emailOrderImport.update({
      where: { id: fixture.orderImport.id },
      data: {
        source: "SYNCED_EMAIL",
        archivedAt: new Date("2026-06-14T02:00:00.000Z"),
        archiveReason: "Archived order evidence still contains logistics data",
        rawText: `${fixture.orderImport.rawText}\nTrack Your Package\nhttps://www.ups.com/track?tracknum=1Z675EW60490310036`
      }
    });

    const result = await captureTrackingNumbersFromImports({ actorId: `${TEST_PREFIX}-agent`, limit: 1 });

    expect(result.saved).toBeGreaterThanOrEqual(1);
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310036" } })).resolves.toMatchObject({
      source: "SYNCED_EMAIL",
      emailOrderImportId: fixture.orderImport.id,
      purchaseOrderId: fixture.order.id
    });
    await expect(prisma.stockMovement.count({ where: { itemId: fixture.item.id } })).resolves.toBe(stockBefore);
  });

  it("refreshes only due non-delivered tracking numbers for automatic polling", async () => {
    const fixture = await createOrderImportFixture("DUE");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        capturedAt: "2026-06-14T02:00:00.000Z",
        trackingNumbers: ["1Z675EW60490310034", "1Z675EW60490310035"],
        text: "Two parsed UPS tracking numbers are attached to this portal snapshot."
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    await prisma.trackingNumber.update({ where: { trackingNumber: "1Z675EW60490310034" }, data: { nextRefreshAt: new Date("2026-06-13T00:00:00.000Z") } });
    await prisma.trackingNumber.update({ where: { trackingNumber: "1Z675EW60490310035" }, data: { nextRefreshAt: new Date("2026-06-14T05:00:00.000Z") } });

    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify({
      tracking_number: url.includes("10034") ? "1Z675EW60490310034" : "1Z675EW60490310035",
      status: "delivered",
      statusDescription: "Delivered",
      deliveredAt: "2026-06-14T03:00:00.000Z",
      events: []
    }), { status: 200 }));

    const result = await refreshDueTrackingNumbers({
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T03:30:00.000Z"),
      limit: 1,
      config: { urlTemplate: "https://tracking.local/track/{trackingNumber}" },
      fetcher
    });

    expect(result.scanned).toBe(1);
    expect(result.refreshed).toBe(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310034" } })).resolves.toMatchObject({ currentStatus: "DELIVERED" });
  });

  it("builds dashboard rows with linked order and service connection metadata", async () => {
    const fixture = await createOrderImportFixture("DASHBOARD");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["LL270153424CN"],
        text: "Tracking no. LL270153424CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });

    const dashboard = await getTrackingDashboard({ now: new Date("2026-06-14T04:00:00.000Z"), config: { provider: "SHIP24", authToken: "ship24-test-key" } });

    expect(dashboard.service.configured).toBe(true);
    expect(dashboard.service.provider).toBe("SHIP24");
    expect(dashboard.summary.total).toBeGreaterThanOrEqual(1);
    expect(dashboard.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        trackingNumber: "LL270153424CN",
        externalOrderId: fixture.externalOrderId,
        purchaseOrderId: fixture.order.id,
        linkedOrderLabel: expect.stringContaining(fixture.externalOrderId)
      })
    ]));

    const deliveredTracking = await prisma.trackingNumber.update({
      where: { trackingNumber: "LL270153424CN" },
      data: {
        currentStatus: "DELIVERED",
        deliveredAt: new Date("2026-06-14T03:00:00.000Z"),
        lastEventAt: new Date("2026-06-14T03:00:00.000Z"),
        nextRefreshAt: new Date("2026-06-13T00:00:00.000Z")
      }
    });
    await prisma.trackingEvent.createMany({
      data: [
        {
          trackingNumberId: deliveredTracking.id,
          status: "IN_TRANSIT",
          description: "Shipment picked up",
          location: "Shenzhen, China",
          occurredAt: new Date("2026-06-12T00:00:00.000Z")
        },
        {
          trackingNumberId: deliveredTracking.id,
          status: "DELIVERED",
          description: "Delivered",
          location: "Toronto, Canada",
          occurredAt: new Date("2026-06-14T03:00:00.000Z")
        }
      ]
    });
    const deliveredDashboard = await getTrackingDashboard({ now: new Date("2026-06-14T04:00:00.000Z"), config: { provider: "SHIP24", authToken: "ship24-test-key" } });
    expect(deliveredDashboard.rows.some((row) => row.trackingNumber === "LL270153424CN")).toBe(false);
    const deliveredRow = (deliveredDashboard as { deliveredRows?: Array<{ trackingNumber: string; nextRefreshAt: Date | null; shipTimeLabel: string | null; shipTimeMs: number | null }> }).deliveredRows?.find((row) => row.trackingNumber === "LL270153424CN");
    expect(deliveredRow).toMatchObject({
      trackingNumber: "LL270153424CN",
      nextRefreshAt: null,
      shipTimeLabel: "2d 3h",
      shipTimeMs: 183_600_000
    });
  });
});
