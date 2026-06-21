import { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertPermission, type AuthenticatedActor } from "@/modules/auth/permissions";
import { DEFAULT_CURRENCY, convertToUsd } from "@/modules/currency";
import { postSupplierInvoiceApprovalJournal, postSupplierPaymentJournal } from "./journals";

type InvoiceSourceProvenance = {
  invoiceNumber?: string;
  sourceDocumentPath?: string;
  sourceDocumentHash?: string;
  externalSourceUrl?: string;
  notes?: string;
  currency?: string;
  subtotal?: Prisma.Decimal.Value;
  shippingCost?: Prisma.Decimal.Value;
  taxCost?: Prisma.Decimal.Value;
  taxRecoverableAmount?: Prisma.Decimal.Value;
  taxNonRecoverableAmount?: Prisma.Decimal.Value;
  dutyCost?: Prisma.Decimal.Value;
  brokerageCost?: Prisma.Decimal.Value;
  otherLandedCost?: Prisma.Decimal.Value;
  total?: Prisma.Decimal.Value;
  invoiceDate?: Date;
  dueDate?: Date;
};

function toDecimal(value: Prisma.Decimal.Value | null | undefined, fallback = 0) {
  return value == null ? new Prisma.Decimal(fallback) : new Prisma.Decimal(value);
}

function toUsdMoney(value: Prisma.Decimal.Value, currency: string) {
  return new Prisma.Decimal(convertToUsd(Number(value), currency));
}

export function normalizeInvoiceNumberKey(invoiceNumber: string) {
  return invoiceNumber.trim().replace(/\s+/g, " ").toUpperCase();
}

export type InvoiceWorkQueueInput = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus | string;
  currency: string;
  total: Prisma.Decimal.Value | number;
  dueDate: Date | null;
  invoiceDate: Date;
  supplier: { name: string };
  sourceDocumentPath?: string | null;
  sourceDocumentHash?: string | null;
  externalSourceUrl?: string | null;
  accountingDocuments?: Array<{ id: string }>;
  paymentAllocations?: Array<{ amount: Prisma.Decimal.Value | number }>;
  journalEntries?: Array<{ id: string }>;
};

export type InvoiceWorkQueueRow = {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  status: string;
  currency: string;
  openBalance: number;
  dueDate: string | null;
  dueLabel: string;
  evidenceCount: number;
  evidenceReady: boolean;
  journalCount: number;
  nextAction: string;
  warnings: string[];
};

export type InvoiceWorkQueueSummary = {
  openCount: number;
  receivedCount: number;
  approvalReadyCount: number;
  approvalBlockedCount: number;
  missingEvidenceCount: number;
  missingDueDateCount: number;
  approvedAwaitingPaymentCount: number;
  paidCount: number;
  openTotal: number;
  rows: InvoiceWorkQueueRow[];
  approvalQueue: InvoiceWorkQueueRow[];
  approvalReadyQueue: InvoiceWorkQueueRow[];
  approvalBlockedQueue: InvoiceWorkQueueRow[];
  paymentQueue: InvoiceWorkQueueRow[];
};

export type InvoiceDuplicateClusterInput = {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplier: { name: string };
  purchaseOrderId: string | null;
  status: InvoiceStatus | string;
  currency: string;
  total: Prisma.Decimal.Value | number;
  createdAt: Date;
  sourceDocumentHash?: string | null;
  externalSourceUrl?: string | null;
  paymentAllocations?: Array<{ id?: string }>;
  journalEntries?: Array<{ id?: string }>;
  accountingDocuments?: Array<{ id?: string }>;
};

export type InvoiceDuplicateCluster = {
  key: string;
  supplierName: string;
  purchaseOrderId: string | null;
  status: string;
  currency: string;
  total: number;
  invoiceCount: number;
  duplicateCount: number;
  canonicalInvoiceId: string;
  invoiceNumbers: string[];
  duplicateInvoiceIds: string[];
  canVoidDuplicates: boolean;
  blockReason: string | null;
  amountAtRisk: number;
};

export function summarizeInvoiceWorkQueue(invoices: InvoiceWorkQueueInput[], now = new Date()): InvoiceWorkQueueSummary {
  const rows = invoices.map((invoice) => invoiceWorkQueueRow(invoice, now));
  const openRows = rows.filter((row) => row.status === InvoiceStatus.RECEIVED || row.status === InvoiceStatus.APPROVED);
  const receivedRows = rows.filter((row) => row.status === InvoiceStatus.RECEIVED);
  const approvedRows = rows.filter((row) => row.status === InvoiceStatus.APPROVED);
  const sortedReceivedRows = [...receivedRows].sort(compareInvoiceWorkRows);
  const approvalReadyRows = sortedReceivedRows.filter((row) => row.warnings.length === 0);
  const approvalBlockedRows = sortedReceivedRows.filter((row) => row.warnings.length > 0);

  return {
    openCount: openRows.length,
    receivedCount: receivedRows.length,
    approvalReadyCount: approvalReadyRows.length,
    approvalBlockedCount: approvalBlockedRows.length,
    missingEvidenceCount: receivedRows.filter((row) => !row.evidenceReady).length,
    missingDueDateCount: openRows.filter((row) => row.dueDate == null).length,
    approvedAwaitingPaymentCount: approvedRows.length,
    paidCount: rows.filter((row) => row.status === InvoiceStatus.PAID).length,
    openTotal: roundMoney(openRows.reduce((total, row) => total + row.openBalance, 0)),
    rows,
    approvalQueue: sortedReceivedRows.slice(0, 8),
    approvalReadyQueue: approvalReadyRows.slice(0, 8),
    approvalBlockedQueue: approvalBlockedRows.slice(0, 8),
    paymentQueue: [...approvedRows].sort(compareInvoiceWorkRows).slice(0, 8)
  };
}

export function summarizeInvoiceDuplicateClusters(invoices: InvoiceDuplicateClusterInput[]): InvoiceDuplicateCluster[] {
  const groups = new Map<string, InvoiceDuplicateClusterInput[]>();
  for (const invoice of invoices) {
    if (invoice.status === InvoiceStatus.VOID) continue;
    const key = invoiceDuplicateClusterKey(invoice);
    const group = groups.get(key) ?? [];
    group.push(invoice);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => invoiceDuplicateCluster(key, group))
    .sort((a, b) => b.amountAtRisk - a.amountAtRisk || b.duplicateCount - a.duplicateCount || a.supplierName.localeCompare(b.supplierName));
}

export async function voidDuplicateInvoiceCluster(input: {
  clusterKey: string;
  keepInvoiceId: string;
  actor: AuthenticatedActor;
  voidReason?: string;
}) {
  assertPermission(input.actor, "invoice:approve");
  const invoices = await prisma.supplierInvoice.findMany({
    where: { status: { not: InvoiceStatus.VOID } },
    include: {
      supplier: true,
      paymentAllocations: { select: { id: true } },
      journalEntries: { select: { id: true } },
      accountingDocuments: { select: { id: true } }
    }
  });
  const cluster = summarizeInvoiceDuplicateClusters(invoices).find((candidate) => candidate.key === input.clusterKey);
  if (!cluster) throw new Error("Duplicate invoice cluster is no longer present.");
  if (cluster.canonicalInvoiceId !== input.keepInvoiceId && !cluster.invoiceNumbers.length) {
    throw new Error("Duplicate invoice cluster keep invoice is invalid.");
  }
  const keepInvoice = invoices.find((invoice) => invoice.id === input.keepInvoiceId);
  if (!keepInvoice || invoiceDuplicateClusterKey(keepInvoice) !== input.clusterKey) {
    throw new Error("Selected keep invoice is not part of this duplicate cluster.");
  }
  if (!cluster.canVoidDuplicates) throw new Error(cluster.blockReason ?? "Duplicate cluster cannot be auto-voided.");

  const duplicateInvoices = invoices.filter((invoice) => invoice.id !== input.keepInvoiceId && invoiceDuplicateClusterKey(invoice) === input.clusterKey);
  if (duplicateInvoices.length === 0) throw new Error("No duplicate invoices remain after selecting the keeper.");
  const unsafeDuplicate = duplicateInvoices.find((invoice) => !isAutoVoidableDuplicateInvoice(invoice));
  if (unsafeDuplicate) {
    throw new Error(`Invoice ${unsafeDuplicate.invoiceNumber} has journals, payments, or an advanced status; review manually.`);
  }

  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const reason = input.voidReason?.trim() || `Duplicate of supplier invoice ${keepInvoice.invoiceNumber}; operator kept ${keepInvoice.id}.`;
    const updated = [];
    for (const invoice of duplicateInvoices) {
      const voided = await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.VOID,
          voidReason: reason
        }
      });
      await writeAuditLog({
        actorType: input.actor.actorType,
        actorId: input.actor.id,
        action: "VOID_DUPLICATE_SUPPLIER_INVOICE",
        entityType: "SupplierInvoice",
        entityId: invoice.id,
        payload: {
          fromStatus: invoice.status,
          toStatus: InvoiceStatus.VOID,
          keptInvoiceId: keepInvoice.id,
          keptInvoiceNumber: keepInvoice.invoiceNumber,
          clusterKey: input.clusterKey,
          voidReason: reason,
          voidedAt: now.toISOString(),
          note: "Duplicate invoice voiding does not receive stock, approve payment, or post payment journals."
        }
      }, tx);
      updated.push(voided);
    }
    return { voidedCount: updated.length, keptInvoiceId: keepInvoice.id, voidedInvoiceIds: updated.map((invoice) => invoice.id) };
  });
}

function invoiceDuplicateClusterKey(invoice: InvoiceDuplicateClusterInput) {
  if (invoice.purchaseOrderId) {
    return [
      invoice.supplierId,
      `ORDER:${invoice.purchaseOrderId}`
    ].join("::");
  }

  return [
    invoice.supplierId,
    invoice.purchaseOrderId ?? "NO_PURCHASE_ORDER",
    String(invoice.status),
    invoice.currency.trim().toUpperCase(),
    numberValue(invoice.total).toFixed(2)
  ].join("::");
}

function invoiceDuplicateCluster(key: string, group: InvoiceDuplicateClusterInput[]): InvoiceDuplicateCluster {
  const sorted = [...group].sort(compareCanonicalInvoiceCandidate);
  const canonical = sorted[0];
  const duplicateInvoices = sorted.slice(1);
  const unsafeDuplicate = duplicateInvoices.find((invoice) => !isAutoVoidableDuplicateInvoice(invoice));
  return {
    key,
    supplierName: canonical.supplier.name,
    purchaseOrderId: canonical.purchaseOrderId,
    status: String(canonical.status),
    currency: canonical.currency,
    total: roundMoney(numberValue(canonical.total)),
    invoiceCount: group.length,
    duplicateCount: duplicateInvoices.length,
    canonicalInvoiceId: canonical.id,
    invoiceNumbers: sorted.map((invoice) => invoice.invoiceNumber),
    duplicateInvoiceIds: duplicateInvoices.map((invoice) => invoice.id),
    canVoidDuplicates: !unsafeDuplicate,
    blockReason: unsafeDuplicate ? "One or more duplicates has journals, payments, evidence, or an advanced status; review manually before voiding." : null,
    amountAtRisk: roundMoney(numberValue(canonical.total) * duplicateInvoices.length)
  };
}

function compareCanonicalInvoiceCandidate(a: InvoiceDuplicateClusterInput, b: InvoiceDuplicateClusterInput) {
  return invoiceCanonicalScore(b) - invoiceCanonicalScore(a)
    || a.createdAt.getTime() - b.createdAt.getTime()
    || a.invoiceNumber.localeCompare(b.invoiceNumber);
}

function invoiceCanonicalScore(invoice: InvoiceDuplicateClusterInput) {
  let score = 0;
  score += (invoice.journalEntries?.length ?? 0) * 100;
  score += (invoice.paymentAllocations?.length ?? 0) * 100;
  score += (invoice.accountingDocuments?.length ?? 0) * 20;
  if (invoice.sourceDocumentHash) score += 15;
  if (invoice.externalSourceUrl) score += 10;
  if (invoice.status === InvoiceStatus.APPROVED) score += 8;
  if (invoice.status === InvoiceStatus.PAID) score += 12;
  return score;
}

function isAutoVoidableDuplicateInvoice(invoice: InvoiceDuplicateClusterInput) {
  return (invoice.status === InvoiceStatus.DRAFT || invoice.status === InvoiceStatus.RECEIVED)
    && (invoice.paymentAllocations?.length ?? 0) === 0
    && (invoice.journalEntries?.length ?? 0) === 0
    && (invoice.accountingDocuments?.length ?? 0) === 0
    && !invoice.sourceDocumentHash;
}

function invoiceNumberForPurchaseOrder(order: {
  id: string;
  supplier: { name: string };
  emailOrderImports: Array<{ externalOrderId: string | null }>;
  invoices?: Array<{ id: string }>;
}) {
  const externalOrderId = order.emailOrderImports[0]?.externalOrderId;
  const supplierSlug = order.supplier.name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .toUpperCase() || "SUPPLIER";
  const base = externalOrderId ? `${supplierSlug}-${externalOrderId}` : `${supplierSlug}-${order.id.slice(-8).toUpperCase()}`;
  const sequence = (order.invoices?.length ?? 0) + 1;
  return sequence > 1 ? `${base}-${sequence}` : base;
}

export async function getInvoiceDashboard() {
  const [invoices, uninvoicedPurchaseOrders] = await Promise.all([
    prisma.supplierInvoice.findMany({
      include: {
        supplier: true,
        purchaseOrder: true,
        paymentAllocations: { orderBy: { reconciledAt: "desc" } },
        accountingDocuments: { orderBy: { createdAt: "desc" } },
        journalEntries: { orderBy: { entryDate: "desc" } },
        lines: { include: { item: true, purchaseOrderLine: true, glAccount: true }, orderBy: { description: "asc" } }
      },
      orderBy: { invoiceDate: "desc" }
    }),
    prisma.purchaseOrder.findMany({
      where: {
        status: { in: ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"] }
      },
      include: {
        supplier: true,
        invoices: { include: { paymentAllocations: true }, orderBy: { invoiceDate: "desc" } },
        lines: { include: { item: true }, orderBy: { item: { sku: "asc" } } },
        emailOrderImports: true
      },
      orderBy: { orderedAt: "desc" }
    })
  ]);

  const totalsByStatus = invoices.reduce<Record<string, Prisma.Decimal>>((acc, invoice) => {
    acc[invoice.status] = (acc[invoice.status] ?? new Prisma.Decimal(0)).plus(invoice.total);
    return acc;
  }, {});
  const paidEvidenceTotal = invoices.reduce((total, invoice) => {
    // Payment evidence is accounting/payment scope, not receiving scope: a paid supplier order can include
    // components already received and components still open. Keep the paid summary tied to the immutable
    // supplier-invoice total, never to received quantities or stock movements.
    return invoice.status === InvoiceStatus.PAID ? total.plus(invoice.total) : total;
  }, new Prisma.Decimal(0));

  return { invoices, uninvoicedPurchaseOrders, totalsByStatus, paidEvidenceTotal };
}

export async function createInvoiceFromPurchaseOrder(purchaseOrderId: string, actorId: string, source?: InvoiceSourceProvenance) {
  const order = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: {
      supplier: true,
      invoices: { orderBy: { invoiceDate: "desc" } },
      lines: { include: { item: true } },
      emailOrderImports: true
    }
  });

  if (order.lines.length === 0) throw new Error("Cannot invoice a purchase order with no lines.");

  const sourceHash = source?.sourceDocumentHash?.trim();
  if (sourceHash) {
    const existingByHash = await prisma.supplierInvoice.findFirst({ where: { sourceDocumentHash: sourceHash } });
    if (existingByHash) return updateExistingInvoiceFromSource(existingByHash.id, source);
  }
  const externalSourceUrl = source?.externalSourceUrl?.trim();
  if (externalSourceUrl) {
    const existingByExternalSource = await prisma.supplierInvoice.findFirst({ where: { externalSourceUrl } });
    if (existingByExternalSource) return updateExistingInvoiceFromSource(existingByExternalSource.id, source);
  }

  const existingOrderInvoice = order.invoices.find((invoice) => invoice.status !== InvoiceStatus.VOID);

  const importRecord = order.emailOrderImports[0];
  const lineSubtotal = order.lines.reduce(
    (total, line) => total.plus(toDecimal(line.unitPrice).times(line.quantity)),
    new Prisma.Decimal(0)
  );
  const importCurrency = importRecord?.currency ?? DEFAULT_CURRENCY;
  const sourceCurrency = source?.currency ?? importCurrency;
  const subtotal = source?.subtotal == null
    ? importRecord?.subtotal == null ? lineSubtotal : toUsdMoney(importRecord.subtotal, importCurrency)
    : toUsdMoney(source.subtotal, sourceCurrency);
  const shippingCost = source?.shippingCost == null
    ? importRecord?.shippingCost == null ? new Prisma.Decimal(0) : toUsdMoney(importRecord.shippingCost, importCurrency)
    : toUsdMoney(source.shippingCost, sourceCurrency);
  const taxCost = source?.taxCost == null
    ? importRecord?.taxCost == null ? new Prisma.Decimal(0) : toUsdMoney(importRecord.taxCost, importCurrency)
    : toUsdMoney(source.taxCost, sourceCurrency);
  const total = source?.total == null
    ? importRecord?.totalCost == null ? subtotal.plus(shippingCost).plus(taxCost) : toUsdMoney(importRecord.totalCost, importCurrency)
    : toUsdMoney(source.total, sourceCurrency);
  const invoiceNumber = source?.invoiceNumber?.trim() || invoiceNumberForPurchaseOrder(order);
  const invoiceNumberKey = normalizeInvoiceNumberKey(invoiceNumber);

  const existingBySupplierInvoiceNumber = await prisma.supplierInvoice.findUnique({
    where: { supplierId_invoiceNumberKey: { supplierId: order.supplierId, invoiceNumberKey } }
  });
  if (existingBySupplierInvoiceNumber) return updateExistingInvoiceFromSource(existingBySupplierInvoiceNumber.id, source);

  if (existingOrderInvoice) {
    return updateExistingInvoiceFromSource(existingOrderInvoice.id, source);
  }

  let invoice;
  try {
    invoice = await prisma.supplierInvoice.create({
      data: {
        invoiceNumber,
        invoiceNumberKey,
        supplierId: order.supplierId,
        purchaseOrderId: order.id,
        status: "RECEIVED",
        currency: DEFAULT_CURRENCY,
        subtotal,
        shippingCost,
        taxCost,
        taxRecoverableAmount: source?.taxRecoverableAmount == null ? undefined : toUsdMoney(source.taxRecoverableAmount, sourceCurrency),
        taxNonRecoverableAmount: source?.taxNonRecoverableAmount == null ? undefined : toUsdMoney(source.taxNonRecoverableAmount, sourceCurrency),
        dutyCost: source?.dutyCost == null ? undefined : toUsdMoney(source.dutyCost, sourceCurrency),
        brokerageCost: source?.brokerageCost == null ? undefined : toUsdMoney(source.brokerageCost, sourceCurrency),
        otherLandedCost: source?.otherLandedCost == null ? undefined : toUsdMoney(source.otherLandedCost, sourceCurrency),
        total,
        sourceCurrency: source?.currency,
        sourceSubtotal: source?.subtotal == null ? undefined : toDecimal(source.subtotal),
        sourceTaxCost: source?.taxCost == null ? undefined : toDecimal(source.taxCost),
        sourceTotal: source?.total == null ? undefined : toDecimal(source.total),
        invoiceDate: source?.invoiceDate ?? order.orderedAt ?? new Date(),
        dueDate: source?.dueDate,
        sourceDocumentPath: source?.sourceDocumentPath,
        sourceDocumentHash: source?.sourceDocumentHash,
        externalSourceUrl,
        notes: source?.notes ?? (importRecord?.externalOrderId
          ? `Auto-created from Email Import order ${importRecord.externalOrderId}. Verify against supplier invoice before marking paid.`
          : "Auto-created from incoming purchase order. Verify against supplier invoice before marking paid."),
        lines: {
          create: order.lines.map((line) => ({
            itemId: line.itemId,
            purchaseOrderLineId: line.id,
            description: `${line.item.sku} — ${line.item.description}`,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: toDecimal(line.unitPrice).times(line.quantity)
          }))
        }
      },
      include: { supplier: true, purchaseOrder: true, lines: { include: { item: true, purchaseOrderLine: true } } }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.supplierInvoice.findFirst({
        where: { OR: [{ supplierId: order.supplierId, invoiceNumberKey }, sourceHash ? { sourceDocumentHash: sourceHash } : undefined].filter(Boolean) as Prisma.SupplierInvoiceWhereInput[] },
        include: { supplier: true, purchaseOrder: true, lines: { include: { item: true, purchaseOrderLine: true } } }
      });
      if (existing) return updateExistingInvoiceFromSource(existing.id, source);
    }
    throw error;
  }

  await writeAuditLog({
    actorType: "USER",
    actorId,
    action: "CREATE_SUPPLIER_INVOICE_FROM_PO",
    entityType: "SupplierInvoice",
    entityId: invoice.id,
    payload: { purchaseOrderId: order.id, invoiceNumber, invoiceNumberKey, total: invoice.total.toString() }
  });

  return invoice;
}

async function updateExistingInvoiceFromSource(invoiceId: string, source?: InvoiceSourceProvenance) {
  const existing = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (!source) return existing;
  const data: Prisma.SupplierInvoiceUpdateInput = {
    sourceDocumentPath: existing.sourceDocumentPath ? undefined : source.sourceDocumentPath ?? undefined,
    sourceDocumentHash: existing.sourceDocumentHash ? undefined : source.sourceDocumentHash ?? undefined,
    externalSourceUrl: existing.externalSourceUrl ? undefined : source.externalSourceUrl ?? undefined,
    dueDate: existing.dueDate ? undefined : source.dueDate ?? undefined,
    notes: mergeInvoiceNotes(existing.notes, source.notes)
  };
  return prisma.supplierInvoice.update({ where: { id: invoiceId }, data });
}

function mergeInvoiceNotes(existingNotes: string | null, sourceNotes?: string) {
  const trimmedSource = sourceNotes?.trim();
  if (!trimmedSource) return undefined;
  if (!existingNotes?.trim()) return trimmedSource;
  if (existingNotes.includes(trimmedSource)) return undefined;
  return `${existingNotes}\n\nMerged source: ${trimmedSource}`;
}

type InvoiceTransitionInput = {
  invoiceId: string;
  status: InvoiceStatus;
  actor: AuthenticatedActor;
  approvalNotes?: string;
  paymentReference?: string;
  voidReason?: string;
};

export async function updateSupplierInvoiceTerms(input: { invoiceId: string; actor: AuthenticatedActor; dueDate?: Date | null; invoiceDate?: Date; notes?: string }) {
  assertPermission(input.actor, "invoice:create");
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
    if (invoice.status === InvoiceStatus.VOID) throw new Error("Cannot update terms on a void supplier invoice.");

    const updated = await tx.supplierInvoice.update({
      where: { id: invoice.id },
      data: {
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.invoiceDate ? { invoiceDate: input.invoiceDate } : {}),
        ...(input.notes?.trim() ? { notes: input.notes.trim() } : {})
      }
    });

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "UPDATE_SUPPLIER_INVOICE_TERMS",
      entityType: "SupplierInvoice",
      entityId: invoice.id,
      payload: {
        dueDate: updated.dueDate?.toISOString() ?? null,
        invoiceDate: updated.invoiceDate?.toISOString() ?? null,
        notesUpdated: Boolean(input.notes?.trim())
      }
    }, tx);

    return updated;
  });
}

const INVOICE_TRANSITIONS: Record<InvoiceStatus, Set<InvoiceStatus>> = {
  [InvoiceStatus.DRAFT]: new Set([InvoiceStatus.RECEIVED, InvoiceStatus.VOID]),
  [InvoiceStatus.RECEIVED]: new Set([InvoiceStatus.APPROVED, InvoiceStatus.VOID]),
  [InvoiceStatus.APPROVED]: new Set([InvoiceStatus.PAID, InvoiceStatus.VOID]),
  [InvoiceStatus.PAID]: new Set([]),
  [InvoiceStatus.VOID]: new Set([])
};

export async function updateInvoiceStatus(input: InvoiceTransitionInput) {
  assertInvoicePermission(input.actor, input.status);

  if (input.status === InvoiceStatus.PAID && !input.paymentReference?.trim()) {
    throw new Error("Payment reference is required before marking an invoice paid.");
  }
  if (input.status === InvoiceStatus.VOID && !input.voidReason?.trim()) {
    throw new Error("Void reason is required before voiding an invoice.");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.supplierInvoice.findUniqueOrThrow({
      where: { id: input.invoiceId },
      include: {
        paymentAllocations: true,
        accountingDocuments: { select: { id: true } }
      }
    });

    if (!INVOICE_TRANSITIONS[current.status].has(input.status)) {
      throw new Error(`Cannot transition supplier invoice from ${current.status} to ${input.status}.`);
    }
    if (input.status === InvoiceStatus.APPROVED && !invoiceHasSourceEvidence(current)) {
      throw new Error("Source evidence is required before approving a supplier invoice.");
    }

    const now = new Date();
    let paymentJournalEntryId: string | undefined;
    let paymentAllocationId: string | undefined;
    if (input.status === InvoiceStatus.PAID) {
      const allocatedBefore = current.paymentAllocations.reduce((total, allocation) => total.plus(allocation.amount), new Prisma.Decimal(0));
      const remaining = current.total.minus(allocatedBefore).toDecimalPlaces(2);
      if (remaining.gt(0)) {
        const allocation = await tx.supplierInvoicePaymentAllocation.create({
          data: {
            supplierInvoiceId: current.id,
            amount: remaining,
            currency: current.currency,
            paymentDate: now,
            reference: input.paymentReference!.trim(),
            reconciledBy: input.actor.id,
            notes: "Manual supplier-invoice payment reference entered from invoice ledger."
          }
        });
        paymentAllocationId = allocation.id;
        const paymentJournal = await postSupplierPaymentJournal({ paymentAllocationId: allocation.id, actor: input.actor, tx });
        paymentJournalEntryId = paymentJournal.id;
      }
    }

    const invoice = await tx.supplierInvoice.update({
      where: { id: current.id },
      data: {
        status: input.status,
        ...(input.status === InvoiceStatus.APPROVED
          ? { approvedBy: input.actor.id, approvedAt: now, approvalNotes: input.approvalNotes?.trim() || undefined }
          : {}),
        ...(input.status === InvoiceStatus.PAID
          ? { paidBy: input.actor.id, paidAt: now, paymentReference: input.paymentReference!.trim() }
          : {}),
        ...(input.status === InvoiceStatus.VOID
          ? { voidReason: input.voidReason!.trim() }
          : {})
      },
      include: { supplier: true }
    });

    let approvalJournalEntryId: string | undefined;
    if (input.status === InvoiceStatus.APPROVED) {
      const approvalJournal = await postSupplierInvoiceApprovalJournal({ invoiceId: invoice.id, actor: input.actor, tx });
      approvalJournalEntryId = approvalJournal.id;
    }

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "UPDATE_SUPPLIER_INVOICE_STATUS",
      entityType: "SupplierInvoice",
      entityId: invoice.id,
      payload: {
        fromStatus: current.status,
        toStatus: input.status,
        approvalNotes: input.approvalNotes?.trim() || undefined,
        paymentReference: input.paymentReference?.trim() || undefined,
        voidReason: input.voidReason?.trim() || undefined,
        approvalJournalEntryId,
        paymentAllocationId,
        paymentJournalEntryId
      }
    }, tx);

    return invoice;
  });
}

function invoiceHasSourceEvidence(invoice: {
  sourceDocumentHash?: string | null;
  sourceDocumentPath?: string | null;
  externalSourceUrl?: string | null;
  accountingDocuments?: Array<{ id?: string }>;
}) {
  return Boolean(invoice.sourceDocumentHash || invoice.sourceDocumentPath || invoice.externalSourceUrl || (invoice.accountingDocuments?.length ?? 0) > 0);
}

function invoiceWorkQueueRow(invoice: InvoiceWorkQueueInput, now: Date): InvoiceWorkQueueRow {
  const openBalance = Math.max(0, numberValue(invoice.total) - (invoice.paymentAllocations ?? []).reduce((total, allocation) => total + numberValue(allocation.amount), 0));
  const evidenceCount = invoice.accountingDocuments?.length ?? 0;
  const evidenceReady = invoiceHasSourceEvidence(invoice);
  const dueDate = invoice.dueDate ? startOfUtcDay(invoice.dueDate) : null;
  const warnings = [
    !evidenceReady && invoice.status === InvoiceStatus.RECEIVED ? "No source evidence bundle" : undefined,
    !dueDate && (invoice.status === InvoiceStatus.RECEIVED || invoice.status === InvoiceStatus.APPROVED) ? "Due date not set" : undefined
  ].filter((warning): warning is string => Boolean(warning));

  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    supplierName: invoice.supplier.name,
    status: String(invoice.status),
    currency: invoice.currency,
    openBalance: roundMoney(openBalance),
    dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : null,
    dueLabel: dueDateLabel(dueDate, now),
    evidenceCount,
    evidenceReady,
    journalCount: invoice.journalEntries?.length ?? 0,
    nextAction: invoiceNextAction(String(invoice.status), evidenceReady),
    warnings
  };
}

function invoiceNextAction(status: string, evidenceReady: boolean) {
  if (status === InvoiceStatus.RECEIVED) return evidenceReady ? "Approve & post AP journal" : "Attach or verify source evidence";
  if (status === InvoiceStatus.APPROVED) return "Reconcile payment evidence";
  if (status === InvoiceStatus.PAID) return "Retain audit evidence";
  if (status === InvoiceStatus.VOID) return "Voided";
  return "Review invoice";
}

function compareInvoiceWorkRows(a: InvoiceWorkQueueRow, b: InvoiceWorkQueueRow) {
  return dueRank(a.dueLabel) - dueRank(b.dueLabel)
    || Number(a.evidenceReady) - Number(b.evidenceReady)
    || (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31")
    || b.openBalance - a.openBalance
    || a.invoiceNumber.localeCompare(b.invoiceNumber);
}

function dueRank(label: string) {
  if (label.endsWith("overdue")) return 0;
  if (label === "Due today") return 1;
  if (label.startsWith("Due in")) return 2;
  if (label === "No due date") return 3;
  return 4;
}

function dueDateLabel(dueDate: Date | null, now: Date) {
  if (!dueDate) return "No due date";
  const today = startOfUtcDay(now);
  const days = Math.round((dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  return `Due in ${days}d`;
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function numberValue(value: Prisma.Decimal.Value | number) {
  return typeof value === "number" ? value : Number(value.toString());
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function assertInvoicePermission(actor: AuthenticatedActor, status: InvoiceStatus) {
  if (status === InvoiceStatus.PAID) {
    assertPermission(actor, "invoice:markPaid");
    return;
  }
  if (status === InvoiceStatus.APPROVED || status === InvoiceStatus.VOID) {
    assertPermission(actor, "invoice:approve");
    return;
  }
  assertPermission(actor, "invoice:create");
}
