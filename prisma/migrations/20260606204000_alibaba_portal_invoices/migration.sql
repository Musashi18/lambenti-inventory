-- Alibaba portal/browser-agent invoice provenance.
ALTER TABLE "EmailOrderImport"
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "invoiceDocumentPath" TEXT,
  ADD COLUMN "invoiceDocumentHash" TEXT,
  ADD COLUMN "invoiceDocumentText" TEXT,
  ADD COLUMN "invoiceDownloadedAt" TIMESTAMP(3);

CREATE INDEX "EmailOrderImport_source_idx" ON "EmailOrderImport"("source");

ALTER TABLE "SupplierInvoice"
  ADD COLUMN "sourceDocumentPath" TEXT,
  ADD COLUMN "sourceDocumentHash" TEXT,
  ADD COLUMN "externalSourceUrl" TEXT;
