import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CustomerInvoiceStatus, ItemCategory, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createCustomerInvoice, getCustomerInvoiceDashboard, updateCustomerInvoiceStatus } from "./customer-invoices";

const TEST_PREFIX = "TEST-ACCOUNTING-AR";
const accountingActor = {
  id: `${TEST_PREFIX}-accountant`,
  role: "ACCOUNTING" as const,
  type: "HUMAN" as const,
  actorType: "USER" as const
};

async function cleanupTestData() {
  const invoices = await prisma.customerInvoice.findMany({ where: { invoiceNumber: { startsWith: TEST_PREFIX } }, select: { id: true, customerId: true } });
  const invoiceIds = invoices.map((invoice) => invoice.id);
  if (invoiceIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: invoiceIds } } });
    await prisma.customerInvoiceLine.deleteMany({ where: { customerInvoiceId: { in: invoiceIds } } });
    await prisma.customerInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  await prisma.customer.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.item.deleteMany({ where: { sku: { startsWith: TEST_PREFIX } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createItem(suffix: string) {
  const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `${TEST_PREFIX} ${suffix}` } });
  return prisma.item.create({
    data: {
      sku: `${TEST_PREFIX}-${suffix}-ITEM`,
      description: `${TEST_PREFIX} sellable item ${suffix}`,
      category: ItemCategory.FINISHED_GOOD,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      storageLocationId: location.id
    }
  });
}

describe("AR customer invoices", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("creates customer invoices with item-linked lines without mutating stock", async () => {
    const item = await createItem("CREATE");
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

    const invoice = await createCustomerInvoice({
      customerName: `${TEST_PREFIX} Customer`,
      invoiceNumber: `${TEST_PREFIX}-CREATE-INV`,
      currency: "CAD",
      invoiceDate: new Date("2026-06-20T00:00:00.000Z"),
      dueDate: new Date("2026-07-20T00:00:00.000Z"),
      lines: [{ itemId: item.id, description: item.description, quantity: 2, unitPrice: 99, taxRate: 0.13 }],
      actor: accountingActor
    });

    expect(invoice).toMatchObject({
      invoiceNumber: `${TEST_PREFIX}-CREATE-INV`,
      status: CustomerInvoiceStatus.DRAFT,
      currency: "CAD"
    });
    expect(Number(invoice.subtotal.toString())).toBe(198);
    expect(Number(invoice.taxCost.toString())).toBeCloseTo(25.74, 2);
    expect(Number(invoice.total.toString())).toBeCloseTo(223.74, 2);
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
  });

  it("requires a payment reference before marking a sent customer invoice paid", async () => {
    const invoice = await createCustomerInvoice({
      customerName: `${TEST_PREFIX} Payment Customer`,
      invoiceNumber: `${TEST_PREFIX}-PAYMENT-INV`,
      lines: [{ description: "Lambenti package", quantity: 1, unitPrice: 99, taxRate: 0.13 }],
      actor: accountingActor
    });
    await updateCustomerInvoiceStatus({ customerInvoiceId: invoice.id, status: CustomerInvoiceStatus.SENT, actor: accountingActor });

    await expect(updateCustomerInvoiceStatus({ customerInvoiceId: invoice.id, status: CustomerInvoiceStatus.PAID, actor: accountingActor })).rejects.toThrow(/payment reference/i);
    const paid = await updateCustomerInvoiceStatus({ customerInvoiceId: invoice.id, status: CustomerInvoiceStatus.PAID, paymentReference: "CUSTOMER-ETRANSFER-001", actor: accountingActor });

    expect(paid).toMatchObject({
      status: CustomerInvoiceStatus.PAID,
      paymentReference: "CUSTOMER-ETRANSFER-001",
      paidBy: accountingActor.id
    });
  });

  it("lists open AR invoices on the customer invoice dashboard", async () => {
    const invoice = await createCustomerInvoice({
      customerName: `${TEST_PREFIX} Dashboard Customer`,
      invoiceNumber: `${TEST_PREFIX}-DASHBOARD-INV`,
      lines: [{ description: "Lambenti package", quantity: 1, unitPrice: 99, taxRate: 0.13 }],
      actor: accountingActor
    });
    await updateCustomerInvoiceStatus({ customerInvoiceId: invoice.id, status: CustomerInvoiceStatus.SENT, actor: accountingActor });

    const dashboard = await getCustomerInvoiceDashboard();

    expect(dashboard.openInvoices.some((candidate) => candidate.id === invoice.id)).toBe(true);
    expect(Number(dashboard.totalsByStatus.SENT?.toString())).toBeCloseTo(111.87, 2);
  });
});
