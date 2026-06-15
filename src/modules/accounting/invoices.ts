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

  return { invoices, uninvoicedPurchaseOrders, totalsByStatus };
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

  const hasExplicitInvoiceIdentity = Boolean(source?.invoiceNumber?.trim() || sourceHash || source?.externalSourceUrl?.trim());
  if (!hasExplicitInvoiceIdentity && order.invoices.length > 0) {
    return order.invoices[0];
  }

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
        externalSourceUrl: source?.externalSourceUrl,
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
  if (!source) return prisma.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const data: Prisma.SupplierInvoiceUpdateInput = {
    sourceDocumentPath: source.sourceDocumentPath ?? undefined,
    sourceDocumentHash: source.sourceDocumentHash ?? undefined,
    externalSourceUrl: source.externalSourceUrl ?? undefined,
    dueDate: source.dueDate ?? undefined,
    notes: source.notes ?? undefined
  };
  return prisma.supplierInvoice.update({ where: { id: invoiceId }, data });
}

type InvoiceTransitionInput = {
  invoiceId: string;
  status: InvoiceStatus;
  actor: AuthenticatedActor;
  approvalNotes?: string;
  paymentReference?: string;
  voidReason?: string;
};

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
      include: { paymentAllocations: true }
    });

    if (!INVOICE_TRANSITIONS[current.status].has(input.status)) {
      throw new Error(`Cannot transition supplier invoice from ${current.status} to ${input.status}.`);
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
