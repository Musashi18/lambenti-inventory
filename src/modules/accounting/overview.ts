import { BankTransactionStatus, InvoiceStatus, JournalEntryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const REQUIRED_POSTING_GL_PURPOSES = [
  "INVENTORY_ASSET",
  "TAX_RECOVERABLE",
  "ACCOUNTS_PAYABLE",
  "BANK_CASH"
] as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type MoneyLike = { toString(): string } | number;

export type PayableInvoiceInput = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus | string;
  currency: string;
  total: MoneyLike;
  dueDate: Date | null;
  invoiceDate: Date;
  supplier: { name: string };
  paymentAllocations?: Array<{ amount: MoneyLike }>;
  accountingDocuments?: Array<{ id: string }>;
};

export type BankTransactionInput = {
  id: string;
  currency: string;
  amount: MoneyLike;
  postedAt: Date;
  reference: string | null;
  description: string;
};

export type GLMappingInput = {
  purpose: string;
  active: boolean;
  scopeType: string;
  scopeId: string | null;
  glAccount: { active: boolean; code: string; name: string };
};

export type PayablesAgingBucket = {
  count: number;
  total: number;
};

export type PayablesAgingSummary = {
  currency: string;
  openCount: number;
  openTotal: number;
  receivedCount: number;
  approvedCount: number;
  overdue: PayablesAgingBucket;
  dueNext7Days: PayablesAgingBucket;
  later: PayablesAgingBucket;
  noDueDate: PayablesAgingBucket;
  nextDueInvoices: Array<{
    id: string;
    invoiceNumber: string;
    supplierName: string;
    status: string;
    currency: string;
    openBalance: number;
    dueDate: string | null;
    dueLabel: string;
    urgency: "overdue" | "due-soon" | "later" | "no-due-date";
    evidenceCount: number;
  }>;
};

export type BankReconciliationSummary = {
  unmatchedCount: number;
  outgoingTotal: number;
  incomingTotal: number;
  latestTransactions: Array<{
    id: string;
    postedAt: string;
    reference: string | null;
    description: string;
    currency: string;
    amount: number;
  }>;
};

export type GLSetupSummary = {
  requiredPurposes: string[];
  configuredPurposes: string[];
  missingPurposes: string[];
  readyForPosting: boolean;
};

export type AccountingCommandCenter = {
  payables: PayablesAgingSummary;
  bank: BankReconciliationSummary;
  glSetup: GLSetupSummary;
  postedJournalCount: number;
};

export async function getAccountingCommandCenter(now = new Date()): Promise<AccountingCommandCenter> {
  const [openInvoices, importedTransactions, mappings, postedJournalCount] = await Promise.all([
    prisma.supplierInvoice.findMany({
      where: { status: { in: [InvoiceStatus.RECEIVED, InvoiceStatus.APPROVED] } },
      include: {
        supplier: true,
        paymentAllocations: true,
        accountingDocuments: { select: { id: true } }
      },
      orderBy: [{ dueDate: "asc" }, { invoiceDate: "desc" }]
    }),
    prisma.bankTransaction.findMany({
      where: { status: BankTransactionStatus.IMPORTED },
      orderBy: [{ postedAt: "desc" }, { createdAt: "desc" }]
    }),
    prisma.gLAccountMapping.findMany({
      where: {
        active: true,
        scopeType: "DEFAULT",
        scopeId: null,
        purpose: { in: [...REQUIRED_POSTING_GL_PURPOSES] },
        glAccount: { active: true }
      },
      include: { glAccount: true }
    }),
    prisma.journalEntry.count({ where: { status: JournalEntryStatus.POSTED } })
  ]);

  return {
    payables: summarizePayablesAging(openInvoices, now),
    bank: summarizeBankReconciliation(importedTransactions),
    glSetup: summarizePostingGlSetup(mappings),
    postedJournalCount
  };
}

export function summarizePayablesAging(invoices: PayableInvoiceInput[], now = new Date()): PayablesAgingSummary {
  const today = startOfUtcDay(now);
  const dueSoonEnd = addDays(today, 7);
  const buckets = {
    overdue: emptyBucket(),
    dueNext7Days: emptyBucket(),
    later: emptyBucket(),
    noDueDate: emptyBucket()
  };

  const rows = invoices.map((invoice) => {
    const openBalance = Math.max(0, moneyNumber(invoice.total) - sumMoney(invoice.paymentAllocations ?? []));
    const dueDate = invoice.dueDate ? startOfUtcDay(invoice.dueDate) : null;
    const urgency = classifyDueDate(dueDate, today, dueSoonEnd);
    bucketForUrgency(buckets, urgency).count += 1;
    bucketForUrgency(buckets, urgency).total += openBalance;

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierName: invoice.supplier.name,
      status: String(invoice.status),
      currency: invoice.currency,
      openBalance,
      dueDate: dueDate ? isoDate(dueDate) : null,
      dueLabel: dueLabel(dueDate, today),
      urgency,
      evidenceCount: invoice.accountingDocuments?.length ?? 0,
      invoiceDate: invoice.invoiceDate
    };
  });

  rows.sort((a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency)
    || nullableDateValue(a.dueDate) - nullableDateValue(b.dueDate)
    || b.invoiceDate.getTime() - a.invoiceDate.getTime()
    || a.invoiceNumber.localeCompare(b.invoiceNumber));

  return {
    currency: dominantCurrency(invoices),
    openCount: invoices.length,
    openTotal: roundCurrency(rows.reduce((total, row) => total + row.openBalance, 0)),
    receivedCount: invoices.filter((invoice) => invoice.status === InvoiceStatus.RECEIVED || invoice.status === "RECEIVED").length,
    approvedCount: invoices.filter((invoice) => invoice.status === InvoiceStatus.APPROVED || invoice.status === "APPROVED").length,
    overdue: normalizeBucket(buckets.overdue),
    dueNext7Days: normalizeBucket(buckets.dueNext7Days),
    later: normalizeBucket(buckets.later),
    noDueDate: normalizeBucket(buckets.noDueDate),
    nextDueInvoices: rows.slice(0, 5).map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      supplierName: row.supplierName,
      status: row.status,
      currency: row.currency,
      openBalance: roundCurrency(row.openBalance),
      dueDate: row.dueDate,
      dueLabel: row.dueLabel,
      urgency: row.urgency,
      evidenceCount: row.evidenceCount
    }))
  };
}

export function summarizeBankReconciliation(transactions: BankTransactionInput[]): BankReconciliationSummary {
  const latestTransactions = [...transactions]
    .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())
    .slice(0, 5)
    .map((transaction) => ({
      id: transaction.id,
      postedAt: isoDate(transaction.postedAt),
      reference: transaction.reference,
      description: transaction.description,
      currency: transaction.currency,
      amount: moneyNumber(transaction.amount)
    }));

  return {
    unmatchedCount: transactions.length,
    outgoingTotal: roundCurrency(transactions.reduce((total, transaction) => total + Math.abs(Math.min(0, moneyNumber(transaction.amount))), 0)),
    incomingTotal: roundCurrency(transactions.reduce((total, transaction) => total + Math.max(0, moneyNumber(transaction.amount)), 0)),
    latestTransactions
  };
}

export function summarizePostingGlSetup(mappings: GLMappingInput[]): GLSetupSummary {
  const configured = new Set(
    mappings
      .filter((mapping) => mapping.active && mapping.glAccount.active && mapping.scopeType === "DEFAULT" && mapping.scopeId == null)
      .map((mapping) => mapping.purpose.trim().toUpperCase())
  );
  const required = [...REQUIRED_POSTING_GL_PURPOSES];
  const missing = required.filter((purpose) => !configured.has(purpose));

  return {
    requiredPurposes: required,
    configuredPurposes: required.filter((purpose) => configured.has(purpose)),
    missingPurposes: missing,
    readyForPosting: missing.length === 0
  };
}

function emptyBucket(): PayablesAgingBucket {
  return { count: 0, total: 0 };
}

function normalizeBucket(bucket: PayablesAgingBucket): PayablesAgingBucket {
  return { count: bucket.count, total: roundCurrency(bucket.total) };
}

function bucketForUrgency(buckets: { overdue: PayablesAgingBucket; dueNext7Days: PayablesAgingBucket; later: PayablesAgingBucket; noDueDate: PayablesAgingBucket }, urgency: "overdue" | "due-soon" | "later" | "no-due-date") {
  if (urgency === "overdue") return buckets.overdue;
  if (urgency === "due-soon") return buckets.dueNext7Days;
  if (urgency === "later") return buckets.later;
  return buckets.noDueDate;
}

function classifyDueDate(dueDate: Date | null, today: Date, dueSoonEnd: Date): "overdue" | "due-soon" | "later" | "no-due-date" {
  if (!dueDate) return "no-due-date";
  if (dueDate.getTime() < today.getTime()) return "overdue";
  if (dueDate.getTime() <= dueSoonEnd.getTime()) return "due-soon";
  return "later";
}

function dueLabel(dueDate: Date | null, today: Date) {
  if (!dueDate) return "No due date";
  const days = Math.round((dueDate.getTime() - today.getTime()) / MS_PER_DAY);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

function urgencyRank(urgency: "overdue" | "due-soon" | "later" | "no-due-date") {
  if (urgency === "overdue") return 0;
  if (urgency === "due-soon") return 1;
  if (urgency === "no-due-date") return 2;
  return 3;
}

function nullableDateValue(value: string | null) {
  return value ? Date.parse(`${value}T00:00:00.000Z`) : Number.MAX_SAFE_INTEGER;
}

function sumMoney(rows: Array<{ amount: MoneyLike }>) {
  return rows.reduce((total, row) => total + moneyNumber(row.amount), 0);
}

function moneyNumber(value: MoneyLike) {
  return typeof value === "number" ? value : Number(value.toString());
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function isoDate(date: Date) {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

function dominantCurrency(invoices: PayableInvoiceInput[]) {
  const counts = invoices.reduce<Record<string, number>>((acc, invoice) => {
    acc[invoice.currency] = (acc[invoice.currency] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
}
