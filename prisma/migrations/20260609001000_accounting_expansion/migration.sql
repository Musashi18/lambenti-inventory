-- Automatic accounting expansion: supplier-scoped invoices, multi-invoice POs,
-- bank reconciliation, GST/HST support fields, GL mapping, and landed-cost report fields.

CREATE TYPE "BankTransactionStatus" AS ENUM ('IMPORTED', 'MATCHED', 'IGNORED');
CREATE TYPE "GLAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS');

ALTER TABLE "Supplier" ADD COLUMN "taxRegistrationNumber" TEXT;

ALTER TABLE "SupplierInvoice" ADD COLUMN "invoiceNumberKey" TEXT;
UPDATE "SupplierInvoice"
SET "invoiceNumberKey" = UPPER(REGEXP_REPLACE(BTRIM("invoiceNumber"), '\\s+', ' ', 'g'))
WHERE "invoiceNumberKey" IS NULL;
ALTER TABLE "SupplierInvoice" ALTER COLUMN "invoiceNumberKey" SET NOT NULL;

ALTER TABLE "SupplierInvoice" ADD COLUMN "taxJurisdiction" TEXT;
ALTER TABLE "SupplierInvoice" ADD COLUMN "taxRate" DECIMAL(6,4);
ALTER TABLE "SupplierInvoice" ADD COLUMN "taxRecoverableAmount" DECIMAL(12,2);
ALTER TABLE "SupplierInvoice" ADD COLUMN "taxNonRecoverableAmount" DECIMAL(12,2);
ALTER TABLE "SupplierInvoice" ADD COLUMN "dutyCost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "SupplierInvoice" ADD COLUMN "brokerageCost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "SupplierInvoice" ADD COLUMN "otherLandedCost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "SupplierInvoice" ADD COLUMN "sourceCurrency" TEXT;
ALTER TABLE "SupplierInvoice" ADD COLUMN "sourceSubtotal" DECIMAL(12,2);
ALTER TABLE "SupplierInvoice" ADD COLUMN "sourceTaxCost" DECIMAL(12,2);
ALTER TABLE "SupplierInvoice" ADD COLUMN "sourceTotal" DECIMAL(12,2);

DROP INDEX IF EXISTS "SupplierInvoice_invoiceNumber_key";
DROP INDEX IF EXISTS "SupplierInvoice_purchaseOrderId_key";
CREATE UNIQUE INDEX "SupplierInvoice_supplierId_invoiceNumberKey_key" ON "SupplierInvoice"("supplierId", "invoiceNumberKey");
CREATE INDEX "SupplierInvoice_invoiceNumber_idx" ON "SupplierInvoice"("invoiceNumber");
CREATE INDEX "SupplierInvoice_purchaseOrderId_idx" ON "SupplierInvoice"("purchaseOrderId");

ALTER TABLE "SupplierInvoiceLine" ADD COLUMN "purchaseOrderLineId" TEXT;
ALTER TABLE "SupplierInvoiceLine" ADD COLUMN "glAccountId" TEXT;
CREATE INDEX "SupplierInvoiceLine_purchaseOrderLineId_idx" ON "SupplierInvoiceLine"("purchaseOrderLineId");
CREATE INDEX "SupplierInvoiceLine_glAccountId_idx" ON "SupplierInvoiceLine"("glAccountId");
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "BankTransaction" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "accountName" TEXT,
  "postedAt" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "counterparty" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "amount" DECIMAL(12,2) NOT NULL,
  "reference" TEXT,
  "status" "BankTransactionStatus" NOT NULL DEFAULT 'IMPORTED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankTransaction_sourceHash_key" ON "BankTransaction"("sourceHash");
CREATE INDEX "BankTransaction_postedAt_idx" ON "BankTransaction"("postedAt");
CREATE INDEX "BankTransaction_status_idx" ON "BankTransaction"("status");
CREATE INDEX "BankTransaction_reference_idx" ON "BankTransaction"("reference");

CREATE TABLE "GLAccount" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "GLAccountType" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GLAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GLAccount_code_key" ON "GLAccount"("code");

CREATE TABLE "GLAccountMapping" (
  "id" TEXT NOT NULL,
  "scopeType" TEXT NOT NULL,
  "scopeId" TEXT,
  "purpose" TEXT NOT NULL,
  "glAccountId" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GLAccountMapping_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GLAccountMapping_scopeType_scopeId_idx" ON "GLAccountMapping"("scopeType", "scopeId");
CREATE INDEX "GLAccountMapping_purpose_idx" ON "GLAccountMapping"("purpose");
CREATE INDEX "GLAccountMapping_glAccountId_idx" ON "GLAccountMapping"("glAccountId");
ALTER TABLE "GLAccountMapping" ADD CONSTRAINT "GLAccountMapping_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GLAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GLAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SupplierInvoicePaymentAllocation" (
  "id" TEXT NOT NULL,
  "supplierInvoiceId" TEXT NOT NULL,
  "bankTransactionId" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "paymentDate" TIMESTAMP(3) NOT NULL,
  "reference" TEXT NOT NULL,
  "reconciledBy" TEXT NOT NULL,
  "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  CONSTRAINT "SupplierInvoicePaymentAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SupplierInvoicePaymentAllocation_supplierInvoiceId_bankTransactionId_key" ON "SupplierInvoicePaymentAllocation"("supplierInvoiceId", "bankTransactionId");
CREATE INDEX "SupplierInvoicePaymentAllocation_supplierInvoiceId_idx" ON "SupplierInvoicePaymentAllocation"("supplierInvoiceId");
CREATE INDEX "SupplierInvoicePaymentAllocation_bankTransactionId_idx" ON "SupplierInvoicePaymentAllocation"("bankTransactionId");
ALTER TABLE "SupplierInvoicePaymentAllocation" ADD CONSTRAINT "SupplierInvoicePaymentAllocation_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoicePaymentAllocation" ADD CONSTRAINT "SupplierInvoicePaymentAllocation_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
