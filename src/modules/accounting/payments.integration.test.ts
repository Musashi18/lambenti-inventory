import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BankTransactionStatus, GLAccountType, InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeInvoiceNumberKey } from "./invoices";
import { upsertGLAccount, upsertGLMapping } from "./gl";
import { getPaymentReconciliationDashboard, importBankTransactions, reconcileBankTransactionToInvoice } from "./payments";

const TEST_PREFIX = "TEST-ACCOUNTING-PAYMENT";
const accountingActor = {
  id: `${TEST_PREFIX}-accountant`,
  role: "ACCOUNTING" as const,
  type: "HUMAN" as const,
  actorType: "USER" as const
};

async function cleanupTestData() {
  const invoices = await prisma.supplierInvoice.findMany({ where: { invoiceNumber: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const transactions = await prisma.bankTransaction.findMany({ where: { source: { startsWith: TEST_PREFIX } }, select: { id: true } });
  const transactionIds = transactions.map((transaction) => transaction.id);
  const accountIds = (await prisma.gLAccount.findMany({ where: { code: { startsWith: TEST_PREFIX } }, select: { id: true } })).map((account) => account.id);
  if (invoiceIds.length > 0) {
    await prisma.journalEntryLine.deleteMany({ where: { journalEntry: { supplierInvoiceId: { in: invoiceIds } } } });
    await prisma.journalEntry.deleteMany({ where: { supplierInvoiceId: { in: invoiceIds } } });
  }
  if (invoiceIds.length > 0 || transactionIds.length > 0) {
    await prisma.supplierInvoicePaymentAllocation.deleteMany({
      where: {
        OR: [
          invoiceIds.length > 0 ? { supplierInvoiceId: { in: invoiceIds } } : undefined,
          transactionIds.length > 0 ? { bankTransactionId: { in: transactionIds } } : undefined
        ].filter((value): value is NonNullable<typeof value> => Boolean(value))
      }
    });
  }
  if (transactionIds.length > 0) await prisma.bankTransaction.deleteMany({ where: { id: { in: transactionIds } } });
  if (invoiceIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: invoiceIds } } });
    await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
  }
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: TEST_PREFIX } } });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
  await prisma.gLAccountMapping.deleteMany({ where: { glAccountId: { in: accountIds } } });
  if (accountIds.length > 0) await prisma.gLAccount.deleteMany({ where: { id: { in: accountIds } } });
}

async function createInvoice(input?: { total?: number; status?: InvoiceStatus; invoiceNumber?: string }) {
  const invoiceNumber = input?.invoiceNumber ?? `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8)}`;
  const total = input?.total ?? 15;
  const supplier = await prisma.supplier.create({
    data: {
      name: `${TEST_PREFIX}-${crypto.randomUUID().slice(0, 8)}-SUPPLIER`,
      confirmedByHuman: true,
      moq: 1,
      leadTimeDays: 7,
      shippingCost: 0,
      reliabilityScore: 0.95
    }
  });
  return prisma.supplierInvoice.create({
    data: {
      invoiceNumber,
      invoiceNumberKey: normalizeInvoiceNumberKey(invoiceNumber),
      supplierId: supplier.id,
      status: input?.status ?? InvoiceStatus.APPROVED,
      currency: "USD",
      subtotal: total,
      shippingCost: 0,
      taxCost: 0,
      total,
      lines: { create: [{ description: `${TEST_PREFIX} payment test line`, quantity: 1, unitPrice: total, lineTotal: total }] }
    }
  });
}

async function configurePaymentAccounts() {
  const ap = await upsertGLAccount({ code: `${TEST_PREFIX}-2000`, name: "Accounts payable", type: GLAccountType.LIABILITY, actorId: accountingActor.id });
  const bank = await upsertGLAccount({ code: `${TEST_PREFIX}-1000`, name: "Operating bank", type: GLAccountType.ASSET, actorId: accountingActor.id });
  await upsertGLMapping({ scopeType: "DEFAULT", purpose: "ACCOUNTS_PAYABLE", glAccountId: ap.id, actorId: accountingActor.id });
  await upsertGLMapping({ scopeType: "DEFAULT", purpose: "BANK_CASH", glAccountId: bank.id, actorId: accountingActor.id });
}

describe("payment reconciliation", () => {
  beforeEach(cleanupTestData);
  afterAll(cleanupTestData);

  it("imports bank transactions idempotently by source hash", async () => {
    const rows = [{
      source: `${TEST_PREFIX}-BANK-CSV`,
      accountName: "Test operating account",
      postedAt: new Date("2026-06-12T00:00:00.000Z"),
      description: "Wire transfer to supplier",
      counterparty: `${TEST_PREFIX} supplier`,
      currency: "USD",
      amount: -15,
      reference: "WIRE-TEST-001"
    }];

    const first = await importBankTransactions({ rows, actor: accountingActor });
    const second = await importBankTransactions({ rows, actor: accountingActor });

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(1);
    await expect(prisma.bankTransaction.count({ where: { source: `${TEST_PREFIX}-BANK-CSV` } })).resolves.toBe(1);
  });

  it("reconciles an approved invoice from an explicit bank transaction without stock side effects", async () => {
    const invoice = await createInvoice({ total: 15, invoiceNumber: `${TEST_PREFIX}-RECONCILE-INV` });
    await configurePaymentAccounts();
    const imported = await importBankTransactions({
      rows: [{
        source: `${TEST_PREFIX}-RECONCILE-BANK`,
        postedAt: new Date("2026-06-13T00:00:00.000Z"),
        description: `Payment for ${invoice.invoiceNumber}`,
        counterparty: `${TEST_PREFIX} supplier`,
        currency: "USD",
        amount: -15,
        reference: "WIRE-RECONCILE-001"
      }],
      actor: accountingActor
    });

    const stockMovementCountBefore = await prisma.stockMovement.count();
    const allocation = await reconcileBankTransactionToInvoice({
      bankTransactionId: imported.transactions[0].id,
      supplierInvoiceId: invoice.id,
      actor: accountingActor
    });

    expect(Number(allocation.amount.toString())).toBe(15);
    await expect(prisma.bankTransaction.findUniqueOrThrow({ where: { id: imported.transactions[0].id } })).resolves.toMatchObject({ status: BankTransactionStatus.MATCHED });
    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({
      status: InvoiceStatus.PAID,
      paymentReference: "WIRE-RECONCILE-001",
      paidBy: accountingActor.id
    });
    await expect(prisma.stockMovement.count()).resolves.toBe(stockMovementCountBefore);
  });

  it("blocks over-allocation and keeps a partial payment approved", async () => {
    const invoice = await createInvoice({ total: 20, invoiceNumber: `${TEST_PREFIX}-PARTIAL-INV` });
    await configurePaymentAccounts();
    const imported = await importBankTransactions({
      rows: [{
        source: `${TEST_PREFIX}-PARTIAL-BANK`,
        postedAt: new Date("2026-06-14T00:00:00.000Z"),
        description: "Partial wire transfer",
        currency: "USD",
        amount: -5,
        reference: "WIRE-PARTIAL-001"
      }],
      actor: accountingActor
    });

    await reconcileBankTransactionToInvoice({ bankTransactionId: imported.transactions[0].id, supplierInvoiceId: invoice.id, actor: accountingActor });
    await expect(prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).resolves.toMatchObject({ status: InvoiceStatus.APPROVED });

    await expect(reconcileBankTransactionToInvoice({
      supplierInvoiceId: invoice.id,
      amount: 16,
      reference: "MANUAL-OVERPAY",
      paidAt: new Date("2026-06-15T00:00:00.000Z"),
      actor: accountingActor
    })).rejects.toThrow(/over-allocate/i);
  });

  it("surfaces imported transactions and only approved invoices as reconcilable dashboard options", async () => {
    const approvedInvoice = await createInvoice({ total: 42, invoiceNumber: `${TEST_PREFIX}-DASHBOARD-APPROVED-INV`, status: InvoiceStatus.APPROVED });
    const receivedInvoice = await createInvoice({ total: 24, invoiceNumber: `${TEST_PREFIX}-DASHBOARD-RECEIVED-INV`, status: InvoiceStatus.RECEIVED });
    await importBankTransactions({
      rows: [{
        source: `${TEST_PREFIX}-DASHBOARD-BANK`,
        postedAt: new Date("2026-06-15T00:00:00.000Z"),
        description: `Payment for ${approvedInvoice.invoiceNumber}`,
        currency: "USD",
        amount: -42,
        reference: "WIRE-DASHBOARD-001"
      }],
      actor: accountingActor
    });

    const dashboard = await getPaymentReconciliationDashboard();

    expect(dashboard.importedTransactions.some((transaction) => transaction.reference === "WIRE-DASHBOARD-001")).toBe(true);
    expect(dashboard.approvedInvoices.some((candidate) => candidate.id === approvedInvoice.id)).toBe(true);
    expect(dashboard.approvedInvoices.some((candidate) => candidate.id === receivedInvoice.id)).toBe(false);
    expect(dashboard.receivedInvoices.some((candidate) => candidate.id === receivedInvoice.id)).toBe(true);
  });
});
