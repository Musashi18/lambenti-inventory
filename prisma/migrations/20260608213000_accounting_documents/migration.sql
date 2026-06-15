-- CreateEnum
CREATE TYPE "AccountingDocumentStatus" AS ENUM ('UPLOADED', 'ANALYZED', 'NEEDS_REVIEW', 'APPLIED', 'ATTACHED', 'ARCHIVED', 'FAILED');

-- CreateTable
CREATE TABLE "AccountingDocument" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL_UPLOAD',
    "sourceKind" TEXT NOT NULL DEFAULT 'UPLOAD',
    "originalFileName" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "extractedText" TEXT,
    "analysisJson" JSONB,
    "status" "AccountingDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorMessage" TEXT,
    "uploadedBy" TEXT,
    "supplierId" TEXT,
    "purchaseOrderId" TEXT,
    "supplierInvoiceId" TEXT,
    "emailOrderImportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingDocument_sha256_key" ON "AccountingDocument"("sha256");

-- CreateIndex
CREATE INDEX "AccountingDocument_status_createdAt_idx" ON "AccountingDocument"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AccountingDocument_supplierId_idx" ON "AccountingDocument"("supplierId");

-- CreateIndex
CREATE INDEX "AccountingDocument_purchaseOrderId_idx" ON "AccountingDocument"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "AccountingDocument_supplierInvoiceId_idx" ON "AccountingDocument"("supplierInvoiceId");

-- CreateIndex
CREATE INDEX "AccountingDocument_emailOrderImportId_idx" ON "AccountingDocument"("emailOrderImportId");

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingDocument" ADD CONSTRAINT "AccountingDocument_emailOrderImportId_fkey" FOREIGN KEY ("emailOrderImportId") REFERENCES "EmailOrderImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
