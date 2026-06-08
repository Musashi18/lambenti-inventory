import { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertPermission, type AuthenticatedActor } from "@/modules/auth/permissions";
import { DEFAULT_CURRENCY, convertToUsd } from "@/modules/currency";

type InvoiceSourceProvenance = {
  invoiceNumber?: string;
  sourceDocumentPath?: string;
  sourceDocumentHash?: string;
  externalSourceUrl?: string;
  notes?: string;
};

function toDecimal(value: Prisma.Decimal.Value | null | undefined, fallback = 0) {
  return value == null ? new Prisma.Decimal(fallback) : new Prisma.Decimal(value);
}

function toUsdMoney(value: Prisma.Decimal.Value, currency: string) {
  return new Prisma.Decimal(convertToUsd(Number(value), currency));
}

function invoiceNumberForPurchaseOrder(order: {
  id: string;
  supplier: { name: string };
  emailOrderImports: Array<{ externalOrderId: string | null }>;
}) {
  const externalOrderId = order.emailOrderImports[0]?.externalOrderId;
  const supplierSlug = order.supplier.name
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .toUpperCase() || "SUPPLIER";
  return externalOrderId ? `${supplierSlug}-${externalOrderId}` : `${supplierSlug}-${order.id.slice(-8).toUpperCase()}`;
}

export async function getInvoiceDashboard() {
  const [invoices, uninvoicedPurchaseOrders] = await Promise.all([
    prisma.supplierInvoice.findMany({
      include: {
        supplier: true,
        purchaseOrder: true,
        lines: { include: { item: true }, orderBy: { description: "asc" } }
      },
      orderBy: { invoiceDate: "desc" }
    }),
    prisma.purchaseOrder.findMany({
      where: {
        invoice: null,
        status: { in: ["ORDERED", "PARTIALLY_RECEIVED", "RECEIVED"] }
      },
      include: {
        supplier: true,
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
      invoice: true,
      lines: { include: { item: true } },
      emailOrderImports: true
    }
  });

  if (order.invoice) {
    if (source?.sourceDocumentPath || source?.sourceDocumentHash || source?.externalSourceUrl) {
      return prisma.supplierInvoice.update({
        where: { id: order.invoice.id },
        data: {
          sourceDocumentPath: source.sourceDocumentPath,
          sourceDocumentHash: source.sourceDocumentHash,
          externalSourceUrl: source.externalSourceUrl
        }
      });
    }
    return order.invoice;
  }
  if (order.lines.length === 0) throw new Error("Cannot invoice a purchase order with no lines.");

  const importRecord = order.emailOrderImports[0];
  const lineSubtotal = order.lines.reduce(
    (total, line) => total.plus(toDecimal(line.unitPrice).times(line.quantity)),
    new Prisma.Decimal(0)
  );
  const importCurrency = importRecord?.currency ?? DEFAULT_CURRENCY;
  const subtotal = importRecord?.subtotal == null ? lineSubtotal : toUsdMoney(importRecord.subtotal, importCurrency);
  const shippingCost = importRecord?.shippingCost == null ? new Prisma.Decimal(0) : toUsdMoney(importRecord.shippingCost, importCurrency);
  const taxCost = importRecord?.taxCost == null ? new Prisma.Decimal(0) : toUsdMoney(importRecord.taxCost, importCurrency);
  const total = importRecord?.totalCost == null ? subtotal.plus(shippingCost).plus(taxCost) : toUsdMoney(importRecord.totalCost, importCurrency);
  const invoiceNumber = source?.invoiceNumber ?? invoiceNumberForPurchaseOrder(order);

  let invoice;
  try {
    invoice = await prisma.supplierInvoice.create({
      data: {
        invoiceNumber,
        supplierId: order.supplierId,
        purchaseOrderId: order.id,
        status: "RECEIVED",
        currency: DEFAULT_CURRENCY,
        subtotal,
        shippingCost,
        taxCost,
        total,
        invoiceDate: order.orderedAt ?? new Date(),
        sourceDocumentPath: source?.sourceDocumentPath,
        sourceDocumentHash: source?.sourceDocumentHash,
        externalSourceUrl: source?.externalSourceUrl,
        notes: source?.notes ?? (importRecord?.externalOrderId
          ? `Auto-created from Email Import order ${importRecord.externalOrderId}. Verify against supplier invoice before marking paid.`
          : "Auto-created from incoming purchase order. Verify against supplier invoice before marking paid."),
        lines: {
          create: order.lines.map((line) => ({
            itemId: line.itemId,
            description: `${line.item.sku} — ${line.item.description}`,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: toDecimal(line.unitPrice).times(line.quantity)
          }))
        }
      },
      include: { supplier: true, purchaseOrder: true, lines: { include: { item: true } } }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.supplierInvoice.findUnique({
        where: { purchaseOrderId: order.id },
        include: { supplier: true, purchaseOrder: true, lines: { include: { item: true } } }
      });
      if (existing) return existing;
    }
    throw error;
  }

  await writeAuditLog({
    actorType: "USER",
    actorId,
    action: "CREATE_SUPPLIER_INVOICE_FROM_PO",
    entityType: "SupplierInvoice",
    entityId: invoice.id,
    payload: { purchaseOrderId: order.id, invoiceNumber, total: invoice.total.toString() }
  });

  return invoice;
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
      select: { id: true, status: true }
    });

    if (!INVOICE_TRANSITIONS[current.status].has(input.status)) {
      throw new Error(`Cannot transition supplier invoice from ${current.status} to ${input.status}.`);
    }

    const now = new Date();
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
        voidReason: input.voidReason?.trim() || undefined
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
