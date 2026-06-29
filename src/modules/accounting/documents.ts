import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { AccountingDocumentStatus, InvoiceStatus, Prisma, PurchaseOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { assertPermission, type AuthenticatedActor } from "@/modules/auth/permissions";
import { parseAlibabaEmail } from "@/modules/email-imports/alibaba-email";
import { extractAccountingDocumentText } from "@/modules/documents/extract";
import { saveAccountingDocumentFile } from "@/modules/documents/storage";
import { createInvoiceFromPurchaseOrder, normalizeInvoiceNumberKey } from "./invoices";

export type AccountingUploadFile = {
  name: string;
  type?: string;
  size?: number;
  arrayBuffer: () => Promise<ArrayBuffer | SharedArrayBuffer>;
};

export type AccountingDocumentClassification =
  | "SUPPLIER_INVOICE"
  | "ORDER_NOTICE"
  | "PAYMENT_RECEIPT"
  | "PACKING_SLIP"
  | "CUSTOMS_DOCUMENT"
  | "QUOTE_OR_PRO_FORMA"
  | "UNKNOWN";

export type AccountingDocumentAnalysis = {
  schemaVersion: "accounting-document-v1";
  classification: AccountingDocumentClassification;
  direction: "AP" | "AR" | "UNKNOWN";
  supplierName?: string;
  invoiceNumber?: string;
  externalOrderId?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency: string;
  subtotal?: number;
  shippingCost?: number;
  taxCost?: number;
  total?: number;
  lineCount: number;
  lines: Array<{
    description: string;
    quantity: number;
    unitPrice?: number;
    lineTotal?: number;
    supplierSku?: string;
  }>;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  requiredReview: string[];
  suggestedActions: string[];
  sourceDocumentRequirements: string[];
  canadianAccountingNotes: string[];
  duplicateKeys: string[];
  matchedSupplierId?: string;
  matchedPurchaseOrderId?: string;
  matchedSupplierInvoiceId?: string;
  warnings: string[];
};

export async function getAccountingWorkbench() {
  const documents = await prisma.accountingDocument.findMany({
    include: {
      supplier: true,
      purchaseOrder: { include: { supplier: true } },
      supplierInvoice: { include: { supplier: true } },
      emailOrderImport: true
    },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  return { documents };
}

export async function ingestAccountingDocumentUpload(input: { file: AccountingUploadFile; actorId: string; source?: string }) {
  const arrayBuffer = await input.file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const stored = await saveAccountingDocumentFile({
    originalFileName: input.file.name,
    mimeType: input.file.type,
    buffer
  });

  const existing = await prisma.accountingDocument.findUnique({
    where: { sha256: stored.sha256 },
    include: { supplier: true, purchaseOrder: true, supplierInvoice: true, emailOrderImport: true }
  });
  if (existing) {
    if (!existing.extractedText && canAccountingDocumentBeReanalyzed(existing)) {
      const extracted = await extractAccountingDocumentText({
        buffer,
        mimeType: stored.mimeType,
        originalFileName: stored.originalFileName
      });
      const outcome = await analyzeExtractionOutcome({
        extractedText: extracted.text,
        extractionWarnings: extracted.warnings,
        originalFileName: stored.originalFileName,
        sha256: stored.sha256
      });
      const updated = await prisma.accountingDocument.update({
        where: { id: existing.id },
        data: {
          extractedText: extracted.text,
          analysisJson: toJson(outcome.analysis),
          status: outcome.status,
          errorMessage: outcome.errorMessage,
          supplierId: outcome.supplierId,
          purchaseOrderId: outcome.purchaseOrderId,
          supplierInvoiceId: outcome.supplierInvoiceId
        },
        include: { supplier: true, purchaseOrder: true, supplierInvoice: true, emailOrderImport: true }
      });
      await writeAuditLog({
        actorType: "USER",
        actorId: input.actorId,
        action: "REANALYZE_DUPLICATE_ACCOUNTING_DOCUMENT_UPLOAD",
        entityType: "AccountingDocument",
        entityId: existing.id,
        payload: {
          originalFileName: stored.originalFileName,
          sha256: stored.sha256,
          status: outcome.status,
          classification: outcome.analysis.classification,
          hadExtractedText: Boolean(extracted.text)
        }
      });
      return {
        document: updated,
        analysis: outcome.analysis,
        duplicate: true
      };
    }
    return {
      document: existing,
      analysis: normalizeAnalysis(existing.analysisJson),
      duplicate: true
    };
  }

  const extracted = await extractAccountingDocumentText({
    buffer,
    mimeType: stored.mimeType,
    originalFileName: stored.originalFileName
  });

  const outcome = await analyzeExtractionOutcome({
    extractedText: extracted.text,
    extractionWarnings: extracted.warnings,
    originalFileName: stored.originalFileName,
    sha256: stored.sha256
  });
  const { analysis, supplierId, purchaseOrderId, supplierInvoiceId, status, errorMessage } = outcome;

  const document = await prisma.accountingDocument.create({
    data: {
      source: input.source ?? "MANUAL_UPLOAD",
      sourceKind: classifySourceKind(stored.mimeType, stored.originalFileName),
      originalFileName: stored.originalFileName,
      storedPath: stored.storedPath,
      sha256: stored.sha256,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      extractedText: extracted.text,
      analysisJson: analysis ? toJson(analysis) : undefined,
      status,
      errorMessage,
      uploadedBy: input.actorId,
      supplierId,
      purchaseOrderId,
      supplierInvoiceId
    },
    include: { supplier: true, purchaseOrder: true, supplierInvoice: true, emailOrderImport: true }
  });

  await writeAuditLog({
    actorType: "USER",
    actorId: input.actorId,
    action: "INGEST_ACCOUNTING_DOCUMENT",
    entityType: "AccountingDocument",
    entityId: document.id,
    payload: {
      originalFileName: stored.originalFileName,
      sha256: stored.sha256,
      status,
      classification: analysis?.classification,
      purchaseOrderId,
      supplierInvoiceId
    }
  });

  return { document, analysis, duplicate: false };
}

export async function retryAccountingDocumentExtraction(input: {
  documentId: string;
  actor: AuthenticatedActor;
}) {
  assertPermission(input.actor, "invoice:create");

  const document = await prisma.accountingDocument.findUniqueOrThrow({ where: { id: input.documentId } });
  assertAccountingDocumentCanBeReanalyzed(document);
  const buffer = await readFile(join(process.cwd(), document.storedPath));
  const extracted = await extractAccountingDocumentText({
    buffer,
    mimeType: document.mimeType,
    originalFileName: document.originalFileName
  });
  const outcome = await analyzeExtractionOutcome({
    extractedText: extracted.text,
    extractionWarnings: extracted.warnings,
    originalFileName: document.originalFileName,
    sha256: document.sha256
  });

  const updated = await prisma.accountingDocument.update({
    where: { id: document.id },
    data: {
      extractedText: extracted.text,
      analysisJson: toJson(outcome.analysis),
      status: outcome.status,
      errorMessage: outcome.errorMessage,
      supplierId: outcome.supplierId,
      purchaseOrderId: outcome.purchaseOrderId,
      supplierInvoiceId: outcome.supplierInvoiceId
    },
    include: { supplier: true, purchaseOrder: true, supplierInvoice: true, emailOrderImport: true }
  });

  await writeAuditLog({
    actorType: input.actor.actorType,
    actorId: input.actor.id,
    action: "RETRY_ACCOUNTING_DOCUMENT_EXTRACTION",
    entityType: "AccountingDocument",
    entityId: document.id,
    payload: {
      status: outcome.status,
      classification: outcome.analysis.classification,
      hadExtractedText: Boolean(extracted.text)
    }
  });

  return { document: updated, analysis: outcome.analysis };
}

export async function updateAccountingDocumentExtractedText(input: {
  documentId: string;
  text: string;
  actor: AuthenticatedActor;
}) {
  assertPermission(input.actor, "invoice:create");
  const text = input.text.trim();
  if (text.length < 10) throw new Error("Paste at least 10 characters of source document text before analyzing.");

  const document = await prisma.accountingDocument.findUniqueOrThrow({ where: { id: input.documentId } });
  assertAccountingDocumentCanBeReanalyzed(document);
  const outcome = await analyzeExtractionOutcome({
    extractedText: text,
    extractionWarnings: [],
    originalFileName: document.originalFileName,
    sha256: document.sha256
  });

  const updated = await prisma.accountingDocument.update({
    where: { id: document.id },
    data: {
      extractedText: text,
      analysisJson: toJson(outcome.analysis),
      status: outcome.status,
      errorMessage: null,
      supplierId: outcome.supplierId,
      purchaseOrderId: outcome.purchaseOrderId,
      supplierInvoiceId: outcome.supplierInvoiceId
    },
    include: { supplier: true, purchaseOrder: true, supplierInvoice: true, emailOrderImport: true }
  });

  await writeAuditLog({
    actorType: input.actor.actorType,
    actorId: input.actor.id,
    action: "UPDATE_ACCOUNTING_DOCUMENT_EXTRACTED_TEXT",
    entityType: "AccountingDocument",
    entityId: document.id,
    payload: {
      status: outcome.status,
      classification: outcome.analysis.classification,
      manualTextLength: text.length
    }
  });

  return { document: updated, analysis: outcome.analysis };
}

export async function deleteAccountingDocumentSource(input: {
  documentId: string;
  actor: AuthenticatedActor;
}) {
  assertPermission(input.actor, "invoice:create");

  const deleted = await prisma.$transaction(async (tx) => {
    const document = await tx.accountingDocument.findUniqueOrThrow({ where: { id: input.documentId } });
    if (
      document.status === AccountingDocumentStatus.APPLIED
      || document.status === AccountingDocumentStatus.ATTACHED
    ) {
      throw new Error("Attached or applied accounting documents cannot be deleted. Keep them as audit evidence for the linked operational record.");
    }

    const snapshot = {
      id: document.id,
      originalFileName: document.originalFileName,
      storedPath: document.storedPath,
      sha256: document.sha256,
      status: document.status
    };

    await writeAuditLog({
      actorType: input.actor.actorType,
      actorId: input.actor.id,
      action: "DELETE_ACCOUNTING_DOCUMENT_SOURCE",
      entityType: "AccountingDocument",
      entityId: document.id,
      payload: snapshot
    }, tx);

    await tx.accountingDocument.delete({ where: { id: document.id } });
    return snapshot;
  });

  await unlink(join(process.cwd(), deleted.storedPath)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });

  return deleted;
}

function assertAccountingDocumentCanBeReanalyzed(document: {
  status: AccountingDocumentStatus;
  supplierInvoiceId: string | null;
}) {
  if (!canAccountingDocumentBeReanalyzed(document)) {
    throw new Error("Linked accounting evidence cannot be re-analyzed. Upload a corrected source document or attach a separate supporting document instead.");
  }
}

function canAccountingDocumentBeReanalyzed(document: {
  status: AccountingDocumentStatus;
  supplierInvoiceId: string | null;
}) {
  return document.status !== AccountingDocumentStatus.APPLIED
    && document.status !== AccountingDocumentStatus.ATTACHED
    && document.status !== AccountingDocumentStatus.ARCHIVED
    && !document.supplierInvoiceId;
}

export async function analyzeAccountingDocumentText(input: {
  text: string;
  originalFileName?: string;
  sha256?: string;
  warnings?: string[];
}): Promise<AccountingDocumentAnalysis> {
  const parsed = parseAlibabaEmail(input.text);
  const classification = classifyAccountingDocument(input.text, input.originalFileName);
  const amounts = findAccountingAmounts(input.text);
  const supplierName = pickSupplierName(input.text, parsed.supplierName);
  const invoiceNumber = findInvoiceNumber(input.text) ?? (classification === "SUPPLIER_INVOICE" ? parsed.externalOrderId : undefined);
  const dueDate = findDueDate(input.text);
  const supplier = await findMatchingSupplier(supplierName);
  const hasExplicitAccountingAmounts = amounts.total != null || amounts.subtotal != null || amounts.shippingCost != null || amounts.taxCost != null;
  const hasPricedParsedLines = parsed.lines.some((line) => line.unitPrice != null || line.lineTotal != null);
  const trustParsedAmounts = hasExplicitAccountingAmounts || hasPricedParsedLines;
  const subtotal = amounts.subtotal ?? (trustParsedAmounts ? parsed.subtotal : undefined);
  const shippingCost = amounts.shippingCost ?? (trustParsedAmounts ? parsed.shippingCost : undefined);
  const taxCost = amounts.taxCost ?? (trustParsedAmounts ? parsed.taxCost : undefined);
  const total = chooseAccountingTotal({
    parsedTotal: trustParsedAmounts ? parsed.totalCost : undefined,
    explicitTotal: amounts.total,
    subtotal,
    shippingCost,
    taxCost
  });
  const currency = amounts.currency ?? normalizeAccountingCurrency(parsed.currency);
  const purchaseOrder = await findSuggestedPurchaseOrder({
    supplierId: supplier?.id,
    externalOrderId: parsed.externalOrderId,
    invoiceTotal: total
  });
  const matchedInvoice = await findMatchingSupplierInvoice({
    sha256: input.sha256,
    supplierId: supplier?.id,
    invoiceNumber,
    purchaseOrderId: purchaseOrder?.id
  });

  const requiredReview = buildRequiredReview({
    classification,
    supplierName,
    invoiceNumber,
    total,
    extractedWarnings: input.warnings ?? []
  });
  const suggestedActions = buildSuggestedActions({ classification, purchaseOrderId: purchaseOrder?.id, matchedInvoiceId: matchedInvoice?.id, requiredReview });

  return {
    schemaVersion: "accounting-document-v1",
    classification,
    direction: classification === "SUPPLIER_INVOICE" || classification === "ORDER_NOTICE" || classification === "PAYMENT_RECEIPT" ? "AP" : "UNKNOWN",
    supplierName,
    invoiceNumber,
    externalOrderId: parsed.externalOrderId,
    invoiceDate: parsed.orderDate?.toISOString(),
    dueDate: dueDate?.toISOString(),
    currency,
    subtotal,
    shippingCost,
    taxCost,
    total,
    lineCount: parsed.lines.length,
    lines: parsed.lines.map((line) => ({
      description: line.rawDescription,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      supplierSku: line.supplierSku
    })),
    confidence: requiredReview.length === 0 && (total || parsed.lines.some((line) => line.unitPrice || line.lineTotal)) ? "HIGH" : requiredReview.length <= 2 ? "MEDIUM" : "LOW",
    requiredReview,
    suggestedActions,
    sourceDocumentRequirements: sourceDocumentRequirements(),
    canadianAccountingNotes: canadianAccountingNotes(),
    duplicateKeys: [
      input.sha256 ? `sha256:${input.sha256}` : undefined,
      invoiceNumber ? `supplier-invoice:${supplierName}:${invoiceNumber}:${currency}:${total ?? "unknown"}` : undefined,
      parsed.externalOrderId ? `supplier-order:${supplierName}:${parsed.externalOrderId}` : undefined
    ].filter((value): value is string => Boolean(value)),
    matchedSupplierId: supplier?.id,
    matchedPurchaseOrderId: purchaseOrder?.id,
    matchedSupplierInvoiceId: matchedInvoice?.id,
    warnings: input.warnings ?? []
  };
}

type AccountingExtractionOutcome = {
  analysis: AccountingDocumentAnalysis;
  supplierId?: string;
  purchaseOrderId?: string;
  supplierInvoiceId?: string;
  status: AccountingDocumentStatus;
  errorMessage?: string | null;
};

async function analyzeExtractionOutcome(input: {
  extractedText?: string;
  extractionWarnings: string[];
  originalFileName: string;
  sha256: string;
}): Promise<AccountingExtractionOutcome> {
  const analysis = input.extractedText
    ? await analyzeAccountingDocumentText({
      text: input.extractedText,
      originalFileName: input.originalFileName,
      sha256: input.sha256,
      warnings: input.extractionWarnings
    })
    : buildUnreadableDocumentAnalysis({
      originalFileName: input.originalFileName,
      sha256: input.sha256,
      warnings: input.extractionWarnings
    });

  return {
    analysis,
    supplierId: analysis.matchedSupplierId,
    purchaseOrderId: analysis.matchedPurchaseOrderId,
    supplierInvoiceId: analysis.matchedSupplierInvoiceId,
    status: analysis.requiredReview.length > 0 ? AccountingDocumentStatus.NEEDS_REVIEW : AccountingDocumentStatus.ANALYZED,
    errorMessage: input.extractedText ? null : analysis.requiredReview[0]
  };
}

function buildUnreadableDocumentAnalysis(input: { originalFileName: string; sha256: string; warnings: string[] }): AccountingDocumentAnalysis {
  const reviewMessage = "Paste extracted text manually or retry OCR before applying accounting effects.";
  const warnings = input.warnings.length > 0 ? input.warnings : ["No text could be extracted from the accounting document."];
  const classification = classifyAccountingDocument("", input.originalFileName);

  return {
    schemaVersion: "accounting-document-v1",
    classification,
    direction: classification === "SUPPLIER_INVOICE" || classification === "ORDER_NOTICE" || classification === "PAYMENT_RECEIPT" ? "AP" : "UNKNOWN",
    currency: "USD",
    lineCount: 0,
    lines: [],
    confidence: "LOW",
    requiredReview: Array.from(new Set([reviewMessage, ...warnings])),
    suggestedActions: ["Retry OCR/extraction after enabling OCR support, or paste visible document text into the manual re-analysis box."],
    sourceDocumentRequirements: sourceDocumentRequirements(),
    canadianAccountingNotes: canadianAccountingNotes(),
    duplicateKeys: [`sha256:${input.sha256}`],
    warnings
  };
}

function sourceDocumentRequirements() {
  return [
    "Retain the original private file/email, not only OCR text.",
    "Keep SHA-256 hash, upload actor, capture timestamp, and extraction version for audit trail.",
    "Approve/post/pay only after human review; OCR alone is not payment authority.",
    "For screenshots/scanned PDFs, prefer replacing with original supplier PDF/email when available."
  ];
}

function canadianAccountingNotes() {
  return [
    "Keep business records/supporting documents for at least six years after the related tax year unless a longer rule applies.",
    "For GST/HST ITC support, invoices over CAD 500 generally need supplier GST/HST number, buyer name, description, terms, tax amount/rate or tax-included statement.",
    "Recoverable GST/HST belongs in tax recoverable, not inventory cost; duties/brokerage/non-recoverable taxes can affect landed cost.",
    "Accounting documents may update AP/cost evidence but must not receive inventory stock."
  ];
}

export async function applyAccountingDocumentAnalysis(input: {
  documentId: string;
  actor: AuthenticatedActor;
  purchaseOrderId?: string;
}) {
  assertPermission(input.actor, "invoice:create");

  const document = await prisma.accountingDocument.findUniqueOrThrow({
    where: { id: input.documentId },
    include: { supplierInvoice: true }
  });
  const analysis = normalizeAnalysis(document.analysisJson);
  if (!analysis) throw new Error("Analyze this accounting document before applying it.");
  if (analysis.classification !== "SUPPLIER_INVOICE") {
    throw new Error("Only a reviewed supplier invoice document can create or update supplier invoice records. Attach receipts, packing slips, customs records, quotes, and order notices as evidence instead.");
  }
  if (analysis.requiredReview.length > 0) {
    throw new Error(`Resolve required accounting review before applying this supplier invoice document: ${analysis.requiredReview.join("; ")}`);
  }

  const purchaseOrderId = input.purchaseOrderId ?? document.purchaseOrderId ?? analysis.matchedPurchaseOrderId;
  if (!purchaseOrderId) {
    throw new Error("Select a purchase order before applying this accounting document to invoices.");
  }

  const invoice = await createInvoiceFromPurchaseOrder(purchaseOrderId, input.actor.id, {
    invoiceNumber: analysis.invoiceNumber,
    sourceDocumentPath: document.storedPath,
    sourceDocumentHash: document.sha256,
    notes: `Created from accounting document ${document.originalFileName}. Human review required before payment.`,
    currency: analysis.currency,
    subtotal: analysis.subtotal,
    shippingCost: analysis.shippingCost,
    taxCost: analysis.taxCost,
    total: analysis.total,
    invoiceDate: analysis.invoiceDate ? new Date(analysis.invoiceDate) : undefined,
    dueDate: analysis.dueDate ? new Date(analysis.dueDate) : undefined
  });

  const updated = await prisma.accountingDocument.update({
    where: { id: document.id },
    data: {
      status: AccountingDocumentStatus.APPLIED,
      supplierInvoiceId: invoice.id,
      purchaseOrderId,
      supplierId: invoice.supplierId
    },
    include: { supplier: true, purchaseOrder: true, supplierInvoice: true, emailOrderImport: true }
  });

  await writeAuditLog({
    actorType: input.actor.actorType,
    actorId: input.actor.id,
    action: "APPLY_ACCOUNTING_DOCUMENT_TO_INVOICE",
    entityType: "AccountingDocument",
    entityId: document.id,
    payload: { purchaseOrderId, supplierInvoiceId: invoice.id, sourceDocumentHash: document.sha256 }
  });

  return { document: updated, invoice };
}

export async function attachAccountingDocumentEvidence(input: {
  documentId: string;
  actor: AuthenticatedActor;
  purchaseOrderId?: string;
  supplierInvoiceId?: string;
  emailOrderImportId?: string;
}) {
  assertPermission(input.actor, "invoice:create");

  const document = await prisma.accountingDocument.findUniqueOrThrow({ where: { id: input.documentId } });
  const analysis = normalizeAnalysis(document.analysisJson);
  const supplierInvoiceId = input.supplierInvoiceId ?? document.supplierInvoiceId ?? analysis?.matchedSupplierInvoiceId;
  const invoice = supplierInvoiceId
    ? await prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: supplierInvoiceId },
      select: { id: true, supplierId: true, purchaseOrderId: true, status: true }
    })
    : null;
  if (invoice?.status === InvoiceStatus.VOID) {
    throw new Error("Voided supplier invoices cannot receive new accounting evidence. Choose the active invoice bundle for this order instead.");
  }
  const purchaseOrderId = input.purchaseOrderId ?? document.purchaseOrderId ?? invoice?.purchaseOrderId ?? analysis?.matchedPurchaseOrderId;
  const purchaseOrder = purchaseOrderId
    ? await prisma.purchaseOrder.findUniqueOrThrow({
      where: { id: purchaseOrderId },
      select: { id: true, supplierId: true, invoices: { where: { status: { not: InvoiceStatus.VOID } }, select: { id: true }, orderBy: { invoiceDate: "desc" }, take: 1 } }
    })
    : null;
  const resolvedSupplierInvoiceId = invoice?.id ?? purchaseOrder?.invoices[0]?.id ?? undefined;
  const resolvedPurchaseOrderId = purchaseOrder?.id ?? invoice?.purchaseOrderId ?? undefined;
  const emailOrderImportId = input.emailOrderImportId ?? document.emailOrderImportId ?? undefined;

  if (invoice?.purchaseOrderId && input.purchaseOrderId && invoice.purchaseOrderId !== input.purchaseOrderId) {
    throw new Error("Selected purchase order does not match the selected supplier invoice.");
  }
  if (!resolvedSupplierInvoiceId && !resolvedPurchaseOrderId && !emailOrderImportId) {
    throw new Error("Choose a supplier invoice, purchase order, or email import before attaching accounting evidence.");
  }

  const updated = await prisma.accountingDocument.update({
    where: { id: document.id },
    data: {
      status: AccountingDocumentStatus.ATTACHED,
      supplierInvoiceId: resolvedSupplierInvoiceId,
      purchaseOrderId: resolvedPurchaseOrderId,
      emailOrderImportId,
      supplierId: invoice?.supplierId ?? purchaseOrder?.supplierId ?? document.supplierId ?? analysis?.matchedSupplierId
    },
    include: { supplier: true, purchaseOrder: true, supplierInvoice: true, emailOrderImport: true }
  });

  await writeAuditLog({
    actorType: input.actor.actorType,
    actorId: input.actor.id,
    action: "ATTACH_ACCOUNTING_DOCUMENT_EVIDENCE",
    entityType: "AccountingDocument",
    entityId: document.id,
    payload: {
      supplierInvoiceId: updated.supplierInvoiceId,
      purchaseOrderId: updated.purchaseOrderId,
      emailOrderImportId: updated.emailOrderImportId,
      classification: analysis?.classification,
      sourceDocumentHash: document.sha256
    }
  });

  return { document: updated };
}

function classifyAccountingDocument(text: string, fileName = ""): AccountingDocumentClassification {
  const combined = `${fileName}\n${text}`;
  if (/quote|quotation|pro\s*forma/i.test(combined) && !/tax invoice|commercial invoice/i.test(combined)) return "QUOTE_OR_PRO_FORMA";
  if (/customs|commercial\s+invoice|hs\s*code|dut(?:y|ies)|brokerage|cbsa|import\s+(?:fees|charges|duty)|fedex\s+clearance/i.test(combined) && !/amount\s+due|balance\s+due/i.test(combined)) return "CUSTOMS_DOCUMENT";
  if (/receipt|\bpaid\b|full\s+payment|payment confirmation|wire transfer|bank reference/i.test(combined) && !/amount\s+due|balance\s+due/i.test(combined)) return "PAYMENT_RECEIPT";
  if (/packing\s+slip|delivery\s+note|despatch|dispatch/i.test(combined)) return "PACKING_SLIP";
  if (/invoice|amount\s+due|balance\s+due|gst\/hst|tax invoice/i.test(combined)) return "SUPPLIER_INVOICE";
  if (/purchase\s+order|order\s*(id|no|number|#)|order confirmation|order notice/i.test(combined)) return "ORDER_NOTICE";
  return "UNKNOWN";
}

function pickSupplierName(text: string, parsedSupplierName?: string) {
  return findSupplierNameFromText(text) ?? (isUsefulSupplierName(parsedSupplierName) ? parsedSupplierName?.trim() : undefined);
}

function findSupplierNameFromText(text: string) {
  const soldBy = text.match(/sold\s+by\s*[:#-]?\s*([^\n]+?)(?:\s+(?:chat\s+now|visit\s+store)\b|$)/i)?.[1];
  if (soldBy) return cleanSupplierName(soldBy);

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/(?:com|con|co)\s*pany\s+name/i.test(lines[index])) continue;
    const afterLabel = lines[index].split(/(?:com|con|co)\s*pany\s+name\s*[:#-]?/i)[1];
    if (!afterLabel) continue;
    const primary = afterLabel
      .replace(/\[[\s\S]*$/g, " ")
      .replace(/\b[A-Z]*\s*recipient[\s\S]*$/i, " ")
      .trim();
    const fragments = [primary];
    const continuation = lines.slice(index + 1, index + 3).find((line) => /\b(?:electronics|industrial|technology|trading|co\.?|ltd|lod)\b/i.test(line));
    const cleanedContinuation = continuation ? cleanSupplierName(continuation) : undefined;
    if (cleanedContinuation) fragments.push(cleanedContinuation);
    const candidate = cleanSupplierName(fragments.join(" "));
    if (candidate) return candidate;
  }

  return undefined;
}

function cleanSupplierName(value: string) {
  const cleaned = value
    .replace(/\[[^\]]*$/g, " ")
    .replace(/\b[A-Z]\]/g, " ")
    .replace(/\b(?:recipient|to\s*\(receiver\)|postcode|phone|address)\b[\s\S]*$/i, " ")
    .replace(/\bChat\s+now\b.*$/i, " ")
    .replace(/\bLod\b/g, "Ltd")
    .replace(/[|#*]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[^A-Za-z0-9]+|[.,;:\s]+$/g, "")
    .trim();
  return isUsefulSupplierName(cleaned) ? cleaned : undefined;
}

function isUsefulSupplierName(value?: string) {
  if (!value?.trim()) return false;
  const normalized = value.trim();
  if (normalized.length < 3) return false;
  if (/^(supplier|details|contact|company|company phone|company email|from|to)$/i.test(normalized)) return false;
  if (/supplier\s+contact|company\s+phone|company\s+email|contact\s+name/i.test(normalized)) return false;
  if (/(?:com|con|co)\s*pany\s+name/i.test(normalized)) return false;
  return true;
}

function findAccountingAmounts(text: string) {
  const candidates = [
    findAmountAfterLabel(text, /full\s+payment/i),
    findAmountAfterLabel(text, /we\s+have\s+charged/i),
    findAmountAfterLabel(text, /charged/i),
    findAmountAfterLabel(text, /amount\s+due/i),
    findAmountAfterLabel(text, /balance\s+due/i),
    findAmountAfterLabel(text, /total\s+(?:value|price|amount|due)?/i),
    findAmountAfterLabel(text, /grand\s+total/i)
  ].filter((amount): amount is MoneyAmount => Boolean(amount));
  const total = candidates[0];
  const subtotal = findAmountAfterLabel(text, /item\s+subtotal/i)
    ?? findAmountAfterLabel(text, /subtotal/i);
  const shippingCost = findAmountAfterLabel(text, /shipping\s+(?:fee|cost|amount)?/i)
    ?? findAmountAfterLabel(text, /freight/i);
  const taxCost = findAmountAfterLabel(text, /(?:gst\/?hst|tax|vat)\s*(?:amount|cost)?/i);

  return {
    currency: total?.currency ?? subtotal?.currency ?? shippingCost?.currency ?? taxCost?.currency,
    subtotal: subtotal?.value,
    shippingCost: shippingCost?.value,
    taxCost: taxCost?.value,
    total: total?.value
  };
}

type MoneyAmount = { currency: string; value: number };

function findAmountAfterLabel(text: string, label: RegExp): MoneyAmount | undefined {
  const flags = label.flags.includes("i") ? "ig" : "g";
  const pattern = new RegExp(label.source, flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const slice = text.slice(match.index + match[0].length, match.index + match[0].length + 140);
    const amount = firstCurrencyAmount(slice);
    if (amount) return amount;
  }
  return undefined;
}

const KNOWN_ACCOUNTING_CURRENCIES = new Set(["USD", "CAD", "CNY", "RMB", "EUR", "GBP", "JPY", "HKD", "AUD"]);

function normalizeAccountingCurrency(currency: string | undefined) {
  const normalized = currency?.toUpperCase();
  return normalized && KNOWN_ACCOUNTING_CURRENCIES.has(normalized) ? normalized : "USD";
}

function firstCurrencyAmount(text: string): MoneyAmount | undefined {
  const codeFirstPattern = /\b([A-Z]{3})\b\s*\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\b/gi;
  let codeFirstMatch: RegExpExecArray | null;
  while ((codeFirstMatch = codeFirstPattern.exec(text)) !== null) {
    const currency = codeFirstMatch[1].toUpperCase();
    if (KNOWN_ACCOUNTING_CURRENCIES.has(currency)) {
      return { currency, value: Number(codeFirstMatch[2].replace(/,/g, "")) };
    }
  }

  const amountFirstPattern = /\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*([A-Z]{3})\b/gi;
  let amountFirstMatch: RegExpExecArray | null;
  while ((amountFirstMatch = amountFirstPattern.exec(text)) !== null) {
    const currency = amountFirstMatch[2].toUpperCase();
    if (KNOWN_ACCOUNTING_CURRENCIES.has(currency)) {
      return { currency, value: Number(amountFirstMatch[1].replace(/,/g, "")) };
    }
  }

  const symbolFirstMatch = text.match(/\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*([A-Z]{3})?/i);
  if (!symbolFirstMatch) return undefined;
  const currency = (symbolFirstMatch[2] ?? "USD").toUpperCase();
  return { currency: KNOWN_ACCOUNTING_CURRENCIES.has(currency) ? currency : "USD", value: Number(symbolFirstMatch[1].replace(/,/g, "")) };
}

function chooseAccountingTotal(input: { parsedTotal?: number; explicitTotal?: number; subtotal?: number; shippingCost?: number; taxCost?: number }) {
  if (input.explicitTotal != null && (input.parsedTotal == null || input.parsedTotal <= 0 || input.explicitTotal > input.parsedTotal * 1.5)) {
    return input.explicitTotal;
  }
  if (input.parsedTotal != null) return input.parsedTotal;
  if (input.explicitTotal != null) return input.explicitTotal;
  const derived = [input.subtotal, input.shippingCost, input.taxCost].filter((value): value is number => value != null).reduce((total, value) => total + value, 0);
  return derived > 0 ? derived : undefined;
}

async function findMatchingSupplier(supplierName?: string) {
  if (!supplierName?.trim()) return null;
  const normalized = supplierName.trim();
  return prisma.supplier.findFirst({
    where: {
      archivedAt: null,
      OR: [
        { name: { equals: normalized, mode: "insensitive" } },
        { companyName: { equals: normalized, mode: "insensitive" } },
        { name: { contains: normalized.slice(0, 32), mode: "insensitive" } },
        { companyName: { contains: normalized.slice(0, 32), mode: "insensitive" } }
      ]
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function findSuggestedPurchaseOrder(input: { supplierId?: string; externalOrderId?: string; invoiceTotal?: number }) {
  const status: PurchaseOrderStatus[] = [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED, PurchaseOrderStatus.RECEIVED];
  if (input.externalOrderId) {
    const byExternalOrder = await prisma.purchaseOrder.findFirst({
      where: {
        status: { in: status },
        emailOrderImports: { some: { externalOrderId: input.externalOrderId } }
      },
      orderBy: { orderedAt: "desc" }
    });
    if (byExternalOrder) return byExternalOrder;
  }

  if (!input.supplierId) return null;
  const candidates = await prisma.purchaseOrder.findMany({
    where: { status: { in: status }, supplierId: input.supplierId },
    include: { lines: true },
    orderBy: { orderedAt: "desc" },
    take: 10
  });
  if (candidates.length <= 1 || input.invoiceTotal == null) return candidates[0] ?? null;

  return candidates.find((candidate) => {
    const subtotal = candidate.lines.reduce((total, line) => total + Number(line.unitPrice.toString()) * line.quantity, 0);
    return Math.abs(subtotal - input.invoiceTotal!) <= Math.max(1, input.invoiceTotal! * 0.05);
  }) ?? candidates[0] ?? null;
}

async function findMatchingSupplierInvoice(input: {
  sha256?: string;
  supplierId?: string;
  invoiceNumber?: string;
  purchaseOrderId?: string;
}) {
  if (input.sha256) {
    const byHash = await prisma.supplierInvoice.findFirst({ where: { sourceDocumentHash: input.sha256, status: { not: InvoiceStatus.VOID } }, select: { id: true } });
    if (byHash) return byHash;
  }

  if (input.supplierId && input.invoiceNumber) {
    const invoiceNumberKey = normalizeInvoiceNumberKey(input.invoiceNumber);
    const bySupplierInvoiceNumber = await prisma.supplierInvoice.findUnique({
      where: { supplierId_invoiceNumberKey: { supplierId: input.supplierId, invoiceNumberKey } },
      select: { id: true, status: true }
    });
    if (bySupplierInvoiceNumber && bySupplierInvoiceNumber.status !== InvoiceStatus.VOID) return bySupplierInvoiceNumber;
  }

  if (input.purchaseOrderId && !input.invoiceNumber) {
    const byPurchaseOrder = await prisma.supplierInvoice.findFirst({ where: { purchaseOrderId: input.purchaseOrderId, status: { not: InvoiceStatus.VOID } }, orderBy: { invoiceDate: "desc" }, select: { id: true } });
    if (byPurchaseOrder) return byPurchaseOrder;
  }

  return null;
}

function buildRequiredReview(input: {
  classification: AccountingDocumentClassification;
  supplierName?: string;
  invoiceNumber?: string;
  total?: number;
  extractedWarnings: string[];
}) {
  const review: string[] = [];
  if (input.classification === "UNKNOWN") review.push("Classify the document type before applying accounting effects.");
  if (input.classification === "QUOTE_OR_PRO_FORMA") review.push("Quotes/pro forma invoices are non-posting until a true supplier invoice is received.");
  if (!input.supplierName) review.push("Confirm supplier/customer legal name.");
  if (input.classification === "SUPPLIER_INVOICE" && !input.invoiceNumber) review.push("Confirm invoice number.");
  if (input.classification === "SUPPLIER_INVOICE" && input.total == null) review.push("Confirm invoice total and currency.");
  review.push(...input.extractedWarnings);
  return Array.from(new Set(review));
}

function buildSuggestedActions(input: { classification: AccountingDocumentClassification; purchaseOrderId?: string; matchedInvoiceId?: string; requiredReview: string[] }) {
  if (input.matchedInvoiceId) return ["Attach to the existing supplier invoice evidence bundle; do not create a duplicate payable."];
  if (input.classification === "SUPPLIER_INVOICE" && input.purchaseOrderId && input.requiredReview.length === 0) {
    return ["Apply to the matched purchase order to create/update the supplier invoice record."];
  }
  if (input.classification === "SUPPLIER_INVOICE") {
    return ["Review required fields, choose the correct purchase order, then apply to supplier invoices."];
  }
  if (input.classification === "ORDER_NOTICE") return ["Attach as order evidence; create or match an incoming purchase order only after human review."];
  if (input.classification === "PAYMENT_RECEIPT") return ["Attach as payment evidence; do not mark paid until bank/payment reference is reviewed."];
  if (input.classification === "PACKING_SLIP" || input.classification === "CUSTOMS_DOCUMENT") return ["Attach as receiving/customs evidence; receiving remains on the /incoming workbench."];
  return ["Save as source evidence and attach to the relevant accounting/order record after review."];
}

function classifySourceKind(mimeType: string, fileName: string) {
  if (mimeType === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) return "PDF";
  if (mimeType === "message/rfc822" || fileName.toLowerCase().endsWith(".eml")) return "EMAIL";
  if (mimeType.startsWith("image/")) return "SCREENSHOT_OR_SCAN";
  if (mimeType.startsWith("text/") || /\.(txt|html?|csv)$/i.test(fileName)) return "TEXT";
  return "UPLOAD";
}

function findInvoiceNumber(text: string) {
  const patterns = [
    /(?:invoice|inv)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})/i,
    /\b(?:commercial\s+invoice)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._\/-]{2,})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/[.,;:)]+$/g, "");
  }
  return undefined;
}

function findDueDate(text: string) {
  const match = text.match(/due\s+date\s*[:#-]?\s*([A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  if (!match?.[1]) return undefined;
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeAnalysis(value: Prisma.JsonValue | null | undefined): AccountingDocumentAnalysis | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Partial<AccountingDocumentAnalysis>;
  return candidate.schemaVersion === "accounting-document-v1" ? candidate as AccountingDocumentAnalysis : undefined;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
