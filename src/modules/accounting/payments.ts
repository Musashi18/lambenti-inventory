import { createHash } from "node:crypto";
import { BankTransactionStatus, InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertPermission, type AuthenticatedActor } from "@/modules/auth/permissions";
import { normalizeCurrencyCode } from "@/modules/currency";
import { postSupplierPaymentJournal } from "./journals";

export type BankTransactionImportRow = {
  source: string;
  sourceHash?: string;
  accountName?: string;
  postedAt: Date;
  description: string;
  counterparty?: string;
  currency?: string;
  amount: Prisma.Decimal.Value;
  reference?: string;
};

export async function importBankTransactions(input: { rows: BankTransactionImportRow[]; actor: AuthenticatedActor }) {
  assertPermission(input.actor, "invoice:markPaid");
  const transactions = [];
  let created = 0;
  let duplicates = 0;

  for (const row of input.rows) {
    const normalized = normalizeBankTransactionRow(row);
    const existing = await prisma.bankTransaction.findUnique({ where: { sourceHash: normalized.sourceHash } });
    if (existing) {
      duplicates += 1;
      transactions.push(existing);
      continue;
    }

    const transaction = await prisma.bankTransaction.create({
      data: normalized
    });
    created += 1;
    transactions.push(transaction);
    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "IMPORT_BANK_TRANSACTION",
      entityType: "BankTransaction",
      entityId: transaction.id,
      payload: { source: transaction.source, sourceHash: transaction.sourceHash, amount: transaction.amount.toString(), reference: transaction.reference }
    });
  }

  return { transactions, created, duplicates };
}

export async function getPaymentReconciliationDashboard() {
  const [importedTransactions, invoices] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { status: BankTransactionStatus.IMPORTED },
      orderBy: { postedAt: "desc" },
      take: 100
    }),
    prisma.supplierInvoice.findMany({
      where: { status: { in: [InvoiceStatus.RECEIVED, InvoiceStatus.APPROVED] } },
      include: { supplier: true, paymentAllocations: true },
      orderBy: { invoiceDate: "desc" },
      take: 100
    })
  ]);
  const approvedInvoices = invoices.filter((invoice) => invoice.status === InvoiceStatus.APPROVED);
  const receivedInvoices = invoices.filter((invoice) => invoice.status === InvoiceStatus.RECEIVED);

  return { importedTransactions, approvedInvoices, receivedInvoices, openInvoices: approvedInvoices };
}

export async function reconcileBankTransactionToInvoice(input: {
  supplierInvoiceId: string;
  actor: AuthenticatedActor;
  bankTransactionId?: string;
  amount?: Prisma.Decimal.Value;
  reference?: string;
  paidAt?: Date;
  notes?: string;
}) {
  assertPermission(input.actor, "invoice:markPaid");

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.supplierInvoice.findUniqueOrThrow({
      where: { id: input.supplierInvoiceId },
      include: { paymentAllocations: true, supplier: true }
    });
    if (invoice.status === InvoiceStatus.VOID || invoice.status === InvoiceStatus.PAID) {
      throw new Error(`Cannot reconcile payment to a ${invoice.status.toLowerCase()} invoice.`);
    }
    if (invoice.status !== InvoiceStatus.APPROVED) {
      throw new Error("Approve the supplier invoice before reconciling bank/payment transactions.");
    }

    const bankTransaction = input.bankTransactionId
      ? await tx.bankTransaction.findUniqueOrThrow({ where: { id: input.bankTransactionId } })
      : null;
    const allocationAmount = toPositiveDecimal(input.amount ?? bankTransaction?.amount ?? invoice.total);
    const allocatedBefore = invoice.paymentAllocations.reduce((total, allocation) => total.plus(allocation.amount), new Prisma.Decimal(0));
    const allocatedAfter = allocatedBefore.plus(allocationAmount);
    if (allocatedAfter.gt(invoice.total)) {
      throw new Error(`Cannot over-allocate supplier invoice ${invoice.invoiceNumber}; remaining open amount is ${invoice.total.minus(allocatedBefore).toFixed(2)}.`);
    }

    const reference = input.reference?.trim() || bankTransaction?.reference?.trim() || bankTransaction?.sourceHash || `MANUAL-${new Date().toISOString()}`;
    const paymentDate = input.paidAt ?? bankTransaction?.postedAt ?? new Date();
    const allocation = await tx.supplierInvoicePaymentAllocation.create({
      data: {
        supplierInvoiceId: invoice.id,
        bankTransactionId: bankTransaction?.id,
        amount: allocationAmount,
        currency: normalizeCurrencyCode(bankTransaction?.currency ?? invoice.currency),
        paymentDate,
        reference,
        reconciledBy: input.actor.id,
        notes: input.notes?.trim() || undefined
      }
    });

    const paymentJournal = await postSupplierPaymentJournal({ paymentAllocationId: allocation.id, actor: input.actor, tx });

    if (bankTransaction) {
      await tx.bankTransaction.update({ where: { id: bankTransaction.id }, data: { status: BankTransactionStatus.MATCHED } });
    }

    const fullyPaid = allocatedAfter.gte(invoice.total);
    if (fullyPaid) {
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.PAID,
          paidBy: input.actor.id,
          paidAt: paymentDate,
          paymentReference: reference
        }
      });
    }

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "RECONCILE_SUPPLIER_INVOICE_PAYMENT",
      entityType: "SupplierInvoice",
      entityId: invoice.id,
      payload: {
        bankTransactionId: bankTransaction?.id,
        allocationId: allocation.id,
        paymentJournalEntryId: paymentJournal.id,
        amount: allocation.amount.toString(),
        allocatedAfter: allocatedAfter.toString(),
        invoiceTotal: invoice.total.toString(),
        fullyPaid,
        reference
      }
    }, tx);

    return allocation;
  });
}

function normalizeBankTransactionRow(row: BankTransactionImportRow) {
  const currency = normalizeCurrencyCode(row.currency);
  const amount = new Prisma.Decimal(row.amount);
  const source = row.source.trim();
  const description = row.description.trim();
  const reference = row.reference?.trim() || undefined;
  const postedAt = row.postedAt;
  const sourceHash = row.sourceHash?.trim() || hashBankTransaction({ source, postedAt, description, amount, currency, reference });

  return {
    source,
    sourceHash,
    accountName: row.accountName?.trim() || undefined,
    postedAt,
    description,
    counterparty: row.counterparty?.trim() || undefined,
    currency,
    amount,
    reference,
    status: BankTransactionStatus.IMPORTED
  };
}

function hashBankTransaction(input: { source: string; postedAt: Date; description: string; amount: Prisma.Decimal; currency: string; reference?: string }) {
  return createHash("sha256")
    .update([
      input.source,
      input.postedAt.toISOString(),
      input.description,
      input.amount.toFixed(2),
      input.currency,
      input.reference ?? ""
    ].join("|"))
    .digest("hex");
}

function toPositiveDecimal(value: Prisma.Decimal.Value) {
  const decimal = new Prisma.Decimal(value);
  if (decimal.isZero()) throw new Error("Payment allocation amount must be non-zero.");
  return decimal.abs();
}
