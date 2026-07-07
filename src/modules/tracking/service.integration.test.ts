import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCategory, MovementType, PurchaseOrderStatus, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  archiveTrackingNumber,
  captureManualTrackingNumbers,
  captureTrackingNumbersFromImports,
  captureTrackingNumbersFromPortalSnapshot,
  deleteTrackingNumber,
  extractTrackingNumbersFromText,
  getLeadTimeLog,
  getTrackingDashboard,
  normalizeTrackingNumber,
  pruneOldAlibabaTrackingNumbers,
  refreshActiveTrackingNumbers,
  refreshDueTrackingNumbers,
  refreshTrackingNumber,
  syncLeadTimeAveragesForPurchaseOrder,
  updateManualItemLeadTime
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
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
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

  it("links manual drop-box tracking by source URL or by supplier and item evidence when the operator omits an order id", async () => {
    const sourceUrlFixture = await createOrderImportFixture("MANUAL-SOURCE-URL");
    const sourceUrlResult = await captureManualTrackingNumbers({
      rawText: "UPS tracking 1Z675EW60490310056",
      sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${sourceUrlFixture.externalOrderId}`,
      actorId: `${TEST_PREFIX}-operator`
    });

    expect(sourceUrlResult).toMatchObject({ saved: 1, updated: 0 });
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310056" } })).resolves.toMatchObject({
      source: "MANUAL_DROPBOX",
      externalOrderId: sourceUrlFixture.externalOrderId,
      purchaseOrderId: sourceUrlFixture.order.id,
      emailOrderImportId: sourceUrlFixture.orderImport.id
    });

    const inferredFixture = await createOrderImportFixture("MANUAL-POWER-SUPPLY");
    await prisma.item.update({
      where: { id: inferredFixture.item.id },
      data: { sku: `${TEST_PREFIX}-MANUAL-POWER-SUPPLY-PSU`, description: "12 V GS/UL certified wall power adapter" }
    });
    const inferredResult = await captureManualTrackingNumbers({
      rawText: `${inferredFixture.supplier.name} power supply shipment\nUPS 1Z675EW60490310057`,
      actorId: `${TEST_PREFIX}-operator`
    });

    expect(inferredResult).toMatchObject({ saved: 1, updated: 0 });
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310057" } })).resolves.toMatchObject({
      source: "MANUAL_DROPBOX",
      externalOrderId: inferredFixture.externalOrderId,
      purchaseOrderId: inferredFixture.order.id,
      emailOrderImportId: inferredFixture.orderImport.id
    });
  });

  it("does not treat an info-received tracking event as delivered lead-time completion", async () => {
    const fixture = await createOrderImportFixture("INFO-NOT-DELIVERED");
    await prisma.trackingNumber.create({
      data: {
        trackingNumber: `${TEST_PREFIX}-INFO-NOT-DELIVERED`,
        source: "MANUAL_DROPBOX",
        sourceUrl: `${TEST_PREFIX}-info-not-delivered-note`,
        currentStatus: "INFO_RECEIVED",
        statusDescription: "Shipper created a label, UPS has not received the package yet.",
        externalOrderId: fixture.externalOrderId,
        purchaseOrderId: fixture.order.id,
        emailOrderImportId: fixture.orderImport.id,
        lastEventAt: new Date("2026-06-12T00:00:00.000Z"),
        refreshStatus: "SUCCESS"
      }
    });

    const dashboard = await getTrackingDashboard({ now: new Date("2026-06-13T00:00:00.000Z"), config: { provider: "SHIP24", authToken: "ship24-test-key" } });
    const row = dashboard.rows.find((entry) => entry.trackingNumber === `${TEST_PREFIX}-INFO-NOT-DELIVERED`);
    expect(row).toMatchObject({
      currentStatus: "INFO_RECEIVED",
      leadTimeEndAt: null,
      leadTimeEndSource: null,
      leadTimeDays: null,
      leadTimeLabel: null
    });
  });

  it("distinguishes catalog/default lead times from manual overrides when no completed sample exists", async () => {
    const fixture = await createOrderImportFixture("CATALOG-LEAD-TIME");
    const catalogLog = await getLeadTimeLog();
    const catalogRow = catalogLog.items.find((item) => item.itemId === fixture.item.id);
    expect(catalogRow).toMatchObject({
      currentLeadTimeDays: 7,
      manualLeadTimeDays: null,
      leadTimeSource: "CATALOG",
      leadTimeLabel: expect.stringContaining("catalog/default planning lead time")
    });

    await updateManualItemLeadTime({ itemId: fixture.item.id, leadTimeDays: 33, actorId: `${TEST_PREFIX}-operator` });
    const manualLog = await getLeadTimeLog();
    const manualRow = manualLog.items.find((item) => item.itemId === fixture.item.id);
    expect(manualRow).toMatchObject({
      currentLeadTimeDays: 33,
      manualLeadTimeDays: 33,
      leadTimeSource: "MANUAL",
      leadTimeLabel: expect.stringContaining("manual planning estimate")
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

  it("links portal tracking captured from a shipment import back to the initial payment purchase order", async () => {
    const fixture = await createOrderImportFixture("SHIPMENT-LINK");
    const shipmentImport = await prisma.emailOrderImport.create({
      data: {
        source: "SYNCED_EMAIL",
        sourceHash: `${TEST_PREFIX}-SHIPMENT-LINK-shipment-hash`,
        sourceMessageId: `<${TEST_PREFIX}-SHIPMENT-LINK-shipment>`,
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}#shipment-email`,
        subject: "Your Alibaba order has shipped",
        rawText: `Subject: Your Alibaba order has shipped\nOrder ID: ${fixture.externalOrderId}\nTrack package in Alibaba portal`,
        externalOrderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        supplierId: fixture.supplier.id,
        status: "IMPORTED",
        totalCost: 12.5,
        lines: {
          create: [{ lineNo: 1, rawDescription: fixture.item.description, quantity: 10, unitPrice: 1.25, lineTotal: 12.5, matchedItemId: fixture.item.id, matchConfidence: "MANUAL" }]
        }
      }
    });

    const result = await captureTrackingNumbersFromPortalSnapshot({
      emailOrderImportId: shipmentImport.id,
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}#tracking`,
        orderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        capturedAt: "2026-06-14T02:00:00.000Z",
        trackingNumbers: ["1Z675EW60490310040"],
        text: "Shipment confirmation\nTracking Number: 1Z675EW60490310040"
      },
      actorId: `${TEST_PREFIX}-agent`
    });

    expect(result.saved).toBe(1);
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310040" } })).resolves.toMatchObject({
      purchaseOrderId: fixture.order.id,
      emailOrderImportId: shipmentImport.id,
      externalOrderId: fixture.externalOrderId
    });
  });

  it("builds an expandable lead-time log with ordered quantity, received quantity, and shipping time samples", async () => {
    const fixture = await createOrderImportFixture("LEAD-LOG");
    const line = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: fixture.order.id } });
    const tracking = await prisma.trackingNumber.create({
      data: {
        trackingNumber: "1Z675EW60490310041",
        source: "ALIBABA_PORTAL",
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        externalOrderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        purchaseOrderId: fixture.order.id,
        emailOrderImportId: fixture.orderImport.id,
        currentStatus: "DELIVERED",
        capturedAt: new Date("2026-06-11T00:00:00.000Z"),
        deliveredAt: new Date("2026-06-18T00:00:00.000Z"),
        lastEventAt: new Date("2026-06-18T00:00:00.000Z"),
        nextRefreshAt: null,
        refreshStatus: "SUCCESS"
      }
    });
    await prisma.trackingEvent.createMany({
      data: [
        { trackingNumberId: tracking.id, status: "IN_TRANSIT", description: "Picked up", occurredAt: new Date("2026-06-12T00:00:00.000Z") },
        { trackingNumberId: tracking.id, status: "DELIVERED", description: "Delivered", occurredAt: new Date("2026-06-18T00:00:00.000Z") }
      ]
    });
    const lot = await prisma.stockLot.create({
      data: { itemId: fixture.item.id, lotCode: `${TEST_PREFIX}-LEAD-LOG-LOT`, receivedAt: new Date("2026-06-20T00:00:00.000Z"), unitCost: 1.25 }
    });
    await prisma.stockMovement.create({
      data: {
        itemId: fixture.item.id,
        stockLotId: lot.id,
        purchaseOrderLineId: line.id,
        movementType: MovementType.RECEIVE,
        quantity: 10,
        reason: "Lead time fixture receive",
        actorType: "USER",
        actorId: `${TEST_PREFIX}-agent`
      }
    });
    await prisma.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQuantity: 10 } });

    const log = await getLeadTimeLog();
    const itemLog = log.items.find((row) => row.itemId === fixture.item.id);
    expect(itemLog).toMatchObject({
      itemSku: fixture.item.sku,
      sampleCount: 1,
      totalQuantityOrdered: 10,
      totalQuantityReceived: 10,
      averageLeadTimeDays: 10,
      averageShipTimeDays: 6
    });
    expect(itemLog?.entries[0]).toMatchObject({
      purchaseOrderId: fixture.order.id,
      externalOrderId: fixture.externalOrderId,
      quantityOrdered: 10,
      quantityReceived: 10,
      leadTimeDays: 10,
      endSource: "RECEIVED",
      shipTimeLabel: "6d",
      trackingNumbers: ["1Z675EW60490310041"]
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
      if (init?.method === "GET") return new Response(JSON.stringify({ data: { trackers: [] } }), { status: 200 });
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer ship24-test-key",
        "content-type": "application/json"
      });
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody).toMatchObject({
        trackingNumber: "LL270153425CN",
        shipmentReference: fixture.externalOrderId,
        destinationCountryCode: "CA",
        courierCode: ["china-post"]
      });
      expect(requestBody).not.toHaveProperty("courierName");
      expect(requestBody.clientTrackerId).toMatch(new RegExp(`^${tracking.id}-[0-9a-f]{10}$`));
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

  it("avoids Ship24 tracker conflicts by not reusing stale bare row ids as client tracker ids", async () => {
    const fixture = await createOrderImportFixture("SHIP24-CONFLICT");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["LL270153429CN"],
        text: "Tracking Number: LL270153429CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const tracking = await prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "LL270153429CN" } });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") return new Response(JSON.stringify({ data: { trackers: [] } }), { status: 200 });
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody.clientTrackerId).not.toBe(tracking.id);
      expect(requestBody.clientTrackerId).toMatch(new RegExp(`^${tracking.id}-[0-9a-f]{10}$`));
      return new Response(JSON.stringify({
        data: {
          trackings: [{
            tracker: { trackerId: "ship24-tracker-conflict-safe", trackingNumber: "LL270153429CN", courierCode: ["china-post"], clientTrackerId: requestBody.clientTrackerId },
            shipment: { statusMilestone: "in_transit", originCountryCode: "CN", destinationCountryCode: "CA" },
            events: [{ status: "Arrived at export facility", statusMilestone: "in_transit", occurrenceDatetime: "2026-06-14T01:30:00.000Z" }]
          }]
        }
      }), { status: 200 });
    });

    const refreshed = await refreshTrackingNumber({
      trackingNumber: "LL270153429CN",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T02:30:00.000Z"),
      config: { provider: "SHIP24", authToken: "ship24-test-key" },
      fetcher
    });

    expect(refreshed.refreshStatus).toBe("SUCCESS");
    expect(refreshed.refreshError).toBeNull();
    expect(refreshed.currentStatus).toBe("IN_TRANSIT");
  });

  it("deactivates duplicate active Ship24 trackers before creating the next tracker poll", async () => {
    const fixture = await createOrderImportFixture("SHIP24-DEDUPE");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["LL270153430CN"],
        text: "Tracking Number: LL270153430CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const patchedTrackerIds: string[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({
          data: {
            trackers: [
              { trackerId: "current-old", trackingNumber: "LL270153430CN", clientTrackerId: "stale-current", isTracked: true, isSubscribed: true, createdAt: "2026-06-14T00:00:00.000Z" },
              { trackerId: "other-old", trackingNumber: "873130679210", clientTrackerId: "other-old", isTracked: true, isSubscribed: true, createdAt: "2026-06-14T00:00:00.000Z" },
              { trackerId: "other-new", trackingNumber: "873130679210", clientTrackerId: "other-new", isTracked: true, isSubscribed: true, createdAt: "2026-06-15T00:00:00.000Z" }
            ]
          }
        }), { status: 200 });
      }
      if (init?.method === "PATCH") {
        patchedTrackerIds.push(url.split("/").at(-1) ?? "");
        expect(JSON.parse(String(init.body))).toEqual({ isSubscribed: false, isTracked: false });
        return new Response(JSON.stringify({ data: { tracker: { isTracked: false, isSubscribed: false } } }), { status: 200 });
      }
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({
        data: {
          trackings: [{
            tracker: { trackerId: "ship24-dedupe-current", trackingNumber: "LL270153430CN" },
            shipment: { statusMilestone: "in_transit", originCountryCode: "CN", destinationCountryCode: "CA" },
            events: [{ status: "Processed through facility", statusMilestone: "in_transit", occurrenceDatetime: "2026-06-14T01:30:00.000Z" }]
          }]
        }
      }), { status: 200 });
    });

    const refreshed = await refreshTrackingNumber({
      trackingNumber: "LL270153430CN",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T02:30:00.000Z"),
      config: { provider: "SHIP24", authToken: "ship24-test-key", ship24BaseUrl: "https://api.ship24.test" },
      fetcher
    });

    expect(patchedTrackerIds).toEqual(["current-old", "other-old"]);
    expect(refreshed.refreshStatus).toBe("SUCCESS");
    expect(fetcher).toHaveBeenCalledWith("https://api.ship24.test/public/v1/trackers?limit=100", expect.objectContaining({ method: "GET" }));
    expect(fetcher).toHaveBeenCalledWith("https://api.ship24.test/public/v1/trackers/track", expect.objectContaining({ method: "POST" }));
  });

  it("normalizes Ship24 info-received provider entries separately from pending", async () => {
    const fixture = await createOrderImportFixture("SHIP24-DATA");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["LL270153426CN"],
        text: "Tracking Number: LL270153426CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: {
        trackings: [{
          shipment: {
            statusCode: "data_information_received",
            statusCategory: "data",
            statusMilestone: "data"
          },
          events: [{
            status: "Electronic information submitted by shipper",
            occurrenceDatetime: "2026-06-14T01:30:00.000Z",
            statusCategory: "data",
            statusMilestone: "data"
          }]
        }]
      }
    }), { status: 200 }));

    const refreshed = await refreshTrackingNumber({
      trackingNumber: "LL270153426CN",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T02:30:00.000Z"),
      config: { provider: "SHIP24", authToken: "ship24-test-key" },
      fetcher
    });

    expect(refreshed.currentStatus).toBe("INFO_RECEIVED");
    await expect(prisma.trackingEvent.findFirstOrThrow({ where: { trackingNumberId: refreshed.id } })).resolves.toMatchObject({ status: "INFO_RECEIVED" });
  });

  it("normalizes Ship24 out-for-delivery milestones as their own shipment stage", async () => {
    const fixture = await createOrderImportFixture("SHIP24-OFD");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["1Z675EW60490310065"],
        text: "Tracking Number: 1Z675EW60490310065"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") return new Response(JSON.stringify({ data: { trackers: [] } }), { status: 200 });
      const requestBody = JSON.parse(String(init?.body));
      expect(requestBody).toMatchObject({ courierCode: ["ups"] });
      expect(requestBody).not.toHaveProperty("courierName");
      return new Response(JSON.stringify({
        data: {
          trackings: [{
            tracker: { trackerId: "ship24-out-for-delivery", trackingNumber: "1Z675EW60490310065", courierCode: ["ups"], clientTrackerId: requestBody.clientTrackerId },
            shipment: { statusCode: "delivery_out_for_delivery", statusCategory: "delivery", statusMilestone: "out_for_delivery", destinationCountryCode: "CA" },
            events: [{ status: "Out For Delivery Today", statusCode: "delivery_out_for_delivery", statusCategory: "delivery", statusMilestone: "out_for_delivery", occurrenceDatetime: "2026-07-07T10:31:00-04:00", location: "Concord, ON, Canada" }]
          }]
        }
      }), { status: 200 });
    });

    const refreshed = await refreshTrackingNumber({
      trackingNumber: "1Z675EW60490310065",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-07-07T16:00:00.000Z"),
      config: { provider: "SHIP24", authToken: "ship24-test-key", destinationCountryCode: "CA" },
      fetcher
    });

    expect(refreshed.currentStatus).toBe("OUT_FOR_DELIVERY");
    await expect(prisma.trackingEvent.findFirstOrThrow({ where: { trackingNumberId: refreshed.id } })).resolves.toMatchObject({ status: "OUT_FOR_DELIVERY", description: "Out For Delivery Today" });
  });

  it("recognizes carrier-has-received-information responses as info received, not pending", async () => {
    const fixture = await createOrderImportFixture("INFO-RECEIVED-PHRASE");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["LL270153428CN"],
        text: "Tracking Number: LL270153428CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      status: "pending",
      statusDescription: "Shipper created a label, UPS has not received the package yet.",
      events: [{
        status: "pending",
        description: "The carrier has received information about this package.",
        occurredAt: "2026-06-14T01:00:00.000Z"
      }]
    }), { status: 200 }));

    const refreshed = await refreshTrackingNumber({
      trackingNumber: "LL270153428CN",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T02:30:00.000Z"),
      config: { provider: "CUSTOM_HTTP", urlTemplate: "https://tracking.local/track/{trackingNumber}" },
      fetcher
    });

    expect(refreshed.currentStatus).toBe("INFO_RECEIVED");
    await expect(getTrackingDashboard()).resolves.toMatchObject({
      rows: expect.arrayContaining([expect.objectContaining({ trackingNumber: "LL270153428CN", currentStatus: "INFO_RECEIVED" })])
    });
  });

  it("keeps pending when the provider has no initial tracking entry", async () => {
    const fixture = await createOrderImportFixture("SHIP24-NO-EVENT");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        trackingNumbers: ["LL270153427CN"],
        text: "Tracking Number: LL270153427CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: {
        trackings: [{
          shipment: {
            statusCode: "data",
            statusCategory: "data",
            statusMilestone: "data"
          },
          events: []
        }]
      }
    }), { status: 200 }));

    const refreshed = await refreshTrackingNumber({
      trackingNumber: "LL270153427CN",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-14T02:30:00.000Z"),
      config: { provider: "SHIP24", authToken: "ship24-test-key" },
      fetcher
    });

    expect(refreshed.currentStatus).toBe("PENDING");
    await expect(prisma.trackingEvent.count({ where: { trackingNumberId: refreshed.id } })).resolves.toBe(0);
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
        trackingNumbers: ["1Z675EW60490310034"],
        text: "One parsed UPS tracking number is attached to this portal snapshot."
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    await prisma.trackingNumber.update({ where: { trackingNumber: "1Z675EW60490310034" }, data: { nextRefreshAt: new Date("2026-06-13T00:00:00.000Z") } });
    await prisma.trackingNumber.create({
      data: {
        trackingNumber: `${TEST_PREFIX}-DUE-FUTURE`,
        source: "TEST",
        currentStatus: "PENDING",
        refreshStatus: "PENDING",
        nextRefreshAt: new Date("2026-06-14T05:00:00.000Z")
      }
    });

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

  it("screens duplicate same-order shipments down to the active most-recent tracking stream while preserving links", async () => {
    const fixture = await createOrderImportFixture("DUPLICATE-SHIPMENT");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        capturedAt: "2026-06-14T02:00:00.000Z",
        trackingNumbers: ["LL270153431CN", "LL270153432CN"],
        text: "Shipment 1 LL270153431CN was replaced by shipment 2 LL270153432CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    const stale = await prisma.trackingNumber.update({
      where: { trackingNumber: "LL270153431CN" },
      data: { currentStatus: "IN_TRANSIT", lastEventAt: new Date("2026-06-14T01:00:00.000Z") }
    });
    const active = await prisma.trackingNumber.update({
      where: { trackingNumber: "LL270153432CN" },
      data: { currentStatus: "IN_TRANSIT", lastEventAt: new Date("2026-06-15T01:00:00.000Z") }
    });
    await prisma.trackingEvent.createMany({
      data: [
        {
          trackingNumberId: stale.id,
          status: "IN_TRANSIT",
          description: "Older duplicate label scanned",
          occurredAt: new Date("2026-06-14T01:00:00.000Z")
        },
        {
          trackingNumberId: active.id,
          status: "IN_TRANSIT",
          description: "Newest active shipment departed facility",
          occurredAt: new Date("2026-06-15T01:00:00.000Z")
        }
      ]
    });

    const persistedLinks = await prisma.trackingNumber.findMany({
      where: { externalOrderId: fixture.externalOrderId },
      orderBy: { trackingNumber: "asc" }
    });
    expect(persistedLinks).toEqual([
      expect.objectContaining({ trackingNumber: "LL270153431CN", purchaseOrderId: fixture.order.id, emailOrderImportId: fixture.orderImport.id }),
      expect.objectContaining({ trackingNumber: "LL270153432CN", purchaseOrderId: fixture.order.id, emailOrderImportId: fixture.orderImport.id })
    ]);

    const dashboard = await getTrackingDashboard({ now: new Date("2026-06-15T02:00:00.000Z"), config: { provider: "SHIP24", authToken: "ship24-test-key" } });
    const orderRows = dashboard.rows.filter((row) => row.externalOrderId === fixture.externalOrderId);

    expect(orderRows.map((row) => row.trackingNumber)).toEqual(["LL270153432CN"]);
    expect(orderRows[0]).toMatchObject({
      trackingNumber: "LL270153432CN",
      relatedTrackingNumbers: ["LL270153431CN", "LL270153432CN"],
      screenedShipmentCount: 2,
      latestEvent: expect.objectContaining({ description: "Newest active shipment departed facility" })
    });
  });

  it("automatically archives older linked active tracking numbers when the associated active stream is delivered", async () => {
    const fixture = await createOrderImportFixture("AUTO-ARCHIVE-DELIVERED");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        supplierName: fixture.supplier.name,
        capturedAt: "2026-06-14T02:00:00.000Z",
        trackingNumbers: ["LL270153441CN", "LL270153442CN"],
        text: "Older package LL270153441CN was replaced by active package LL270153442CN"
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    await prisma.trackingNumber.update({ where: { trackingNumber: "LL270153441CN" }, data: { currentStatus: "IN_TRANSIT", lastEventAt: new Date("2026-06-14T01:00:00.000Z") } });
    await prisma.trackingNumber.update({ where: { trackingNumber: "LL270153442CN" }, data: { currentStatus: "IN_TRANSIT", lastEventAt: new Date("2026-06-15T01:00:00.000Z") } });

    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      tracking_number: "LL270153442CN",
      status: "delivered",
      statusDescription: "Delivered",
      deliveredAt: "2026-06-16T03:00:00.000Z",
      events: [{ status: "delivered", description: "Delivered", occurredAt: "2026-06-16T03:00:00.000Z" }]
    }), { status: 200 }));

    await refreshTrackingNumber({
      trackingNumber: "LL270153442CN",
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-16T03:30:00.000Z"),
      config: { urlTemplate: "https://tracking.local/track/{trackingNumber}" },
      fetcher
    });

    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "LL270153441CN" } })).resolves.toMatchObject({
      currentStatus: "ARCHIVED",
      refreshStatus: "ARCHIVED",
      nextRefreshAt: null
    });
    await expect(prisma.auditLog.count({ where: { action: "AUTO_ARCHIVE_ASSOCIATED_TRACKING_NUMBER", actorId: `${TEST_PREFIX}-agent` } })).resolves.toBe(1);

    const dashboard = await getTrackingDashboard({ now: new Date("2026-06-16T04:00:00.000Z"), config: { provider: "SHIP24", authToken: "ship24-test-key" } });
    expect(dashboard.rows.some((row) => row.trackingNumber === "LL270153441CN")).toBe(false);
    expect(dashboard.deliveredRows.find((row) => row.trackingNumber === "LL270153442CN")).toMatchObject({
      relatedTrackingNumbers: ["LL270153441CN", "LL270153442CN"],
      screenedShipmentCount: 2
    });
    expect(dashboard.archivedRows.map((row) => row.trackingNumber)).toContain("LL270153441CN");
  });

  it("lets the operator archive or delete active tracking numbers without receiving stock", async () => {
    const fixture = await createOrderImportFixture("MANUAL-ARCHIVE-DELETE");
    await captureManualTrackingNumbers({
      rawText: `Tracking Number: LL270153443CN\nTracking Number: LL270153444CN\nAlibaba order ${fixture.externalOrderId}`,
      actorId: `${TEST_PREFIX}-operator`,
      externalOrderId: fixture.externalOrderId
    });
    const stockBefore = await prisma.stockMovement.count({ where: { itemId: fixture.item.id } });

    await archiveTrackingNumber({ trackingNumber: "LL270153443CN", actorId: `${TEST_PREFIX}-operator` });
    await deleteTrackingNumber({ trackingNumber: "LL270153444CN", actorId: `${TEST_PREFIX}-operator` });

    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "LL270153443CN" } })).resolves.toMatchObject({ currentStatus: "ARCHIVED", nextRefreshAt: null });
    await expect(prisma.trackingNumber.findUnique({ where: { trackingNumber: "LL270153444CN" } })).resolves.toBeNull();
    await expect(prisma.stockMovement.count({ where: { itemId: fixture.item.id } })).resolves.toBe(stockBefore);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-operator`, action: { in: ["ARCHIVE_TRACKING_NUMBER", "DELETE_TRACKING_NUMBER"] } } })).resolves.toBe(2);
  });

  it("hides junk supplier labels from dashboard display rows", async () => {
    await prisma.trackingNumber.create({
      data: {
        trackingNumber: `${TEST_PREFIX}-JUNK-SUPPLIER`,
        source: "ALIBABA_PORTAL",
        supplierName: "to ship",
        currentStatus: "PENDING",
        refreshStatus: "FAILED",
        refreshError: "provider failed",
        nextRefreshAt: new Date("2026-06-14T00:00:00.000Z")
      }
    });

    const dashboard = await getTrackingDashboard({ now: new Date("2026-06-14T04:00:00.000Z"), config: { provider: "SHIP24", authToken: "ship24-test-key" } });
    const row = dashboard.rows.find((entry) => entry.trackingNumber === `${TEST_PREFIX}-JUNK-SUPPLIER`);

    expect(row).toMatchObject({ linkedOrderLabel: "Unlinked evidence", supplierName: null });
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
        nextRefreshAt: new Date("2026-06-13T00:00:00.000Z"),
        rawStatusJson: { provider: "test", shipment: { status: "DELIVERED" } }
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
          occurredAt: new Date("2026-06-14T03:00:00.000Z"),
          rawEventJson: { checkpoint: "front_door" }
        }
      ]
    });
    const deliveredDashboard = await getTrackingDashboard({ now: new Date("2026-06-14T04:00:00.000Z"), config: { provider: "SHIP24", authToken: "ship24-test-key" } });
    expect(deliveredDashboard.rows.some((row) => row.trackingNumber === "LL270153424CN")).toBe(false);
    const deliveredRow = deliveredDashboard.deliveredRows.find((row) => row.trackingNumber === "LL270153424CN");
    expect(deliveredRow).toMatchObject({
      trackingNumber: "LL270153424CN",
      nextRefreshAt: null,
      shipTimeLabel: "2d 3h",
      shipTimeMs: 183_600_000,
      rawStatusJson: { provider: "test", shipment: { status: "DELIVERED" } }
    });
    expect(deliveredRow?.events).toHaveLength(2);
    expect(deliveredRow?.events[0]).toMatchObject({
      status: "DELIVERED",
      description: "Delivered",
      rawEventJson: { checkpoint: "front_door" }
    });
  });

  it("makes manual item lead time primary, updates the preferred supplier, and prevents observed sync from overwriting it", async () => {
    const fixture = await createOrderImportFixture("MANUAL-PRIMARY");
    const line = await prisma.purchaseOrderLine.findFirstOrThrow({ where: { purchaseOrderId: fixture.order.id, itemId: fixture.item.id } });
    const lot = await prisma.stockLot.create({
      data: { itemId: fixture.item.id, lotCode: `${TEST_PREFIX}-MANUAL-PRIMARY-LOT`, receivedAt: new Date("2026-06-30T00:00:00.000Z"), unitCost: 1 }
    });
    await prisma.stockMovement.create({
      data: {
        itemId: fixture.item.id,
        stockLotId: lot.id,
        purchaseOrderLineId: line.id,
        movementType: MovementType.RECEIVE,
        quantity: 10,
        reason: "Manual-primary lead-time observed sample fixture",
        actorType: "USER",
        actorId: `${TEST_PREFIX}-receiver`
      }
    });

    await updateManualItemLeadTime({ itemId: fixture.item.id, leadTimeDays: 42, actorId: `${TEST_PREFIX}-operator` });
    const log = await getLeadTimeLog();
    const row = log.items.find((item) => item.itemId === fixture.item.id);

    expect(row).toMatchObject({
      currentLeadTimeDays: 42,
      manualLeadTimeDays: 42,
      leadTimeSource: "MANUAL",
      weightedAverageLeadTimeDays: 20,
      leadTimeLabel: expect.stringContaining("completed samples retained as evidence")
    });
    await expect(prisma.supplier.findUniqueOrThrow({ where: { id: fixture.supplier.id } })).resolves.toMatchObject({ leadTimeDays: 42 });

    const sync = await syncLeadTimeAveragesForPurchaseOrder(fixture.order.id, `${TEST_PREFIX}-agent`, "AGENT");
    expect(sync.updatedItems).toBe(0);
    await expect(prisma.item.findUniqueOrThrow({ where: { id: fixture.item.id } })).resolves.toMatchObject({ leadTimeDays: 42, manualLeadTimeDays: 42 });
  });

  it("keeps same-order tracking evidence active while the dashboard screens duplicate shipment cards", async () => {
    const fixture = await createOrderImportFixture("ACTIVE-REFRESH");
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        capturedAt: "2026-06-14T02:00:00.000Z",
        trackingNumbers: ["1Z675EW60490310044"],
        text: "First UPS tracking number."
      },
      actorId: `${TEST_PREFIX}-agent`
    });
    await captureTrackingNumbersFromPortalSnapshot({
      snapshot: {
        sourceUrl: `https://biz.alibaba.com/ta/detail.htm?orderId=${fixture.externalOrderId}`,
        orderId: fixture.externalOrderId,
        capturedAt: "2026-06-15T02:00:00.000Z",
        trackingNumbers: ["1Z675EW60490310045"],
        text: "Second package UPS tracking number."
      },
      actorId: `${TEST_PREFIX}-agent`
    });

    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310044" } })).resolves.toMatchObject({
      currentStatus: "UNKNOWN",
      refreshStatus: "PENDING"
    });
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310045" } })).resolves.toMatchObject({
      currentStatus: "UNKNOWN",
      refreshStatus: "PENDING"
    });
    await prisma.trackingNumber.update({ where: { trackingNumber: "1Z675EW60490310044" }, data: { nextRefreshAt: new Date("2026-06-20T00:00:00.000Z") } });
    await prisma.trackingNumber.update({ where: { trackingNumber: "1Z675EW60490310045" }, data: { nextRefreshAt: new Date("2026-06-22T00:00:00.000Z") } });

    const fetcher = vi.fn(async (url: string) => {
      const trackingNumber = decodeURIComponent(url.split("/track/")[1] ?? "");
      return new Response(JSON.stringify({
        tracking_number: trackingNumber,
        status: "in_transit",
        statusDescription: "In transit",
        events: []
      }), { status: 200 });
    });
    const result = await refreshActiveTrackingNumbers({
      actorId: `${TEST_PREFIX}-agent`,
      now: new Date("2026-06-21T00:00:00.000Z"),
      config: { urlTemplate: "https://tracking.local/track/{trackingNumber}", refreshIntervalMinutes: 240 },
      fetcher,
      limit: 2
    });

    expect(result.scanned).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310044" } })).resolves.toMatchObject({
      currentStatus: "IN_TRANSIT",
      refreshStatus: "SUCCESS"
    });
    await expect(prisma.trackingNumber.findUniqueOrThrow({ where: { trackingNumber: "1Z675EW60490310045" } })).resolves.toMatchObject({
      currentStatus: "IN_TRANSIT",
      refreshStatus: "SUCCESS"
    });
    const dashboard = await getTrackingDashboard({ now: new Date("2026-06-21T00:00:00.000Z"), config: { provider: "SHIP24", authToken: "ship24-test-key" } });
    expect(dashboard.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relatedTrackingNumbers: expect.arrayContaining(["1Z675EW60490310044", "1Z675EW60490310045"]),
        screenedShipmentCount: 2
      })
    ]));
  });
});
