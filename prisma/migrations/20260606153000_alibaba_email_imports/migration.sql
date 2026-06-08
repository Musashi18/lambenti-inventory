-- CreateEnum
CREATE TYPE "EmailOrderImportStatus" AS ENUM ('IMPORTED', 'APPLIED', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "EmailOrderImport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ALIBABA_EMAIL',
    "sourceHash" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "subject" TEXT,
    "fromAddress" TEXT,
    "rawText" TEXT NOT NULL,
    "externalOrderId" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierId" TEXT,
    "orderDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(12,2),
    "shippingCost" DECIMAL(12,2),
    "taxCost" DECIMAL(12,2),
    "totalCost" DECIMAL(12,2),
    "status" "EmailOrderImportStatus" NOT NULL DEFAULT 'IMPORTED',
    "confidence" "CostConfidence" NOT NULL DEFAULT 'ESTIMATED',
    "purchaseOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOrderImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOrderLineImport" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "rawDescription" TEXT NOT NULL,
    "supplierSku" TEXT,
    "productUrl" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,4),
    "lineTotal" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "matchedItemId" TEXT,
    "matchConfidence" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOrderLineImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailOrderImport_sourceHash_key" ON "EmailOrderImport"("sourceHash");

-- CreateIndex
CREATE INDEX "EmailOrderImport_externalOrderId_idx" ON "EmailOrderImport"("externalOrderId");

-- CreateIndex
CREATE INDEX "EmailOrderImport_createdAt_idx" ON "EmailOrderImport"("createdAt");

-- CreateIndex
CREATE INDEX "EmailOrderLineImport_matchedItemId_idx" ON "EmailOrderLineImport"("matchedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOrderLineImport_importId_lineNo_key" ON "EmailOrderLineImport"("importId", "lineNo");

-- AddForeignKey
ALTER TABLE "EmailOrderImport" ADD CONSTRAINT "EmailOrderImport_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOrderImport" ADD CONSTRAINT "EmailOrderImport_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOrderLineImport" ADD CONSTRAINT "EmailOrderLineImport_importId_fkey" FOREIGN KEY ("importId") REFERENCES "EmailOrderImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOrderLineImport" ADD CONSTRAINT "EmailOrderLineImport_matchedItemId_fkey" FOREIGN KEY ("matchedItemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
