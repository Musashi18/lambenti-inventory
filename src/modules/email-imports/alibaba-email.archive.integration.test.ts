import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CostConfidence, ItemCategory, LifecycleStatus, Prisma, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";

import { normalizeInvoiceNumberKey } from "@/modules/accounting/invoices";
import { archiveEmailOrderImport, applyAlibabaEmailOrderImport, deleteArchivedEmailOrderImport, getEmailOrderImports, importAlibabaEmailOrder, reassessRecentEmailOrderImports, unarchiveEmailOrderImport, updateEmailOrderImportLine } from "./alibaba-email";

const TEST_PREFIX = "TEST-EMAIL-ARCHIVE";
const PROTECTED_ITEM_SKUS = ["LED-COB-12V-3000K", "LED-COB-12V-6500K"] as const;

type ProtectedItemSnapshot = {
  id: string;
  sku: string;
  manufacturerPartNo: string | null;
  supplierSku: string | null;
  preferredSupplierId: string | null;
  estimatedUnitCost: Prisma.Decimal | null;
  costCurrency: string;
  costConfidence: CostConfidence;
  costSourceRef: string | null;
};

let protectedItemSnapshots: ProtectedItemSnapshot[] = [];

async function captureProtectedItemSnapshots() {
  protectedItemSnapshots = await prisma.item.findMany({
    where: { sku: { in: [...PROTECTED_ITEM_SKUS] } },
    select: {
      id: true,
      sku: true,
      manufacturerPartNo: true,
      supplierSku: true,
      preferredSupplierId: true,
      estimatedUnitCost: true,
      costCurrency: true,
      costConfidence: true,
      costSourceRef: true
    }
  });
}

async function restoreProtectedItemSnapshots() {
  for (const item of protectedItemSnapshots) {
    const preferredSupplierStillExists = item.preferredSupplierId
      ? await prisma.supplier.findUnique({ where: { id: item.preferredSupplierId }, select: { id: true } })
      : null;

    await prisma.item.updateMany({
      where: { id: item.id },
      data: {
        manufacturerPartNo: item.manufacturerPartNo,
        supplierSku: item.supplierSku,
        preferredSupplierId: preferredSupplierStillExists ? item.preferredSupplierId : null,
        estimatedUnitCost: item.estimatedUnitCost,
        costCurrency: item.costCurrency,
        costConfidence: item.costConfidence,
        costSourceRef: item.costSourceRef
      }
    });
  }
}

async function cleanup() {
  await restoreProtectedItemSnapshots();
  const suppliers = await prisma.supplier.findMany({
    where: {
      OR: [
        { name: { startsWith: TEST_PREFIX } },
        { name: { startsWith: `Supplier order ${TEST_PREFIX}` } },
        { name: { startsWith: `order ${TEST_PREFIX}` } }
      ]
    },
    select: { id: true }
  });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const supplierPurchaseOrders = supplierIds.length > 0
    ? await prisma.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } })
    : [];
  const imports = await prisma.emailOrderImport.findMany({
    where: {
      OR: [
        { supplierName: { startsWith: TEST_PREFIX } },
        { externalOrderId: { startsWith: TEST_PREFIX } },
        { subject: { contains: TEST_PREFIX } }
      ]
    },
    select: { id: true, purchaseOrderId: true }
  });
  const importIds = imports.map((item) => item.id);
  const purchaseOrderIds = Array.from(new Set([
    ...imports.map((item) => item.purchaseOrderId).filter((id): id is string => Boolean(id)),
    ...supplierPurchaseOrders.map((order) => order.id)
  ]));

  if (importIds.length > 0) {
    await prisma.emailOrderLineImport.deleteMany({ where: { importId: { in: importIds } } });
    await prisma.emailOrderImport.deleteMany({ where: { id: { in: importIds } } });
  }
  if (purchaseOrderIds.length > 0) {
    const invoices = await prisma.supplierInvoice.findMany({
      where: { purchaseOrderId: { in: purchaseOrderIds } },
      select: { id: true }
    });
    const invoiceIds = invoices.map((invoice) => invoice.id);
    if (invoiceIds.length > 0) {
      await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.supplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: purchaseOrderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: purchaseOrderIds } } });
  }

  const testItems = await prisma.item.findMany({
    where: { sku: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const itemIds = testItems.map((item) => item.id);
  if (itemIds.length > 0) {
    await prisma.supplierOffer.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseOrderLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.purchaseRequestLine.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }

  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.supplier.deleteMany({
    where: {
      OR: [
        { name: { startsWith: TEST_PREFIX } },
        { name: { startsWith: `Supplier order ${TEST_PREFIX}` } },
        { name: { startsWith: `order ${TEST_PREFIX}` } }
      ]
    }
  });
}


describe("email order import archive and dedupe workflow", () => {
  beforeAll(captureProtectedItemSnapshots);
  beforeEach(cleanup);
  afterEach(cleanup);
  afterAll(cleanup);

  it("hides ignored archived order emails by default while keeping them accessible", async () => {
    const orderId = `${TEST_PREFIX}-${Date.now()}`;
    const created = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      rawText: `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${TEST_PREFIX} Supplier
Product: LED-COB-12V-3000K qty 2 unit price USD 1.25 total USD 2.50
Total: USD 2.50
`
    });

    await archiveEmailOrderImport(created.import.id, `${TEST_PREFIX}-actor`, "Ignored from Order Email Agent");

    const visible = await getEmailOrderImports();
    expect(visible.some((item) => item.id === created.import.id)).toBe(false);

    const accessible = await getEmailOrderImports({ archivedOnly: true });
    const archived = accessible.find((item) => item.id === created.import.id);
    expect(archived).toBeTruthy();
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    expect(archived?.archiveReason).toBe("Ignored from Order Email Agent");

    await expect(prisma.auditLog.count({
      where: { entityId: created.import.id, action: "ARCHIVE_EMAIL_ORDER_IMPORT" }
    })).resolves.toBe(1);
  });

  it("deduplicates legacy rows whose order number only appears in subject or raw text", async () => {
    const orderId = `303${Date.now()}1023166`;

    const supplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Legacy Supplier ${orderId}`,
        moq: 1,
        leadTimeDays: 21,
        shippingCost: 0,
        reliabilityScore: 3
      }
    });

    await prisma.emailOrderImport.create({
      data: {
        sourceHash: `${TEST_PREFIX}-${orderId}-poor`,
        subject: `${TEST_PREFIX} payment status for your Trade Assurance order ${orderId} has changed`,
        rawText: `The payment status for your Trade Assurance order ${orderId} has changed. Total USD 292.00`,
        supplierName: supplier.name,
        supplierId: supplier.id,
        totalCost: 292,
        confidence: "CONFIRMED",
        status: "NEEDS_REVIEW",
        lines: {
          create: [{ lineNo: 1, rawDescription: "5952 pad with tab", quantity: 500, unitPrice: 0.3, lineTotal: 150, currency: "USD" }]
        }
      }
    });

    const rich = await prisma.emailOrderImport.create({
      data: {
        sourceHash: `${TEST_PREFIX}-${orderId}-rich`,
        subject: `${TEST_PREFIX} Order ${orderId}`,
        rawText: `Order ${orderId}\nYour product and delivery information\n5952 pad with tab\nQuantity: 500\nItem subtotal: USD 150.00\nView details\n5952 pad with tab small one\nQuantity: 500\nItem subtotal: USD 75.00`,
        supplierName: supplier.name,
        supplierId: supplier.id,
        totalCost: 292,
        confidence: "CONFIRMED",
        status: "NEEDS_REVIEW",
        lines: {
          create: [
            { lineNo: 1, rawDescription: "5952 pad with tab", quantity: 500, unitPrice: 0.3, lineTotal: 150, currency: "USD" },
            { lineNo: 2, rawDescription: "5952 pad with tab small one", quantity: 500, unitPrice: 0.15, lineTotal: 75, currency: "USD" }
          ]
        }
      }
    });

    const visibleMatches = (await getEmailOrderImports()).filter((item) =>
      item.subject?.includes(orderId) || item.rawText.includes(orderId)
    );

    expect(visibleMatches).toHaveLength(1);
    expect(visibleMatches[0].id).toBe(rich.id);
    expect(visibleMatches[0].lines).toHaveLength(2);
  });

  it("uses SYNCED_EMAIL as the mailbox/default source while keeping manual CSV imports distinguishable", async () => {
    const orderId = `${TEST_PREFIX}-SOURCE-${Date.now()}`;

    const synced = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      rawText: `
Subject: Synced supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${TEST_PREFIX} Source Supplier
Product: LED-COB-12V-3000K qty 2 unit price USD 1.25 total USD 2.50
Total: USD 2.50
`
    });

    const csv = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      source: "MANUAL_CSV_IMPORT",
      rawText: `
Subject: CSV supplier order ${orderId}-CSV
Order ID: ${orderId}-CSV
Supplier: ${TEST_PREFIX} CSV Supplier
SKU, Description, Quantity, Unit price, Total
LED-COB-12V-3000K, LED strip warm white, 3, 2.00, 6.00
`
    });

    expect(synced.import.source).toBe("SYNCED_EMAIL");
    expect(csv.import.source).toBe("MANUAL_CSV_IMPORT");
  });

  it("keeps tracking-only Alibaba portal message snapshots out of the active Order Email Agent queue", async () => {
    const suffix = `${Date.now()}`;
    const actionableOrderId = `${TEST_PREFIX}-VISIBLE-${suffix}`;
    const hidden = await prisma.emailOrderImport.create({
      data: {
        source: "ALIBABA_PORTAL",
        sourceHash: `${TEST_PREFIX}-TRACKING-ONLY-${suffix}`,
        sourceMessageId: `<alibaba-portal:message:${TEST_PREFIX}-${suffix}>`,
        sourceUrl: `https://message.alibaba.com/message/messenger.htm?thread=${TEST_PREFIX}-${suffix}`,
        subject: `Alibaba portal message thread ${TEST_PREFIX}`,
        rawText: `Source: Alibaba portal\nSubject: Alibaba portal message thread ${TEST_PREFIX}\nTracking Number: 7321315589070429\nConversation context: shipment started`,
        supplierName: "Send order request",
        confidence: "ESTIMATED",
        status: "NEEDS_REVIEW",
        lines: {
          create: [{ lineNo: 1, rawDescription: "Unparsed order email line", quantity: 1, currency: "USD", matchConfidence: "UNMATCHED" }]
        }
      }
    });
    const actionable = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      rawText: `
Subject: Supplier order ${actionableOrderId}
Order ID: ${actionableOrderId}
Supplier: ${TEST_PREFIX} Visible Supplier
Product: LED-COB-12V-3000K qty 2 unit price USD 1.25 total USD 2.50
Total: USD 2.50
`
    });

    const visible = await getEmailOrderImports();
    expect(visible.some((item) => item.id === hidden.id)).toBe(false);
    expect(visible.some((item) => item.id === actionable.import.id)).toBe(true);
  });

  it("keeps partially matched auto-applied multi-line emails editable instead of creating partial purchase orders", async () => {
    const orderId = `${TEST_PREFIX}-PARTIAL-${Date.now()}`;

    const imported = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: true,
      rawText: `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${TEST_PREFIX} Partial Supplier
SKU, Description, Quantity, Unit price, Total
LED-COB-12V-3000K, 12 V COB LED strip warm white, 2, USD 1.25, USD 2.50
NOT-IN-CATALOG-${Date.now()}, Unknown supplier-only spare, 4, USD 3.00, USD 12.00
Total: USD 14.50
`
    });

    expect(imported.purchaseOrder).toBeNull();
    expect(imported.import).toMatchObject({ status: "NEEDS_REVIEW", purchaseOrderId: null });
    expect(imported.import.lines).toHaveLength(2);

    const unmatched = imported.import.lines.find((line) => !line.matchedItemId);
    expect(unmatched).toBeTruthy();

    await expect(updateEmailOrderImportLine({
      lineId: unmatched!.id,
      rawDescription: "Operator can still edit unmatched partial auto-apply line",
      quantity: 4,
      unitPrice: 3,
      currency: "USD",
      actorId: `${TEST_PREFIX}-actor`
    })).resolves.toMatchObject({
      rawDescription: "Operator can still edit unmatched partial auto-apply line",
      matchConfidence: "MANUAL_NEEDS_REVIEW"
    });
  });

  it("does not revive archived ignored imports into purchase orders during duplicate auto-apply sync", async () => {
    const orderId = `${TEST_PREFIX}-ARCHIVED-AUTOAPPLY-${Date.now()}`;
    const rawText = `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${TEST_PREFIX} Archived AutoApply Supplier
Product: LED-COB-12V-3000K qty 2 unit price USD 1.25 total USD 2.50
Total: USD 2.50
`;
    const created = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      rawText
    });
    await archiveEmailOrderImport(created.import.id, `${TEST_PREFIX}-actor`, "Operator ignored duplicate supplier email");

    const duplicate = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: true,
      autoCreateInvoice: true,
      rawText
    });

    const archived = await prisma.emailOrderImport.findUniqueOrThrow({
      where: { id: created.import.id },
      include: { purchaseOrder: true }
    });
    expect(duplicate.import.id).toBe(created.import.id);
    expect(duplicate.purchaseOrder).toBeNull();
    expect(duplicate.invoice).toBeNull();
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(archived.purchaseOrder).toBeNull();
  });

  it("applies duplicate ready-import requests idempotently with only one purchase order and invoice", async () => {
    const orderId = `${TEST_PREFIX}-CONCURRENT-APPLY-${Date.now()}`;
    const supplierName = `${TEST_PREFIX} Concurrent Apply Supplier ${Date.now()}`;
    const imported = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      rawText: `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${supplierName}
Product: LED-COB-12V-3000K qty 2 unit price USD 1.25 total USD 2.50
Total: USD 2.50
`
    });

    const [first, second] = await Promise.all([
      applyAlibabaEmailOrderImport(imported.import.id, `${TEST_PREFIX}-actor`, { autoCreateInvoice: true }),
      applyAlibabaEmailOrderImport(imported.import.id, `${TEST_PREFIX}-actor`, { autoCreateInvoice: true })
    ]);

    const applied = await prisma.emailOrderImport.findUniqueOrThrow({
      where: { id: imported.import.id },
      include: { supplier: true, purchaseOrder: true }
    });
    expect(applied.status).toBe("APPLIED");
    expect(applied.purchaseOrderId).toBeTruthy();
    expect(applied.supplierId).toBeTruthy();
    expect(first.purchaseOrder?.id).toBe(applied.purchaseOrderId);
    expect(second.purchaseOrder?.id).toBe(applied.purchaseOrderId);

    const purchaseOrders = await prisma.purchaseOrder.findMany({
      where: { supplierId: applied.supplierId! },
      include: { invoices: true }
    });
    expect(purchaseOrders).toHaveLength(1);
    expect(purchaseOrders[0].id).toBe(applied.purchaseOrderId);
    expect(await prisma.supplierInvoice.count({ where: { purchaseOrderId: applied.purchaseOrderId! } })).toBe(1);
  });

  it("preserves a manually selected preferred supplier when applying an email order from another supplier", async () => {
    const suffix = Date.now();
    const orderId = `${TEST_PREFIX}-PRESERVE-MANUAL-SUPPLIER-${suffix}`;
    const storageLocation = await prisma.storageLocation.create({
      data: { code: `${TEST_PREFIX}-PRESERVE-${suffix}`, name: `${TEST_PREFIX} preserve supplier fixture` }
    });
    const manualSupplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Manual Preferred Supplier ${suffix}`,
        companyName: `${TEST_PREFIX} Manual Preferred Supplier ${suffix}`,
        confirmedByHuman: true,
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });
    const emailSupplierName = `${TEST_PREFIX} Email Order Supplier ${suffix}`;
    const item = await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-PRESERVE-SUPPLIER-ITEM-${suffix}`,
        description: "Test-only LED strip whose manually selected supplier must survive email apply",
        category: ItemCategory.COMPONENT,
        unit: Unit.EACH,
        reorderPoint: 0,
        targetStock: 0,
        leadTimeDays: 0,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        storageLocationId: storageLocation.id,
        preferredSupplierId: manualSupplier.id,
        estimatedUnitCost: 1.11,
        costCurrency: "USD",
        costConfidence: CostConfidence.CONFIRMED,
        costSourceRef: "Manual operator supplier assignment"
      }
    });

    const imported = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: true,
      autoCreateInvoice: false,
      rawText: `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${emailSupplierName}
Product: ${item.sku} qty 2 unit price USD 1.25 total USD 2.50
Total: USD 2.50
`
    });

    expect(imported.purchaseOrder?.supplierId).not.toBe(manualSupplier.id);
    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.preferredSupplierId).toBe(manualSupplier.id);
    expect(updated.costSourceRef).toContain(orderId);
  });

  it("preserves a manually selected preferred supplier when reassessing an already-applied email order", async () => {
    const suffix = Date.now();
    const orderId = `${TEST_PREFIX}-PRESERVE-REASSESS-SUPPLIER-${suffix}`;
    const storageLocation = await prisma.storageLocation.create({
      data: { code: `${TEST_PREFIX}-PRESERVE-REASSESS-${suffix}`, name: `${TEST_PREFIX} preserve reassess supplier fixture` }
    });
    const manualSupplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Manual Reassess Supplier ${suffix}`,
        companyName: `${TEST_PREFIX} Manual Reassess Supplier ${suffix}`,
        confirmedByHuman: true,
        moq: 1,
        leadTimeDays: 7,
        shippingCost: 0,
        reliabilityScore: 4.5
      }
    });
    const emailSupplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Applied Reassess Supplier ${suffix}`,
        moq: 1,
        leadTimeDays: 21,
        shippingCost: 0,
        reliabilityScore: 3
      }
    });
    const item = await prisma.item.create({
      data: {
        sku: `${TEST_PREFIX}-PRESERVE-REASSESS-ITEM-${suffix}`,
        description: "Test-only LED strip whose manual supplier must survive reassessment",
        category: ItemCategory.COMPONENT,
        unit: Unit.EACH,
        reorderPoint: 0,
        targetStock: 0,
        leadTimeDays: 0,
        lifecycleStatus: LifecycleStatus.ACTIVE,
        storageLocationId: storageLocation.id,
        preferredSupplierId: manualSupplier.id,
        estimatedUnitCost: 1.11,
        costCurrency: "USD",
        costConfidence: CostConfidence.CONFIRMED,
        costSourceRef: "Manual operator supplier assignment"
      }
    });
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        supplierId: emailSupplier.id,
        status: "ORDERED",
        lines: { create: [{ itemId: item.id, quantity: 1, unitPrice: 1.1 }] }
      }
    });
    await prisma.emailOrderImport.create({
      data: {
        sourceHash: `${TEST_PREFIX}-${orderId}-stale-applied`,
        subject: `Supplier order ${orderId}`,
        rawText: `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${emailSupplier.name}
Product: ${item.sku} qty 3 unit price USD 1.25 total USD 3.75
Total: USD 3.75
`,
        externalOrderId: orderId,
        supplierName: emailSupplier.name,
        supplierId: emailSupplier.id,
        purchaseOrderId: purchaseOrder.id,
        currency: "USD",
        totalCost: 3.75,
        confidence: CostConfidence.CONFIRMED,
        status: "APPLIED",
        lines: {
          create: [{ lineNo: 1, rawDescription: item.sku, quantity: 1, unitPrice: 1.1, lineTotal: 1.1, currency: "USD", matchedItemId: item.id, matchConfidence: "SKU" }]
        }
      }
    });

    const result = await reassessRecentEmailOrderImports(`${TEST_PREFIX}-actor`);

    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    const updated = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.preferredSupplierId).toBe(manualSupplier.id);
    expect(updated.costSourceRef).toContain(orderId);
  });

  it("keeps auto-applied imports with unsupported currencies in review instead of storing them as USD", async () => {
    const orderId = `${TEST_PREFIX}-UNSUPPORTED-CURRENCY-${Date.now()}`;

    const imported = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: true,
      autoCreateInvoice: true,
      rawText: `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${TEST_PREFIX} CNY Supplier
Product: LED-COB-12V-3000K qty 2 unit price CNY 10.00 total CNY 20.00
Total: CNY 20.00
`
    });

    expect(imported.purchaseOrder).toBeNull();
    expect(imported.invoice).toBeNull();
    expect(imported.import.status).toBe("NEEDS_REVIEW");
    expect(imported.import.purchaseOrderId).toBeNull();
  });

  it("does not merge imports whose external order ids merely contain each other", async () => {
    const longOrderId = `${TEST_PREFIX}-OVERLAP-12345-${Date.now()}`;
    const shortOrderId = longOrderId.replace("12345", "123");
    const supplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Overlap Supplier ${Date.now()}`,
        moq: 1,
        leadTimeDays: 21,
        shippingCost: 0,
        reliabilityScore: 3
      }
    });
    const existing = await prisma.emailOrderImport.create({
      data: {
        sourceHash: `${TEST_PREFIX}-${longOrderId}-existing`,
        subject: `${TEST_PREFIX} Order ${longOrderId}`,
        rawText: `Order ID: ${longOrderId}\nSupplier: ${supplier.name}\nProduct: LED qty 1 unit price USD 1.00 total USD 1.00`,
        externalOrderId: longOrderId,
        supplierName: supplier.name,
        supplierId: supplier.id,
        totalCost: 1,
        confidence: "CONFIRMED",
        status: "NEEDS_REVIEW",
        lines: { create: [{ lineNo: 1, rawDescription: "Existing overlap fixture", quantity: 1, unitPrice: 1, lineTotal: 1, currency: "USD" }] }
      }
    });

    const imported = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      rawText: `
Subject: Supplier order ${shortOrderId}
Order ID: ${shortOrderId}
Supplier: ${TEST_PREFIX} Short Overlap Supplier
Product: Magnetic puck qty 2 unit price USD 2.00 total USD 4.00
Total: USD 4.00
`
    });

    expect(imported.created).toBe(true);
    expect(imported.import.id).not.toBe(existing.id);
    expect(imported.import.externalOrderId).toBe(shortOrderId);
  });

  it("reassesses stale LED imports into missed color-temperature lines without receiving stock", async () => {
    const orderId = `${TEST_PREFIX}-LED-REASSESS-${Date.now()}`;
    const rawText = `
Subject: Your initial payment has been received (${orderId})
From: "Alibaba" <credit@notice.alibaba.com>
Your initial payment has been received (${orderId}) Hi Musashi Kaneko, The supplier ${TEST_PREFIX} LED Supplier has received your initial payment for order no. ${orderId}. View order details Total
USD 171.00
Order date
2026-04-27 17:40:29 PST
Your product and delivery information 480led 3000K 12v Cob Led Strip Lights
Quantity: 100
Variations: 1
Item subtotal: USD 68.00
View details
480led 6500K 12v Cob Led Strip Light
Quantity: 100
Variations: 1
Item subtotal: USD 68.00
View details
Order summary (2 items) View details Item subtotal USD 136.00 Shipping fee USD 35.00 Total USD 171.00 Initial payment: USD 171.00 Remaining balance: USD 0.00
`;
    const supplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} LED Supplier ${Date.now()}`,
        moq: 1,
        leadTimeDays: 21,
        shippingCost: 0,
        reliabilityScore: 3
      }
    });
    const stale = await prisma.emailOrderImport.create({
      data: {
        sourceHash: `${TEST_PREFIX}-${orderId}-stale`,
        subject: `Your initial payment has been received (${orderId})`,
        rawText,
        externalOrderId: orderId,
        supplierName: supplier.name,
        supplierId: supplier.id,
        currency: "USD",
        subtotal: 68,
        shippingCost: 35,
        totalCost: 171,
        confidence: "CONFIRMED",
        status: "IMPORTED",
        lines: {
          create: [{ lineNo: 1, rawDescription: "480led 3000K 12v Cob Led Strip Lights", quantity: 100, unitPrice: 0.68, lineTotal: 68, currency: "USD" }]
        }
      },
      include: { lines: true }
    });
    expect(stale.lines).toHaveLength(1);

    const stockMovementWhere = {
      OR: [
        { reference: { contains: orderId } },
        { reason: { contains: orderId } }
      ]
    };
    const stockMovementsBefore = await prisma.stockMovement.count({ where: stockMovementWhere });

    const result = await reassessRecentEmailOrderImports(`${TEST_PREFIX}-actor`);

    const stockMovementsAfter = await prisma.stockMovement.count({ where: stockMovementWhere });
    const refreshed = await prisma.emailOrderImport.findUniqueOrThrow({
      where: { id: stale.id },
      include: { lines: { orderBy: { lineNo: "asc" } } }
    });
    expect(result.scanned).toBeGreaterThan(0);
    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    expect(stockMovementsAfter).toBe(stockMovementsBefore);
    expect(refreshed.lines.map((line) => line.rawDescription)).toEqual([
      "480led 3000K 12v Cob Led Strip Lights",
      "480led 6500K 12v Cob Led Strip Light"
    ]);
    expect(refreshed.lines.map((line) => Number(line.unitPrice))).toEqual([0.68, 0.68]);
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-actor`, action: "REASSESS_RECENT_EMAIL_ORDER_IMPORTS" } })).resolves.toBeGreaterThan(0);
  });

  it("reassesses stale applied LED imports and updates ordered PO/invoice metadata without receiving stock", async () => {
    const orderId = `${TEST_PREFIX}-LED-APPLIED-${Date.now()}`;
    const rawText = `
Subject: Your initial payment has been received (${orderId})
From: "Alibaba" <credit@notice.alibaba.com>
Your initial payment has been received (${orderId}) Hi Musashi Kaneko, The supplier ${TEST_PREFIX} Applied LED Supplier has received your initial payment for order no. ${orderId}. View order details Total
USD 171.00
Order date
2026-04-27 17:40:29 PST
Your product and delivery information 480led 3000K 12v Cob Led Strip Lights
Quantity: 100
Variations: 1
Item subtotal: USD 68.00
View details
480led 6500K 12v Cob Led Strip Light
Quantity: 100
Variations: 1
Item subtotal: USD 68.00
View details
Order summary (2 items) View details Item subtotal USD 136.00 Shipping fee USD 35.00 Total USD 171.00 Initial payment: USD 171.00 Remaining balance: USD 0.00
`;
    const [warmItem, coolItem] = await Promise.all([
      prisma.item.findUniqueOrThrow({ where: { sku: "LED-COB-12V-3000K" } }),
      prisma.item.findUniqueOrThrow({ where: { sku: "LED-COB-12V-6500K" } })
    ]);
    const supplier = await prisma.supplier.create({
      data: {
        name: `${TEST_PREFIX} Applied LED Supplier ${Date.now()}`,
        moq: 1,
        leadTimeDays: 21,
        shippingCost: 0,
        reliabilityScore: 3
      }
    });
    const purchaseOrder = await prisma.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        status: "ORDERED",
        orderedAt: new Date("2026-04-27T17:40:29Z"),
        lines: { create: [{ itemId: warmItem.id, quantity: 50, unitPrice: 0.7 }] }
      }
    });
    const invoiceNumber = `${TEST_PREFIX}-LED-${Date.now()}`;
    await prisma.supplierInvoice.create({
      data: {
        invoiceNumber,
        invoiceNumberKey: normalizeInvoiceNumberKey(invoiceNumber),
        supplierId: supplier.id,
        purchaseOrderId: purchaseOrder.id,
        status: "RECEIVED",
        currency: "USD",
        subtotal: 68,
        shippingCost: 35,
        taxCost: 0,
        total: 171,
        lines: {
          create: [{ itemId: warmItem.id, description: `${warmItem.sku} — ${warmItem.description}`, quantity: 50, unitPrice: 0.7, lineTotal: 35 }]
        }
      }
    });
    const stale = await prisma.emailOrderImport.create({
      data: {
        sourceHash: `${TEST_PREFIX}-${orderId}-applied-stale`,
        subject: `Your initial payment has been received (${orderId})`,
        rawText,
        externalOrderId: orderId,
        supplierName: supplier.name,
        supplierId: supplier.id,
        purchaseOrderId: purchaseOrder.id,
        currency: "USD",
        subtotal: 68,
        shippingCost: 35,
        totalCost: 171,
        confidence: "CONFIRMED",
        status: "APPLIED",
        lines: {
          create: [{ lineNo: 1, rawDescription: "480led 3000K 12v Cob Led Strip Lights", quantity: 100, unitPrice: 0.68, lineTotal: 68, currency: "USD", matchedItemId: warmItem.id, matchConfidence: "ALIAS" }]
        }
      },
      include: { lines: true }
    });
    expect(stale.lines).toHaveLength(1);

    const stockMovementsBefore = await prisma.stockMovement.count();

    const result = await reassessRecentEmailOrderImports(`${TEST_PREFIX}-actor`);

    const stockMovementsAfter = await prisma.stockMovement.count();
    const refreshed = await prisma.emailOrderImport.findUniqueOrThrow({
      where: { id: stale.id },
      include: { lines: { orderBy: { lineNo: "asc" } } }
    });
    const poLines = await prisma.purchaseOrderLine.findMany({
      where: { purchaseOrderId: purchaseOrder.id },
      include: { item: true },
      orderBy: { item: { sku: "asc" } }
    });
    const invoice = await prisma.supplierInvoice.findFirstOrThrow({
      where: { purchaseOrderId: purchaseOrder.id },
      include: { lines: { include: { item: true }, orderBy: { description: "asc" } } }
    });

    expect(result.refreshed).toBeGreaterThanOrEqual(1);
    expect(stockMovementsAfter).toBe(stockMovementsBefore);
    expect(refreshed.lines).toHaveLength(2);
    expect(refreshed.lines.map((line) => line.rawDescription)).toEqual([
      "480led 3000K 12v Cob Led Strip Lights",
      "480led 6500K 12v Cob Led Strip Light"
    ]);
    expect(poLines.map((line) => ({ sku: line.item.sku, quantity: line.quantity, unitPrice: Number(line.unitPrice) }))).toEqual([
      { sku: warmItem.sku, quantity: 100, unitPrice: 0.68 },
      { sku: coolItem.sku, quantity: 100, unitPrice: 0.68 }
    ]);
    expect(invoice.lines.map((line) => ({ sku: line.item?.sku, quantity: line.quantity, unitPrice: Number(line.unitPrice) }))).toEqual([
      { sku: warmItem.sku, quantity: 100, unitPrice: 0.68 },
      { sku: coolItem.sku, quantity: 100, unitPrice: 0.68 }
    ]);
  });

  it("reassesses recent imports without overwriting manual line edits or receiving stock", async () => {
    const orderId = `${TEST_PREFIX}-REASSESS-${Date.now()}`;

    const created = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      rawText: `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${TEST_PREFIX} Reassess Supplier
Items: LED strip warm white 3000K x 2 @ USD 1.25 = USD 2.50; 12V GS/UL power adapter x 1 @ USD 3.00 = USD 3.00
Shipping: USD 1.00
Total: USD 6.50
`
    });
    const editedLine = created.import.lines[0];
    await updateEmailOrderImportLine({
      lineId: editedLine.id,
      rawDescription: "Operator corrected visual LED strip 3000K line",
      quantity: 7,
      unitPrice: 1.75,
      currency: "USD",
      actorId: `${TEST_PREFIX}-actor`
    });
    const stockMovementWhere = {
      OR: [
        { reference: { contains: orderId } },
        { reason: { contains: orderId } }
      ]
    };
    const stockMovementsBefore = await prisma.stockMovement.count({ where: stockMovementWhere });

    const result = await reassessRecentEmailOrderImports(`${TEST_PREFIX}-actor`);

    const stockMovementsAfter = await prisma.stockMovement.count({ where: stockMovementWhere });
    const refreshed = await prisma.emailOrderImport.findUniqueOrThrow({
      where: { id: created.import.id },
      include: { lines: true }
    });
    expect(result.scanned).toBeGreaterThan(0);
    expect(result.skippedManual).toBeGreaterThanOrEqual(1);
    expect(stockMovementsAfter).toBe(stockMovementsBefore);
    expect(refreshed.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: editedLine.id,
        rawDescription: "Operator corrected visual LED strip 3000K line",
        quantity: 7,
        matchConfidence: "MANUAL_NEEDS_REVIEW"
      })
    ]));
    await expect(prisma.auditLog.count({ where: { actorId: `${TEST_PREFIX}-actor`, action: "REASSESS_RECENT_EMAIL_ORDER_IMPORTS" } })).resolves.toBeGreaterThan(0);
  });

  it("can unarchive and permanently delete archived unapplied order emails", async () => {
    const orderId = `${TEST_PREFIX}-DELETE-${Date.now()}`;
    const created = await importAlibabaEmailOrder({
      actorId: `${TEST_PREFIX}-actor`,
      autoApply: false,
      rawText: `
Subject: Supplier order ${orderId}
Order ID: ${orderId}
Supplier: ${TEST_PREFIX} Delete Supplier
Product: LED-COB-12V-3000K qty 2 unit price USD 1.25 total USD 2.50
Total: USD 2.50
`
    });

    await archiveEmailOrderImport(created.import.id, `${TEST_PREFIX}-actor`, "Testing unarchive/delete");
    const restored = await unarchiveEmailOrderImport(created.import.id, `${TEST_PREFIX}-actor`);
    expect(restored.archivedAt).toBeNull();
    expect((await getEmailOrderImports()).some((item) => item.id === created.import.id)).toBe(true);

    await archiveEmailOrderImport(created.import.id, `${TEST_PREFIX}-actor`, "Testing permanent delete");
    await deleteArchivedEmailOrderImport(created.import.id, `${TEST_PREFIX}-actor`);

    await expect(prisma.emailOrderImport.findUnique({ where: { id: created.import.id } })).resolves.toBeNull();
    await expect(prisma.auditLog.count({
      where: { entityId: created.import.id, action: "DELETE_ARCHIVED_EMAIL_ORDER_IMPORT" }
    })).resolves.toBe(1);
  });
});
