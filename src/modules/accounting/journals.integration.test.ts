import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GLAccountType, InvoiceStatus, ItemCategory, Unit } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { upsertGLAccount, upsertGLMapping } from "./gl";
import { normalizeInvoiceNumberKey, updateInvoiceStatus } from "./invoices";
import { importBankTransactions, reconcileBankTransactionToInvoice } from "./payments";
import { getJournalDashboard, formatJournalEntryCsv } from "./journals";

const TEST_PREFIX = "TEST-ACCOUNTING-JOURNAL";
const accountingActor = {
  id: `${TEST_PREFIX}-accountant`,
  role: "ACCOUNTING" as const,
  type: "HUMAN" as const,
  actorType: "USER" as const
};

type PrismaWithJournals = typeof prisma & {
  journalEntry: {
    findMany: (args?: unknown) => Promise<Array<{
      id: string;
      entryNumber: string;
      kind: string;
      status: string;
      totalDebit: { toString(): string };
      totalCredit: { toString(): string };
      lines: Array<{
        lineNo: number;
        description: string;
        debit: { toString(): string };
        credit: { toString(): string };
        accountCodeSnapshot: string;
      }>;
    }>>;
    count: (args?: unknown) => Promise<number>;
  };
  journalEntryLine: {
    deleteMany: (args?: unknown) => Promise<unknown>;
  };
};

const prismaWithJournals = prisma as PrismaWithJournals;

async function cleanupTestData() {
  const invoices = await prisma.supplierInvoice.findMany({ where: { invoiceNumber: { startsWith: TEST_PREFIX } }, select: { id: true, purchaseOrderId: true } });
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const suppliers = await prisma.supplier.findMany({ where: { name: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const items = await prisma.item.findMany({ where: { sku: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const supplierIds = suppliers.map((supplier) => supplier.id);
  const itemIds = items.map((item) => item.id);
  const orderIds = invoices.map((invoice) => invoice.purchaseOrderId).filter((id): id is string => Boolean(id));
  const accountIds = (await prisma.gLAccount.findMany({ where: { code: { startsWith: TEST_PREFIX } }, select: { id: true } })).map((account) => account.id);
  const transactions = await prisma.bankTransaction.findMany({ where: { source: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const transactionIds = transactions.map((transaction) => transaction.id);

  if ("journalEntryLine" in prismaWithJournals) await prismaWithJournals.journalEntryLine.deleteMany({ where: { journalEntry: { OR: [{ supplierInvoiceId: { in: invoiceIds } }, { sourceReference: { startsWith: TEST_PREFIX } }] } } });
  if ("journalEntry" in prismaWithJournals) await (prismaWithJournals.journalEntry as { deleteMany: (args?: unknown) => Promise<unknown> }).deleteMany({ where: { OR: [{ supplierInvoiceId: { in: invoiceIds } }, { sourceReference: { startsWith: TEST_PREFIX } }] } });
  if (invoiceIds.length > 0 || transactionIds.length > 0) await prisma.supplierInvoicePaymentAllocation.deleteMany({ where: { OR: [invoiceIds.length ? { supplierInvoiceId: { in: invoiceIds } } : undefined, transactionIds.length ? { bankTransactionId: { in: transactionIds } } : undefined].filter((value): value is NonNullable<typeof value> => Boolean(value)) } });
  if (transactionIds.length > 0) await prisma.bankTransaction.deleteMany({ where: { id: { in: transactionIds } } });
  if (invoiceIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: invoiceIds } } });
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  if (orderIds.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  if (itemIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.stockLot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (supplierIds.length > 0) await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  await prisma.gLAccountMapping.deleteMany({ where: { glAccountId: { in: accountIds } } });
  if (accountIds.length > 0) await prisma.gLAccount.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.storageLocation.deleteMany({ where: { code: { startsWith: TEST_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
}

async function createInvoiceFixture(suffix: string) {
  const location = await prisma.storageLocation.create({ data: { code: `${TEST_PREFIX}-${suffix}-LOC`, name: `${TEST_PREFIX} ${suffix}` } });
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-${suffix}-SUPPLIER`,
      companyName: `${TEST_PREFIX}-${suffix} Supplier Inc.`,
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
      description: `${TEST_PREFIX} component ${suffix}`,
      category: ItemCategory.COMPONENT,
      unit: Unit.EACH,
      reorderPoint: 0,
      targetStock: 0,
      leadTimeDays: 0,
      storageLocationId: location.id
    }
  });
  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      status: "ORDERED",
      orderedAt: new Date("2026-06-18T00:00:00.000Z"),
      lines: { create: [{ itemId: item.id, quantity: 2, unitPrice: 50 }] }
    },
    include: { lines: true }
  });
  const invoiceNumber = `${TEST_PREFIX}-${suffix}-INV`;
  const invoice = await prisma.supplierInvoice.create({
    data: {
      invoiceNumber,
      invoiceNumberKey: normalizeInvoiceNumberKey(invoiceNumber),
      supplierId: supplier.id,
      purchaseOrderId: purchaseOrder.id,
      status: InvoiceStatus.RECEIVED,
      currency: "USD",
      subtotal: 100,
      shippingCost: 0,
      taxCost: 13,
      taxRecoverableAmount: 13,
      total: 113,
      invoiceDate: new Date("2026-06-19T00:00:00.000Z"),
      sourceDocumentHash: `${TEST_PREFIX}-${suffix}-HASH`,
      lines: { create: [{ itemId: item.id, purchaseOrderLineId: purchaseOrder.lines[0].id, description: item.sku, quantity: 2, unitPrice: 50, lineTotal: 100 }] }
    },
    include: { lines: true }
  });
  return { item, purchaseOrder, invoice };
}

async function configureJournalAccounts() {
  const inventory = await upsertGLAccount({ code: `${TEST_PREFIX}-1300`, name: "Inventory in transit", type: GLAccountType.ASSET, actorId: accountingActor.id });
  const tax = await upsertGLAccount({ code: `${TEST_PREFIX}-1060`, name: "GST/HST receivable", type: GLAccountType.ASSET, actorId: accountingActor.id });
  const ap = await upsertGLAccount({ code: `${TEST_PREFIX}-2000`, name: "Accounts payable", type: GLAccountType.LIABILITY, actorId: accountingActor.id });
  const bank = await upsertGLAccount({ code: `${TEST_PREFIX}-1000`, name: "Operating bank", type: GLAccountType.ASSET, actorId: accountingActor.id });
  await upsertGLMapping({ scopeType: "DEFAULT", purpose: "INVENTORY_ASSET", glAccountId: inventory.id, actorId: accountingActor.id });
  await upsertGLMapping({ scopeType: "DEFAULT", purpose: "TAX_RECOVERABLE", glAccountId: tax.id, actorId: accountingActor.id });
  await upsertGLMapping({ scopeType: "DEFAULT", purpose: "ACCOUNTS_PAYABLE", glAccountId: ap.id, actorId: accountingActor.id });
  await upsertGLMapping({ scopeType: "DEFAULT", purpose: "BANK_CASH", glAccountId: bank.id, actorId: accountingActor.id });
  return { inventory, tax, ap, bank };
}

describe("balanced accounting journals", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("posts a balanced AP invoice journal on human invoice approval without stock side effects", async () => {
    const { invoice, item, purchaseOrder } = await createInvoiceFixture("APPROVAL");
    const accounts = await configureJournalAccounts();
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });
    const receivedQuantityBefore = purchaseOrder.lines[0].receivedQuantity;

    const approved = await updateInvoiceStatus({ invoiceId: invoice.id, status: InvoiceStatus.APPROVED, actor: accountingActor, approvalNotes: "Reviewed source evidence" });

    expect(approved.status).toBe(InvoiceStatus.APPROVED);
    const entries = await prismaWithJournals.journalEntry.findMany({ where: { supplierInvoiceId: invoice.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "AP_INVOICE", status: "POSTED" });
    expect(Number(entries[0].totalDebit.toString())).toBeCloseTo(113, 2);
    expect(Number(entries[0].totalCredit.toString())).toBeCloseTo(113, 2);
    expect(entries[0].lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountCodeSnapshot: accounts.inventory.code, debit: expect.anything(), credit: expect.anything() }),
      expect.objectContaining({ accountCodeSnapshot: accounts.tax.code, debit: expect.anything(), credit: expect.anything() }),
      expect.objectContaining({ accountCodeSnapshot: accounts.ap.code, debit: expect.anything(), credit: expect.anything() })
    ]));
    expect(entries[0].lines.find((line) => line.accountCodeSnapshot === accounts.inventory.code)?.debit.toString()).toBe("100");
    expect(entries[0].lines.find((line) => line.accountCodeSnapshot === accounts.tax.code)?.debit.toString()).toBe("13");
    expect(entries[0].lines.find((line) => line.accountCodeSnapshot === accounts.ap.code)?.credit.toString()).toBe("113");
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
    await expect(prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: purchaseOrder.lines[0].id } })).resolves.toMatchObject({ receivedQuantity: receivedQuantityBefore });
  });

  it("blocks invoice approval with a clear setup error when required GL mappings are missing", async () => {
    const { invoice } = await createInvoiceFixture("MISSING-MAPPING");
    await upsertGLAccount({ code: `${TEST_PREFIX}-ONLY`, name: "Only inventory", type: GLAccountType.ASSET, actorId: accountingActor.id });

    await expect(updateInvoiceStatus({ invoiceId: invoice.id, status: InvoiceStatus.APPROVED, actor: accountingActor })).rejects.toThrow(/ACCOUNTS_PAYABLE|TAX_RECOVERABLE|INVENTORY_ASSET/i);
    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: InvoiceStatus.RECEIVED });
    await expect(prismaWithJournals.journalEntry.count({ where: { supplierInvoiceId: invoice.id } })).resolves.toBe(0);
  });

  it("posts payment journals only when a bank transaction is explicitly reconciled", async () => {
    const { invoice, item } = await createInvoiceFixture("PAYMENT");
    const accounts = await configureJournalAccounts();
    await updateInvoiceStatus({ invoiceId: invoice.id, status: InvoiceStatus.APPROVED, actor: accountingActor });
    const imported = await importBankTransactions({
      rows: [{ source: `${TEST_PREFIX}-PAYMENT-BANK`, postedAt: new Date("2026-06-20T00:00:00.000Z"), description: `Wire for ${invoice.invoiceNumber}`, currency: "USD", amount: -113, reference: `${TEST_PREFIX}-WIRE-001` }],
      actor: accountingActor
    });
    await expect(prismaWithJournals.journalEntry.count({ where: { kind: "AP_PAYMENT", supplierInvoiceId: invoice.id } })).resolves.toBe(0);
    const stockMovementCountBefore = await prisma.stockMovement.count({ where: { itemId: item.id } });

    const allocation = await reconcileBankTransactionToInvoice({ bankTransactionId: imported.transactions[0].id, supplierInvoiceId: invoice.id, actor: accountingActor });

    const entries = await prismaWithJournals.journalEntry.findMany({ where: { kind: "AP_PAYMENT", supplierInvoiceId: invoice.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    expect(Number(allocation.amount.toString())).toBe(113);
    expect(entries).toHaveLength(1);
    expect(entries[0].lines.find((line) => line.accountCodeSnapshot === accounts.ap.code)?.debit.toString()).toBe("113");
    expect(entries[0].lines.find((line) => line.accountCodeSnapshot === accounts.bank.code)?.credit.toString()).toBe("113");
    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: InvoiceStatus.PAID, paymentReference: `${TEST_PREFIX}-WIRE-001` });
    await expect(prisma.stockMovement.count({ where: { itemId: item.id } })).resolves.toBe(stockMovementCountBefore);
  });

  it("summarizes posted journals and exports accountant-review CSV rows", async () => {
    const { invoice } = await createInvoiceFixture("DASHBOARD");
    await configureJournalAccounts();
    await updateInvoiceStatus({ invoiceId: invoice.id, status: InvoiceStatus.APPROVED, actor: accountingActor });

    const dashboard = await getJournalDashboard({ from: new Date("2026-06-01T00:00:00.000Z"), to: new Date("2026-06-30T23:59:59.999Z") });
    const entry = dashboard.entries.find((candidate) => candidate.supplierInvoiceId === invoice.id);
    const csv = formatJournalEntryCsv(dashboard.entries.filter((candidate) => candidate.supplierInvoiceId === invoice.id));

    expect(entry?.status).toBe("POSTED");
    expect(dashboard.trialBalance.totalDebit).toBeGreaterThan(0);
    expect(dashboard.trialBalance.outOfBalance).toBeCloseTo(0, 2);
    expect(csv).toContain("entryNumber,entryDate,kind,status,lineNo,accountCode");
    expect(csv).toContain(invoice.invoiceNumber);
  });
});
