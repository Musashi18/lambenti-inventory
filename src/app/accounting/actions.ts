"use server";

import { revalidateWorkspace } from "@/app/revalidate-workspace";
import { requirePermission } from "@/modules/auth/permissions";
import {
  applyAccountingDocumentAnalysis,
  attachAccountingDocumentEvidence,
  deleteAccountingDocumentSource,
  ingestAccountingDocumentUpload,
  retryAccountingDocumentExtraction,
  updateAccountingDocumentExtractedText
} from "@/modules/accounting/documents";

export type AccountingDocumentUploadActionResult = {
  ok: boolean;
  message: string;
  documents: Array<{
    id: string;
    originalFileName: string;
    status: string;
    duplicate: boolean;
    classification?: string;
    supplierName?: string;
    invoiceNumber?: string;
    currency?: string;
    total?: number;
    suggestedActions?: string[];
  }>;
};

export async function uploadAccountingDocumentsAction(formData: FormData): Promise<AccountingDocumentUploadActionResult> {
  const files = formData.getAll("documents").filter((value): value is File => typeof value !== "string" && value instanceof File && value.size > 0);
  if (files.length === 0) {
    return { ok: false, message: "Drop or choose at least one PDF, email, screenshot, or text document.", documents: [] };
  }

  const actor = await requirePermission("invoice:create");
  const results = [];
  for (const file of files) {
    const result = await ingestAccountingDocumentUpload({ file, actorId: actor.id });
    results.push({
      id: result.document.id,
      originalFileName: result.document.originalFileName,
      status: result.document.status,
      duplicate: result.duplicate,
      classification: result.analysis?.classification,
      supplierName: result.analysis?.supplierName,
      invoiceNumber: result.analysis?.invoiceNumber,
      currency: result.analysis?.currency,
      total: result.analysis?.total,
      suggestedActions: result.analysis?.suggestedActions
    });
  }

  revalidateWorkspace(["/accounting"]);
  return {
    ok: true,
    message: `Saved and analyzed ${results.length} accounting document${results.length === 1 ? "" : "s"}.`,
    documents: results
  };
}

export async function applyAccountingDocumentAction(formData: FormData) {
  const documentId = stringField(formData, "documentId");
  const purchaseOrderId = optionalStringField(formData, "purchaseOrderId");
  if (!documentId) return { ok: false, message: "Missing accounting document id." };

  const actor = await requirePermission("invoice:create");
  await applyAccountingDocumentAnalysis({ documentId, purchaseOrderId, actor });
  revalidateWorkspace(["/accounting", "/accounting/invoices"]);
  return { ok: true, message: "Accounting document applied to supplier invoice records." };
}

export async function attachAccountingDocumentEvidenceAction(formData: FormData) {
  const documentId = stringField(formData, "documentId");
  const purchaseOrderId = optionalStringField(formData, "purchaseOrderId");
  const supplierInvoiceId = optionalStringField(formData, "supplierInvoiceId");
  const emailOrderImportId = optionalStringField(formData, "emailOrderImportId");
  if (!documentId) return { ok: false, message: "Missing accounting document id." };

  const actor = await requirePermission("invoice:create");
  await attachAccountingDocumentEvidence({ documentId, purchaseOrderId, supplierInvoiceId, emailOrderImportId, actor });
  revalidateWorkspace(["/accounting", "/accounting/invoices"]);
  return { ok: true, message: "Document attached as accounting evidence. No stock, payment, or invoice status was changed." };
}

export async function retryAccountingDocumentExtractionAction(formData: FormData) {
  const documentId = stringField(formData, "documentId");
  if (!documentId) return { ok: false, message: "Missing accounting document id." };

  const actor = await requirePermission("invoice:create");
  const result = await retryAccountingDocumentExtraction({ documentId, actor });
  revalidateWorkspace(["/accounting"]);
  return {
    ok: true,
    message: result.document.extractedText
      ? `Re-analyzed ${result.document.originalFileName} as ${result.analysis.classification}.`
      : `No readable text found in ${result.document.originalFileName}; paste extracted text manually or configure OCR.`
  };
}

export async function updateAccountingDocumentTextAction(formData: FormData) {
  const documentId = stringField(formData, "documentId");
  const text = stringField(formData, "extractedText");
  if (!documentId) return { ok: false, message: "Missing accounting document id." };
  if (!text) return { ok: false, message: "Paste source document text before analyzing." };

  const actor = await requirePermission("invoice:create");
  const result = await updateAccountingDocumentExtractedText({ documentId, text, actor });
  revalidateWorkspace(["/accounting"]);
  return { ok: true, message: `Saved text and analyzed ${result.document.originalFileName} as ${result.analysis.classification}.` };
}

export async function deleteAccountingDocumentAction(formData: FormData) {
  const documentId = stringField(formData, "documentId");
  if (!documentId) return { ok: false, message: "Missing accounting document id." };

  const actor = await requirePermission("invoice:create");
  const deleted = await deleteAccountingDocumentSource({ documentId, actor });
  revalidateWorkspace(["/accounting"]);
  return { ok: true, message: `Deleted source document ${deleted.originalFileName}.` };
}

function stringField(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalStringField(formData: FormData, key: string) {
  return stringField(formData, key);
}
