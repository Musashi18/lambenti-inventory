import { createInvoiceFromPurchaseOrder } from "@/modules/accounting/invoices";
import { importAlibabaEmailOrder } from "@/modules/email-imports/alibaba-email";
import {
  AlibabaPortalInvoiceDocument,
  AlibabaPortalSnapshot,
  extractPortalInvoiceMetadata,
  portalSnapshotToImportText
} from "./snapshot";

export type AlibabaPortalImportInput = {
  snapshot: AlibabaPortalSnapshot;
  actorId: string;
  autoApply?: boolean;
  autoCreateInvoice?: boolean;
};

export type AlibabaPortalBatchImportInput = {
  snapshots: AlibabaPortalSnapshot[];
  actorId: string;
  autoApply?: boolean;
  autoCreateInvoices?: boolean;
};

export async function importAlibabaPortalSnapshot(input: AlibabaPortalImportInput) {
  const rawText = portalSnapshotToImportText(input.snapshot);
  const primaryInvoice = firstInvoiceDocumentWithProvenance(input.snapshot.invoiceDocuments);
  const invoiceMetadata = extractPortalInvoiceMetadata(primaryInvoice);
  const invoiceDocumentText = buildInvoiceDocumentText(input.snapshot.invoiceDocuments);

  const imported = await importAlibabaEmailOrder({
    rawText,
    actorId: input.actorId,
    autoApply: input.autoApply ?? true,
    autoCreateInvoice: false,
    source: "ALIBABA_PORTAL",
    sourceMessageId: input.snapshot.messageId ?? buildPortalSourceMessageId(input.snapshot),
    sourceUrl: input.snapshot.sourceUrl,
    invoiceDocumentPath: invoiceMetadata.sourceDocumentPath,
    invoiceDocumentHash: invoiceMetadata.sourceDocumentHash,
    invoiceDocumentText,
    invoiceDownloadedAt: primaryInvoice?.downloadedAt ? new Date(primaryInvoice.downloadedAt) : undefined
  });

  const invoice = (input.autoCreateInvoice ?? true) && imported.purchaseOrder
    ? await createInvoiceFromPurchaseOrder(imported.purchaseOrder.id, input.actorId, {
        ...invoiceMetadata,
        notes: `Auto-created from Alibaba portal import${input.snapshot.orderId ? ` order ${input.snapshot.orderId}` : ""}. Verify against downloaded invoice before marking paid. Physical inventory was not received.`
      })
    : null;

  return { ...imported, invoice };
}

export async function importAlibabaPortalSnapshots(input: AlibabaPortalBatchImportInput) {
  const results = [];
  const errors: string[] = [];

  for (const snapshot of input.snapshots) {
    try {
      results.push(await importAlibabaPortalSnapshot({
        snapshot,
        actorId: input.actorId,
        autoApply: input.autoApply,
        autoCreateInvoice: input.autoCreateInvoices
      }));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    imported: results.filter((result) => result.created).length,
    duplicates: results.filter((result) => !result.created).length,
    appliedOrAlreadyApplied: results.filter((result) => result.purchaseOrder).length,
    invoicesCreatedOrUpdated: results.filter((result) => result.invoice).length,
    needsReview: results.filter((result) => result.import.status === "NEEDS_REVIEW").length,
    errors,
    results
  };
}

function firstInvoiceDocumentWithProvenance(documents?: AlibabaPortalInvoiceDocument[]) {
  return documents?.find((document) => document.localPath || document.sha256 || document.sourceUrl || document.text);
}

function buildInvoiceDocumentText(documents?: AlibabaPortalInvoiceDocument[]) {
  const text = (documents ?? [])
    .map((document) => document.text?.trim())
    .filter((value): value is string => Boolean(value));

  if (text.length === 0) return undefined;
  return text.join("\n\n--- invoice document ---\n\n").slice(0, 250_000);
}

function buildPortalSourceMessageId(snapshot: AlibabaPortalSnapshot) {
  const stableId = snapshot.orderId ?? snapshot.sourceUrl;
  return `<alibaba-portal:${stableId}>`;
}
