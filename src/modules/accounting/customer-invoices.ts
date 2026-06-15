import { CustomerInvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertPermission, type AuthenticatedActor } from "@/modules/auth/permissions";

export type CreateCustomerInvoiceInput = {
  customerName: string;
  companyName?: string;
  contactEmail?: string;
  taxRegistrationNumber?: string;
  invoiceNumber: string;
  currency?: string;
  invoiceDate?: Date;
  dueDate?: Date;
  notes?: string;
  lines: Array<{
    itemId?: string;
    description: string;
    quantity: number;
    unitPrice: Prisma.Decimal.Value;
    taxRate?: Prisma.Decimal.Value;
  }>;
  actor: AuthenticatedActor;
};

export async function getCustomerInvoiceDashboard() {
  const invoices = await prisma.customerInvoice.findMany({
    include: { customer: true, lines: { include: { item: true }, orderBy: { description: "asc" } } },
    orderBy: { invoiceDate: "desc" }
  });
  const openInvoices = invoices.filter((invoice) => invoice.status === CustomerInvoiceStatus.DRAFT || invoice.status === CustomerInvoiceStatus.SENT);
  const totalsByStatus = invoices.reduce<Record<string, Prisma.Decimal>>((acc, invoice) => {
    acc[invoice.status] = (acc[invoice.status] ?? new Prisma.Decimal(0)).plus(invoice.total);
    return acc;
  }, {});
  return { invoices, openInvoices, totalsByStatus };
}

export async function createCustomerInvoice(input: CreateCustomerInvoiceInput) {
  assertPermission(input.actor, "invoice:create");
  if (!input.customerName.trim()) throw new Error("Customer name is required.");
  if (!input.invoiceNumber.trim()) throw new Error("Customer invoice number is required.");
  if (input.lines.length === 0) throw new Error("At least one customer invoice line is required.");

  const lines = input.lines.map((line) => normalizeLine(line));
  const subtotal = lines.reduce((total, line) => total.plus(line.lineTotal), new Prisma.Decimal(0));
  const taxCost = lines.reduce((total, line) => total.plus(line.taxAmount), new Prisma.Decimal(0));
  const total = subtotal.plus(taxCost);
  const customerName = input.customerName.trim();

  const invoice = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.upsert({
      where: { name: customerName },
      create: {
        name: customerName,
        companyName: input.companyName?.trim() || undefined,
        contactEmail: input.contactEmail?.trim() || undefined,
        taxRegistrationNumber: input.taxRegistrationNumber?.trim() || undefined
      },
      update: {
        companyName: input.companyName?.trim() || undefined,
        contactEmail: input.contactEmail?.trim() || undefined,
        taxRegistrationNumber: input.taxRegistrationNumber?.trim() || undefined
      }
    });

    const created = await tx.customerInvoice.create({
      data: {
        invoiceNumber: input.invoiceNumber.trim(),
        customerId: customer.id,
        status: CustomerInvoiceStatus.DRAFT,
        currency: input.currency?.trim().toUpperCase() || "CAD",
        subtotal,
        taxCost,
        total,
        invoiceDate: input.invoiceDate ?? new Date(),
        dueDate: input.dueDate,
        notes: input.notes?.trim() || undefined,
        lines: { create: lines }
      },
      include: { customer: true, lines: { include: { item: true } } }
    });

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "CREATE_CUSTOMER_INVOICE",
      entityType: "CustomerInvoice",
      entityId: created.id,
      payload: { invoiceNumber: created.invoiceNumber, customerId: customer.id, total: created.total.toString() }
    }, tx);

    return created;
  });

  return invoice;
}

export async function updateCustomerInvoiceStatus(input: {
  customerInvoiceId: string;
  status: CustomerInvoiceStatus;
  actor: AuthenticatedActor;
  paymentReference?: string;
  voidReason?: string;
}) {
  assertCustomerInvoicePermission(input.actor, input.status);
  if (input.status === CustomerInvoiceStatus.PAID && !input.paymentReference?.trim()) {
    throw new Error("Payment reference is required before marking a customer invoice paid.");
  }
  if (input.status === CustomerInvoiceStatus.VOID && !input.voidReason?.trim()) {
    throw new Error("Void reason is required before voiding a customer invoice.");
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.customerInvoice.findUniqueOrThrow({ where: { id: input.customerInvoiceId }, select: { id: true, status: true } });
    if (!CUSTOMER_INVOICE_TRANSITIONS[current.status].has(input.status)) {
      throw new Error(`Cannot transition customer invoice from ${current.status} to ${input.status}.`);
    }
    const now = new Date();
    const invoice = await tx.customerInvoice.update({
      where: { id: current.id },
      data: {
        status: input.status,
        ...(input.status === CustomerInvoiceStatus.SENT ? { sentBy: input.actor.id, sentAt: now } : {}),
        ...(input.status === CustomerInvoiceStatus.PAID ? { paidBy: input.actor.id, paidAt: now, paymentReference: input.paymentReference!.trim() } : {}),
        ...(input.status === CustomerInvoiceStatus.VOID ? { voidReason: input.voidReason!.trim() } : {})
      },
      include: { customer: true, lines: true }
    });

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "UPDATE_CUSTOMER_INVOICE_STATUS",
      entityType: "CustomerInvoice",
      entityId: invoice.id,
      payload: { fromStatus: current.status, toStatus: input.status, paymentReference: input.paymentReference?.trim(), voidReason: input.voidReason?.trim() }
    }, tx);

    return invoice;
  });
}

const CUSTOMER_INVOICE_TRANSITIONS: Record<CustomerInvoiceStatus, Set<CustomerInvoiceStatus>> = {
  [CustomerInvoiceStatus.DRAFT]: new Set([CustomerInvoiceStatus.SENT, CustomerInvoiceStatus.VOID]),
  [CustomerInvoiceStatus.SENT]: new Set([CustomerInvoiceStatus.PAID, CustomerInvoiceStatus.VOID]),
  [CustomerInvoiceStatus.PAID]: new Set([]),
  [CustomerInvoiceStatus.VOID]: new Set([])
};

function assertCustomerInvoicePermission(actor: AuthenticatedActor, status: CustomerInvoiceStatus) {
  if (status === CustomerInvoiceStatus.PAID) {
    assertPermission(actor, "invoice:markPaid");
    return;
  }
  assertPermission(actor, "invoice:create");
}

function normalizeLine(line: CreateCustomerInvoiceInput["lines"][number]) {
  if (!line.description.trim()) throw new Error("Customer invoice line description is required.");
  if (line.quantity <= 0) throw new Error("Customer invoice line quantity must be positive.");
  const unitPrice = new Prisma.Decimal(line.unitPrice);
  const taxRate = line.taxRate == null ? undefined : new Prisma.Decimal(line.taxRate);
  const lineTotal = unitPrice.times(line.quantity).toDecimalPlaces(2);
  const taxAmount = taxRate ? lineTotal.times(taxRate).toDecimalPlaces(2) : new Prisma.Decimal(0);
  return {
    itemId: line.itemId,
    description: line.description.trim(),
    quantity: line.quantity,
    unitPrice,
    taxRate,
    lineTotal,
    taxAmount
  };
}
