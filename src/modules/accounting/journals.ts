import { createHash } from "node:crypto";
import { GLAccount, JournalEntryKind, JournalEntryStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { type AuthenticatedActor } from "@/modules/auth/permissions";
import { resolveInvoiceLineAccount, resolveRequiredMappedAccount } from "./gl";

type JournalTransaction = Prisma.TransactionClient;

type PostingLineInput = {
  account: GLAccount;
  description: string;
  debit?: Prisma.Decimal.Value;
  credit?: Prisma.Decimal.Value;
  sourceLineType?: string;
  sourceLineId?: string;
};

type PostBalancedJournalInput = {
  kind: JournalEntryKind;
  idempotencyKey: string;
  sourceType: string;
  sourceId: string;
  sourceReference?: string;
  entryDate: Date;
  currency: string;
  memo?: string;
  supplierInvoiceId?: string;
  supplierInvoicePaymentAllocationId?: string;
  lines: PostingLineInput[];
  actor: AuthenticatedActor;
  tx: JournalTransaction;
};

export async function postSupplierInvoiceApprovalJournal(input: {
  invoiceId: string;
  actor: AuthenticatedActor;
  tx: JournalTransaction;
}) {
  const invoice = await input.tx.supplierInvoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    include: {
      supplier: true,
      lines: { orderBy: { description: "asc" } }
    }
  });

  const idempotencyKey = `AP_INVOICE:${invoice.id}`;
  const existing = await input.tx.journalEntry.findUnique({ where: { idempotencyKey }, include: { lines: true } });
  if (existing) return existing;

  const postingLines: PostingLineInput[] = [];
  for (const line of invoice.lines) {
    const amount = decimal(line.lineTotal).toDecimalPlaces(2);
    if (amount.lte(0)) continue;
    const account = await resolveInvoiceLineAccount(line.id, "INVENTORY_ASSET", input.tx);
    if (!account) {
      throw new Error("GL mapping required for INVENTORY_ASSET. Configure an active item/category/supplier/default mapping on /accounting/accounts before approving this invoice.");
    }
    postingLines.push({
      account,
      description: `Invoice line ${line.description}`,
      debit: amount,
      sourceLineType: "SupplierInvoiceLine",
      sourceLineId: line.id
    });
  }

  const recoverableTax = decimal(invoice.taxRecoverableAmount ?? invoice.taxCost ?? 0).toDecimalPlaces(2);
  if (recoverableTax.gt(0)) {
    postingLines.push({
      account: await resolveRequiredMappedAccount({ purpose: "TAX_RECOVERABLE", client: input.tx }),
      description: `Recoverable tax for ${invoice.invoiceNumber}`,
      debit: recoverableTax,
      sourceLineType: "SupplierInvoice",
      sourceLineId: invoice.id
    });
  }

  const nonRecoverableTax = decimal(invoice.taxNonRecoverableAmount ?? 0);
  const landedCharges = decimal(invoice.shippingCost)
    .plus(invoice.dutyCost)
    .plus(invoice.brokerageCost)
    .plus(invoice.otherLandedCost)
    .plus(nonRecoverableTax)
    .toDecimalPlaces(2);
  if (landedCharges.gt(0)) {
    postingLines.push({
      account: await resolveRequiredMappedAccount({ purpose: "INVENTORY_ASSET", client: input.tx }),
      description: `Freight/duty/brokerage/non-recoverable tax for ${invoice.invoiceNumber}`,
      debit: landedCharges,
      sourceLineType: "SupplierInvoice",
      sourceLineId: invoice.id
    });
  }

  const invoiceTotal = decimal(invoice.total).toDecimalPlaces(2);
  const debitTotal = sumAmounts(postingLines.map((line) => line.debit ?? 0));
  const unallocated = invoiceTotal.minus(debitTotal).toDecimalPlaces(2);
  if (unallocated.gt(0)) {
    postingLines.push({
      account: await resolveRequiredMappedAccount({ purpose: "INVENTORY_ASSET", client: input.tx }),
      description: `Unallocated invoice amount for ${invoice.invoiceNumber}`,
      debit: unallocated,
      sourceLineType: "SupplierInvoice",
      sourceLineId: invoice.id
    });
  } else if (unallocated.lt(0)) {
    throw new Error(`AP invoice journal for ${invoice.invoiceNumber} would overstate debits by ${unallocated.abs().toFixed(2)}. Review tax/landed-cost fields before approval.`);
  }

  postingLines.push({
    account: await resolveRequiredMappedAccount({ purpose: "ACCOUNTS_PAYABLE", client: input.tx }),
    description: `Accounts payable for ${invoice.supplier.name} ${invoice.invoiceNumber}`,
    credit: invoiceTotal,
    sourceLineType: "SupplierInvoice",
    sourceLineId: invoice.id
  });

  return postBalancedJournalEntry({
    kind: JournalEntryKind.AP_INVOICE,
    idempotencyKey,
    sourceType: "SupplierInvoice",
    sourceId: invoice.id,
    sourceReference: invoice.invoiceNumber,
    supplierInvoiceId: invoice.id,
    entryDate: invoice.invoiceDate,
    currency: invoice.currency,
    memo: `AP invoice approval for ${invoice.supplier.name} ${invoice.invoiceNumber}`,
    lines: postingLines,
    actor: input.actor,
    tx: input.tx
  });
}

export async function postSupplierPaymentJournal(input: {
  paymentAllocationId: string;
  actor: AuthenticatedActor;
  tx: JournalTransaction;
}) {
  const allocation = await input.tx.supplierInvoicePaymentAllocation.findUniqueOrThrow({
    where: { id: input.paymentAllocationId },
    include: { supplierInvoice: { include: { supplier: true } } }
  });
  const idempotencyKey = `AP_PAYMENT:${allocation.id}`;
  const existing = await input.tx.journalEntry.findUnique({ where: { idempotencyKey }, include: { lines: true } });
  if (existing) return existing;
  const amount = decimal(allocation.amount).abs().toDecimalPlaces(2);

  return postBalancedJournalEntry({
    kind: JournalEntryKind.AP_PAYMENT,
    idempotencyKey,
    sourceType: "SupplierInvoicePaymentAllocation",
    sourceId: allocation.id,
    sourceReference: allocation.reference,
    supplierInvoiceId: allocation.supplierInvoiceId,
    supplierInvoicePaymentAllocationId: allocation.id,
    entryDate: allocation.paymentDate,
    currency: allocation.currency,
    memo: `AP payment reconciliation for ${allocation.supplierInvoice.supplier.name} ${allocation.supplierInvoice.invoiceNumber}`,
    lines: [
      {
        account: await resolveRequiredMappedAccount({ purpose: "ACCOUNTS_PAYABLE", client: input.tx }),
        description: `Clear accounts payable for ${allocation.supplierInvoice.invoiceNumber}`,
        debit: amount,
        sourceLineType: "SupplierInvoicePaymentAllocation",
        sourceLineId: allocation.id
      },
      {
        account: await resolveRequiredMappedAccount({ purpose: "BANK_CASH", client: input.tx }),
        description: `Bank/cash payment ${allocation.reference}`,
        credit: amount,
        sourceLineType: "SupplierInvoicePaymentAllocation",
        sourceLineId: allocation.id
      }
    ],
    actor: input.actor,
    tx: input.tx
  });
}

export async function postBalancedJournalEntry(input: PostBalancedJournalInput) {
  const existing = await input.tx.journalEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { lines: true } });
  if (existing) return existing;

  const normalizedLines = input.lines
    .map((line) => ({ ...line, debit: decimal(line.debit ?? 0).toDecimalPlaces(2), credit: decimal(line.credit ?? 0).toDecimalPlaces(2) }))
    .filter((line) => line.debit.gt(0) || line.credit.gt(0));
  const totalDebit = sumAmounts(normalizedLines.map((line) => line.debit));
  const totalCredit = sumAmounts(normalizedLines.map((line) => line.credit));
  if (normalizedLines.length < 2 || totalDebit.lte(0) || !totalDebit.equals(totalCredit)) {
    throw new Error(`Journal entry ${input.sourceReference ?? input.sourceId} is not balanced: debit ${totalDebit.toFixed(2)} credit ${totalCredit.toFixed(2)}.`);
  }

  const entryNumber = journalEntryNumber(input.kind, input.idempotencyKey);
  try {
    const entry = await input.tx.journalEntry.create({
      data: {
        entryNumber,
        idempotencyKey: input.idempotencyKey,
        kind: input.kind,
        status: JournalEntryStatus.POSTED,
        entryDate: input.entryDate,
        currency: input.currency.trim().toUpperCase(),
        totalDebit,
        totalCredit,
        memo: input.memo,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceReference: input.sourceReference,
        supplierInvoiceId: input.supplierInvoiceId,
        supplierInvoicePaymentAllocationId: input.supplierInvoicePaymentAllocationId,
        createdBy: input.actor.id,
        postedBy: input.actor.id,
        postedAt: new Date(),
        lines: {
          create: normalizedLines.map((line, index) => ({
            lineNo: index + 1,
            glAccountId: line.account.id,
            accountCodeSnapshot: line.account.code,
            accountNameSnapshot: line.account.name,
            accountTypeSnapshot: line.account.type,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
            sourceLineType: line.sourceLineType,
            sourceLineId: line.sourceLineId
          }))
        }
      },
      include: { lines: { orderBy: { lineNo: "asc" } } }
    });

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "POST_JOURNAL_ENTRY",
      entityType: "JournalEntry",
      entityId: entry.id,
      payload: {
        entryNumber: entry.entryNumber,
        kind: entry.kind,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        sourceReference: entry.sourceReference,
        totalDebit: entry.totalDebit.toString(),
        totalCredit: entry.totalCredit.toString()
      }
    }, input.tx);

    return entry;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await input.tx.journalEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { lines: true } });
      if (raced) return raced;
    }
    throw error;
  }
}

export async function getJournalDashboard(input: { from?: Date; to?: Date } = {}) {
  const entries = await prisma.journalEntry.findMany({
    where: {
      ...(input.from || input.to ? { entryDate: { gte: input.from, lte: input.to } } : {})
    },
    include: {
      supplierInvoice: { include: { supplier: true } },
      supplierInvoicePaymentAllocation: true,
      lines: { include: { glAccount: true }, orderBy: { lineNo: "asc" } }
    },
    orderBy: [{ entryDate: "desc" }, { entryNumber: "desc" }],
    take: 250
  });

  const accountBalances = new Map<string, { accountCode: string; accountName: string; accountType: string; debit: number; credit: number; net: number }>();
  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of entries) {
    if (entry.status !== JournalEntryStatus.POSTED) continue;
    for (const line of entry.lines) {
      const debit = Number(line.debit.toString());
      const credit = Number(line.credit.toString());
      totalDebit += debit;
      totalCredit += credit;
      const current = accountBalances.get(line.accountCodeSnapshot) ?? {
        accountCode: line.accountCodeSnapshot,
        accountName: line.accountNameSnapshot,
        accountType: line.accountTypeSnapshot,
        debit: 0,
        credit: 0,
        net: 0
      };
      current.debit += debit;
      current.credit += credit;
      current.net = current.debit - current.credit;
      accountBalances.set(line.accountCodeSnapshot, current);
    }
  }

  return {
    entries,
    trialBalance: {
      totalDebit,
      totalCredit,
      outOfBalance: Number((totalDebit - totalCredit).toFixed(2)),
      accountBalances: Array.from(accountBalances.values()).sort((a, b) => a.accountCode.localeCompare(b.accountCode))
    }
  };
}

export function formatJournalEntryCsv(entries: Array<Awaited<ReturnType<typeof getJournalDashboard>>["entries"][number]>) {
  const header = ["entryNumber", "entryDate", "kind", "status", "lineNo", "accountCode", "accountName", "debit", "credit", "sourceReference", "memo"];
  const rows = entries.flatMap((entry) => entry.lines.map((line) => [
    entry.entryNumber,
    entry.entryDate.toISOString().slice(0, 10),
    entry.kind,
    entry.status,
    line.lineNo.toString(),
    line.accountCodeSnapshot,
    line.accountNameSnapshot,
    Number(line.debit.toString()).toFixed(2),
    Number(line.credit.toString()).toFixed(2),
    entry.sourceReference ?? "",
    entry.memo ?? ""
  ]));
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function decimal(value: Prisma.Decimal.Value) {
  return new Prisma.Decimal(value);
}

function sumAmounts(values: Prisma.Decimal.Value[]) {
  return values.reduce<Prisma.Decimal>((total, value) => total.plus(value), new Prisma.Decimal(0)).toDecimalPlaces(2);
}

function journalEntryNumber(kind: JournalEntryKind, idempotencyKey: string) {
  const digest = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 12).toUpperCase();
  return `JE-${kind}-${digest}`;
}

function csvCell(value: string) {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
