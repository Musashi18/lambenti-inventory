"use server";

import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";
import { importBankTransactions, reconcileBankTransactionToInvoice } from "@/modules/accounting/payments";

export async function importBankTransactionAction(formData: FormData) {
  const actor = await requirePermission("invoice:markPaid");
  const source = stringField(formData, "source") ?? "MANUAL_BANK_IMPORT";
  const postedAt = dateField(formData, "postedAt") ?? new Date();
  const description = stringField(formData, "description");
  const amount = numberField(formData, "amount");
  if (!description) return { ok: false, message: "Bank transaction description is required." };
  if (amount == null) return { ok: false, message: "Bank transaction amount is required." };

  await importBankTransactions({
    actor,
    rows: [{
      source,
      accountName: stringField(formData, "accountName"),
      postedAt,
      description,
      counterparty: stringField(formData, "counterparty"),
      currency: stringField(formData, "currency") ?? "USD",
      amount,
      reference: stringField(formData, "reference")
    }]
  });
  revalidateWorkspace(["/accounting/payments", "/accounting/invoices"]);
  return { ok: true, message: "Bank transaction imported for reconciliation." };
}

export async function reconcilePaymentAction(formData: FormData) {
  const actor = await requirePermission("invoice:markPaid");
  const supplierInvoiceId = stringField(formData, "supplierInvoiceId");
  if (!supplierInvoiceId) return { ok: false, message: "Choose a supplier invoice to reconcile." };
  await reconcileBankTransactionToInvoice({
    supplierInvoiceId,
    bankTransactionId: stringField(formData, "bankTransactionId"),
    amount: numberField(formData, "amount"),
    reference: stringField(formData, "reference"),
    paidAt: dateField(formData, "paidAt"),
    notes: stringField(formData, "notes"),
    actor
  });
  revalidateWorkspace(["/accounting/payments", "/accounting/invoices"]);
  return { ok: true, message: "Payment reconciled to supplier invoice." };
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
