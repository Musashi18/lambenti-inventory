"use server";

import { CustomerInvoiceStatus } from "@prisma/client";
import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";
import { createCustomerInvoice, updateCustomerInvoiceStatus } from "@/modules/accounting/customer-invoices";

export async function createCustomerInvoiceAction(formData: FormData) {
  const actor = await requirePermission("invoice:create");
  const customerName = stringField(formData, "customerName");
  const invoiceNumber = stringField(formData, "invoiceNumber");
  const description = stringField(formData, "description");
  const quantity = numberField(formData, "quantity") ?? 1;
  const unitPrice = numberField(formData, "unitPrice");
  if (!customerName || !invoiceNumber || !description || unitPrice == null) {
    return { ok: false, message: "Customer, invoice number, description, and unit price are required." };
  }
  await createCustomerInvoice({
    customerName,
    companyName: stringField(formData, "companyName"),
    contactEmail: stringField(formData, "contactEmail"),
    taxRegistrationNumber: stringField(formData, "taxRegistrationNumber"),
    invoiceNumber,
    currency: stringField(formData, "currency") ?? "CAD",
    invoiceDate: dateField(formData, "invoiceDate"),
    dueDate: dateField(formData, "dueDate"),
    notes: stringField(formData, "notes"),
    lines: [{ description, quantity, unitPrice, taxRate: numberField(formData, "taxRate") }],
    actor
  });
  revalidateWorkspace(["/accounting/customer-invoices"]);
  return { ok: true, message: "Customer invoice created." };
}

export async function updateCustomerInvoiceStatusAction(formData: FormData) {
  const customerInvoiceId = stringField(formData, "customerInvoiceId");
  const status = stringField(formData, "status");
  if (!customerInvoiceId || !status || !Object.values(CustomerInvoiceStatus).includes(status as CustomerInvoiceStatus)) {
    return { ok: false, message: "Valid customer invoice and status are required." };
  }
  const permission = status === CustomerInvoiceStatus.PAID ? "invoice:markPaid" : "invoice:create";
  const actor = await requirePermission(permission);
  await updateCustomerInvoiceStatus({
    customerInvoiceId,
    status: status as CustomerInvoiceStatus,
    paymentReference: stringField(formData, "paymentReference"),
    voidReason: stringField(formData, "voidReason"),
    actor
  });
  revalidateWorkspace(["/accounting/customer-invoices"]);
  return { ok: true, message: "Customer invoice status updated." };
}

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(formData: FormData, key: string) {
  const value = stringField(formData, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateField(formData: FormData, key: string) {
  const value = stringField(formData, key);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
