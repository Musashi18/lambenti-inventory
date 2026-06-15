import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceStatus, GLAccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeInvoiceNumberKey } from "@/modules/accounting/invoices";
import { upsertGLAccount, upsertGLMapping } from "@/modules/accounting/gl";
import { updateInvoiceStatusAction } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const TEST_PREFIX = "TEST-INVOICE-ACTION";

async function cleanupTestData() {
  const invoices = await prisma.supplierInvoice.findMany({
    where: { invoiceNumber: { startsWith: TEST_PREFIX } },
    select: { id: true, purchaseOrderId: true }
  });
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const orderIds = invoices.map((invoice) => invoice.purchaseOrderId).filter((id): id is string => Boolean(id));
  const suppliers = await prisma.supplier.findMany({
    where: { name: { startsWith: TEST_PREFIX } },
    select: { id: true }
  });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const accountIds = (await prisma.gLAccount.findMany({ where: { code: { startsWith: TEST_PREFIX } }, select: { id: true } })).map((account) => account.id);

  if (invoiceIds.length > 0) {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntry: { supplierInvoiceId: { in: invoiceIds } } } });
    await prisma.journalEntry.deleteMany({ where: { supplierInvoiceId: { in: invoiceIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: invoiceIds } } });
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  if (orderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (supplierIds.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  }
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
  await prisma.gLAccountMapping.deleteMany({ where: { glAccountId: { in: accountIds } } });
  if (accountIds.length > 0) await prisma.gLAccount.deleteMany({ where: { id: { in: accountIds } } });
}

async function createInvoice(status: InvoiceStatus = InvoiceStatus.RECEIVED) {
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8)}-SUPPLIER`,
      moq: 1,
      leadTimeDays: 5,
      shippingCost: 0,
      reliabilityScore: 0.9
    }
  });
  const invoiceNumber = `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8)}`;
  return prisma.supplierInvoice.create({
    data: {
      invoiceNumber,
      invoiceNumberKey: normalizeInvoiceNumberKey(invoiceNumber),
      supplierId: supplier.id,
      status,
      currency: "USD",
      subtotal: 12,
      shippingCost: 0,
      taxCost: 0,
      total: 12,
      lines: {
        create: [{ description: "Invoice action test line", quantity: 3, unitPrice: 4, lineTotal: 12 }]
      }
    }
  });
}

function formDataFor(invoiceId: string, status: InvoiceStatus, extra?: Record<string, string>) {
  const formData = new FormData();
  formData.set("invoiceId", invoiceId);
  formData.set("status", status);
  for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value);
  return formData;
}

async function configurePaymentAccounts() {
  const ap = await upsertGLAccount({ code: `${TEST_PREFIX}-2000`, name: "Accounts payable", type: GLAccountType.LIABILITY, actorId: `${TEST_PREFIX}-accountant` });
  const bank = await upsertGLAccount({ code: `${TEST_PREFIX}-1000`, name: "Operating bank", type: GLAccountType.ASSET, actorId: `${TEST_PREFIX}-accountant` });
  await upsertGLMapping({ scopeType: "DEFAULT", purpose: "ACCOUNTS_PAYABLE", glAccountId: ap.id, actorId: `${TEST_PREFIX}-accountant` });
  await upsertGLMapping({ scopeType: "DEFAULT", purpose: "BANK_CASH", glAccountId: bank.id, actorId: `${TEST_PREFIX}-accountant` });
}

describe("invoice server-action authorization and state machine", () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTestData();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await cleanupTestData();
  });

  it("blocks AGENT from approving invoices and leaves invoice/audit unchanged", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "AGENT");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-agent`);
    const invoice = await createInvoice(InvoiceStatus.RECEIVED);

    await expect(updateInvoiceStatusAction(formDataFor(invoice.id, InvoiceStatus.APPROVED))).rejects.toThrow(/permission/i);

    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({
      status: InvoiceStatus.RECEIVED
    });
    await expect(prisma.auditLog.count({ where: { entityId: invoice.id } })).resolves.toBe(0);
  });

  it("requires a payment reference before marking an approved invoice paid", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "ACCOUNTING");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-accountant`);
    const invoice = await createInvoice(InvoiceStatus.APPROVED);

    await expect(updateInvoiceStatusAction(formDataFor(invoice.id, InvoiceStatus.PAID))).rejects.toThrow(/payment reference/i);

    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({
      status: InvoiceStatus.APPROVED
    });
  });

  it("records authenticated accounting actor and payment reference when marking paid", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "ACCOUNTING");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-accountant`);
    const invoice = await createInvoice(InvoiceStatus.APPROVED);
    await configurePaymentAccounts();

    await updateInvoiceStatusAction(formDataFor(invoice.id, InvoiceStatus.PAID, { paymentReference: "WIRE-2026-001" }));

    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({
      status: InvoiceStatus.PAID,
      paymentReference: "WIRE-2026-001",
      paidBy: `${TEST_PREFIX}-accountant`
    });
    await expect(prisma.auditLog.findFirstOrThrow({ where: { entityId: invoice.id, action: "UPDATE_SUPPLIER_INVOICE_STATUS" } })).resolves.toMatchObject({
      actorId: `${TEST_PREFIX}-accountant`
    });
  });

  it("rejects invalid invoice transitions", async () => {
    vi.stubEnv("LAMBENTI_DEV_USER_ROLE", "ACCOUNTING");
    vi.stubEnv("LAMBENTI_DEV_USER_ID", `${TEST_PREFIX}-accountant`);
    const invoice = await createInvoice(InvoiceStatus.PAID);

    await expect(updateInvoiceStatusAction(formDataFor(invoice.id, InvoiceStatus.APPROVED))).rejects.toThrow(/cannot transition/i);
  });
});
