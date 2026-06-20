import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ItemCategory, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInvoiceFromPurchaseOrder, getInvoiceDashboard, normalizeInvoiceNumberKey } from "./invoices";

const TEST_PREFIX = "TEST-ACCOUNTING-INVOICE";

async function cleanupTestData() {
  const invoices = await prisma.supplierInvoice.findMany({
    where: { invoiceNumber: { startsWith: TEST_PREFIX } },
    select: { id: true, purchaseOrderId: true }
  });
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const suppliers = await prisma.supplier.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const itemIds = items.map((item) => item.id);
  const ordersBySupplier = supplierIds.length > 0
    ? await prisma.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } })
    : [];
  const ordersByItem = itemIds.length > 0
    ? await prisma.purchaseOrderLine.findMany({ where: { itemId: { in: itemIds } }, select: { purchaseOrderId: true } })
    : [];
  const orderIds = Array.from(new Set([
    ...invoices.map((invoice) => invoice.purchaseOrderId).filter((id): id is string => Boolean(id)),
    ...ordersBySupplier.map((order) => order.id),
    ...ordersByItem.map((line) => line.purchaseOrderId)
  ]));

  if (invoiceIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: invoiceIds } } });
    await prisma.supplierInvoicePaymentAllocation.deleteMany({ where: { supplierInvoiceId: { in: invoiceIds } } });
    await prisma.accountingDocument.updateMany({ where: { supplierInvoiceId: { in: invoiceIds } }, data: { supplierInvoiceId: null } });
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  if (orderIds.length > 0) {
    await prisma.accountingDocument.updateMany({ where: { purchaseOrderId: { in: orderIds } }, data: { purchaseOrderId: null } });
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  }
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createPurchaseOrderFixture(suffix: string, supplierName?: string) {
  const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `${TEST_PREFIX} location ${suffix}` } });
  const supplier = await prisma.supplier.create({
    data: {
      name: supplierName ?? `${TEST_PREFIX}-${suffix}-SUPPLIER`,
      companyName: supplierName ?? `${TEST_PREFIX}-${suffix} Supplier Inc.`,
      confirmedByHuman: true,
      moq: 1,
      leadTimeDays: 7,
      shippingCost: 0,
      reliabilityScore: 0.95
    }
  });
  const item = await prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `${TEST_PREFIX} item ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      storageLocationId: location.id
    }
  });
  const order = await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      status: "ORDERED",
      orderedAt: new Date("2026-06-08T00:00:00.000Z"),
      lines: { create: [{ itemId: item.id, quantity: 10, unitPrice: 2 }] }
    }
  });
  return { supplier, item, order };
}

describe("supplier invoice identity and order-unique invoice merging", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("normalizes invoice numbers for supplier-scoped duplicate prevention", () => {
    expect(normalizeInvoiceNumberKey(" inv  001-a ")).toBe("INV 001-A");
  });

  it("allows the same supplier invoice number for different suppliers", async () => {
    const first = await createPurchaseOrderFixture("SUPPLIER-A");
    const second = await createPurchaseOrderFixture("SUPPLIER-B");

    const firstInvoice = await createInvoiceFromPurchaseOrder(first.order.id, `${TEST_PREFIX}-actor`, { invoiceNumber: `${TEST_PREFIX}-DUPLICATE-INV` });
    const secondInvoice = await createInvoiceFromPurchaseOrder(second.order.id, `${TEST_PREFIX}-actor`, { invoiceNumber: `${TEST_PREFIX}-DUPLICATE-INV` });

    expect(firstInvoice.id).not.toBe(secondInvoice.id);
    expect(firstInvoice.invoiceNumber).toBe(secondInvoice.invoiceNumber);
    expect(firstInvoice.supplierId).not.toBe(secondInvoice.supplierId);
    await expect(prisma.supplierInvoice.count({ where: { invoiceNumber: `${TEST_PREFIX}-DUPLICATE-INV` } })).resolves.toBe(2);
  });

  it("dedupes the same supplier invoice number across multiple POs for one supplier", async () => {
    const first = await createPurchaseOrderFixture("SAME-SUPPLIER-A", `${TEST_PREFIX}-SAME-SUPPLIER`);
    const secondOrder = await prisma.purchaseOrder.create({
      data: {
        supplierId: first.supplier.id,
        status: "ORDERED",
        orderedAt: new Date("2026-06-09T00:00:00.000Z"),
        lines: { create: [{ itemId: first.item.id, quantity: 3, unitPrice: 4 }] }
      }
    });

    const firstInvoice = await createInvoiceFromPurchaseOrder(first.order.id, `${TEST_PREFIX}-actor`, { invoiceNumber: `${TEST_PREFIX}-SAME-SUPPLIER-INV` });
    const duplicate = await createInvoiceFromPurchaseOrder(secondOrder.id, `${TEST_PREFIX}-actor`, { invoiceNumber: ` ${TEST_PREFIX}-same-supplier-inv ` });

    expect(duplicate.id).toBe(firstInvoice.id);
    await expect(prisma.supplierInvoice.count({ where: { supplierId: first.supplier.id, invoiceNumberKey: normalizeInvoiceNumberKey(`${TEST_PREFIX}-SAME-SUPPLIER-INV`) } })).resolves.toBe(1);
  });

  it("merges multiple bill sources against one purchase order without receiving stock", async () => {
    const { order, item } = await createPurchaseOrderFixture("MULTI-PO");
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

    const firstSource = await createInvoiceFromPurchaseOrder(order.id, `${TEST_PREFIX}-actor`, {
      invoiceNumber: `${TEST_PREFIX}-MULTI-PO-FIRST`,
      subtotal: 5,
      total: 5,
      sourceDocumentHash: `${TEST_PREFIX}-MULTI-PO-HASH-A`,
      notes: "First source invoice"
    });
    const secondSource = await createInvoiceFromPurchaseOrder(order.id, `${TEST_PREFIX}-actor`, {
      invoiceNumber: `${TEST_PREFIX}-MULTI-PO-SECOND`,
      subtotal: 15,
      total: 15,
      sourceDocumentHash: `${TEST_PREFIX}-MULTI-PO-HASH-B`,
      notes: "Second source invoice"
    });

    expect(secondSource.id).toBe(firstSource.id);
    await expect(prisma.supplierInvoice.count({ where: { purchaseOrderId: order.id } })).resolves.toBe(1);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);

    const merged = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: firstSource.id } });
    expect(merged.sourceDocumentHash).toBe(`${TEST_PREFIX}-MULTI-PO-HASH-A`);
    expect(merged.notes).toContain("First source invoice");
    expect(merged.notes).toContain("Merged source: Second source invoice");

    const dashboard = await getInvoiceDashboard();
    const dashboardOrder = dashboard.uninvoicedPurchaseOrders.find((candidate) => candidate.id === order.id);
    expect(dashboardOrder?.invoices).toHaveLength(1);
  });
});
