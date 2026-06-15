"use server";

import { InvoiceStatus } from "@prisma/client";
import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";
import { createInvoiceFromPurchaseOrder, updateInvoiceStatus } from "@/modules/accounting/invoices";

export async function createInvoiceFromPurchaseOrderAction(formData: FormData) {
  const purchaseOrderId = formData.get("purchaseOrderId");
  if (typeof purchaseOrderId !== "string" || purchaseOrderId.trim() === "") {
    throw new Error("Missing purchase order id.");
  }

  const invoiceNumber = optionalString(formData.get("invoiceNumber"));
  const subtotal = optionalNumber(formData.get("subtotal"));
  const taxCost = optionalNumber(formData.get("taxCost"));
  const total = optionalNumber(formData.get("total"));
  const actor = await requirePermission("invoice:create");
  const invoice = await createInvoiceFromPurchaseOrder(purchaseOrderId, actor.id, {
    invoiceNumber,
    subtotal,
    taxCost,
    total,
    notes: optionalString(formData.get("notes"))
  });
  revalidateWorkspace();
  return { ok: true, message: `Supplier invoice ${invoice.invoiceNumber} saved.` };
}

export async function updateInvoiceStatusAction(formData: FormData) {
  const invoiceId = formData.get("invoiceId");
  const status = formData.get("status");
  if (typeof invoiceId !== "string" || invoiceId.trim() === "") {
    throw new Error("Missing invoice id.");
  }
  if (typeof status !== "string" || !Object.values(InvoiceStatus).includes(status as InvoiceStatus)) {
    throw new Error("Invalid invoice status.");
  }

  const targetStatus = status as InvoiceStatus;
  const permission = targetStatus === InvoiceStatus.PAID ? "invoice:markPaid" : targetStatus === InvoiceStatus.APPROVED || targetStatus === InvoiceStatus.VOID ? "invoice:approve" : "invoice:create";
  const actor = await requirePermission(permission);

  const invoice = await updateInvoiceStatus({
    invoiceId,
    status: targetStatus,
    actor,
    approvalNotes: optionalString(formData.get("approvalNotes")),
    paymentReference: optionalString(formData.get("paymentReference")),
    voidReason: optionalString(formData.get("voidReason"))
  });
  revalidateWorkspace();
  return { ok: true, message: `Supplier invoice ${invoice.invoiceNumber} is now ${invoice.status}.` };
}

function optionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalNumber(value: FormDataEntryValue | null) {
  const text = optionalString(value);
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
