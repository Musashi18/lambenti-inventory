export type AlibabaPortalInvoiceDocument = {
  fileName?: string;
  localPath?: string;
  sourceUrl?: string;
  sha256?: string;
  text?: string;
  downloadedAt?: string;
};

export type AlibabaPortalSnapshot = {
  sourceUrl: string;
  pageTitle?: string;
  capturedAt?: string;
  subject?: string;
  messageId?: string;
  orderId?: string;
  supplierName?: string;
  text: string;
  invoiceDocuments?: AlibabaPortalInvoiceDocument[];
};

export type PortalInvoiceMetadata = {
  invoiceNumber?: string;
  sourceDocumentPath?: string;
  sourceDocumentHash?: string;
  externalSourceUrl?: string;
};

export function portalSnapshotToImportText(snapshot: AlibabaPortalSnapshot) {
  const headers = [
    "Source: Alibaba portal",
    snapshot.subject ? `Subject: ${snapshot.subject}` : `Subject: ${snapshot.pageTitle ?? "Alibaba portal order/message"}`,
    snapshot.messageId ? `Message-ID: ${snapshot.messageId}` : undefined,
    snapshot.capturedAt ? `Captured-At: ${snapshot.capturedAt}` : undefined,
    snapshot.sourceUrl ? `Source URL: ${snapshot.sourceUrl}` : undefined,
    snapshot.orderId ? `Order Number: ${snapshot.orderId}` : undefined,
    snapshot.supplierName ? `Supplier: ${snapshot.supplierName}` : undefined
  ].filter(Boolean) as string[];

  const sections = [headers.join("\n"), normalizePortalText(snapshot.text)];

  const invoiceDocuments = snapshot.invoiceDocuments ?? [];
  for (let index = 0; index < invoiceDocuments.length; index += 1) {
    const document = invoiceDocuments[index];
    const invoiceHeaders = [
      `Downloaded invoice ${index + 1}: ${document.fileName ?? "invoice document"}`,
      document.localPath ? `Local invoice path: ${document.localPath}` : undefined,
      document.sourceUrl ? `Invoice source URL: ${document.sourceUrl}` : undefined,
      document.sha256 ? `Invoice SHA256: ${document.sha256}` : undefined,
      document.downloadedAt ? `Invoice downloaded at: ${document.downloadedAt}` : undefined
    ].filter(Boolean) as string[];

    sections.push([invoiceHeaders.join("\n"), normalizePortalText(document.text ?? "")].filter(Boolean).join("\n"));
  }

  return sections.filter((section) => section.trim().length > 0).join("\n\n---\n\n");
}

export function extractPortalInvoiceMetadata(document?: AlibabaPortalInvoiceDocument): PortalInvoiceMetadata {
  if (!document) return {};

  return {
    invoiceNumber: findInvoiceNumber(document.text),
    sourceDocumentPath: document.localPath,
    sourceDocumentHash: document.sha256,
    externalSourceUrl: document.sourceUrl
  };
}

export function findInvoiceNumber(text?: string) {
  if (!text) return undefined;
  const compact = normalizePortalText(text).replace(/\s+/g, " ");
  const match = compact.match(/\b(?:invoice\s*(?:no\.?|number|#)|commercial\s+invoice\s*(?:no\.?|number|#)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]*\d[A-Z0-9._/-]*)/i);
  return match?.[1]?.replace(/[.,;:]+$/, "");
}

export function normalizePortalText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ \f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
