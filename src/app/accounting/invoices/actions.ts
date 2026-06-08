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

  const actor = await requirePermission("invoice:create");
  await createInvoiceFromPurchaseOrder(purchaseOrderId, actor.id);
  revalidateWorkspace();
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

  await updateInvoiceStatus({
    invoiceId,
    status: targetStatus,
    actor,
    approvalNotes: optionalString(formData.get("approvalNotes")),
    paymentReference: optionalString(formData.get("paymentReference")),
    voidReason: optionalString(formData.get("voidReason"))
  });
  revalidateWorkspace();
}

function optionalString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
