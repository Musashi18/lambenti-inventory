-- AR/customer invoices for customer-facing sales records. These do not move inventory stock.

CREATE TYPE "CustomerInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'VOID');

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "companyName" TEXT,
  "contactEmail" TEXT,
  "taxRegistrationNumber" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Customer_name_key" ON "Customer"("name");

CREATE TABLE "CustomerInvoice" (
  "id" TEXT NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "CustomerInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "subtotal" DECIMAL(12,2) NOT NULL,
  "taxCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL,
  "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueDate" TIMESTAMP(3),
  "notes" TEXT,
  "sentBy" TEXT,
  "sentAt" TIMESTAMP(3),
  "paymentReference" TEXT,
  "paidBy" TEXT,
  "paidAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerInvoice_invoiceNumber_key" ON "CustomerInvoice"("invoiceNumber");
CREATE INDEX "CustomerInvoice_customerId_idx" ON "CustomerInvoice"("customerId");
CREATE INDEX "CustomerInvoice_status_idx" ON "CustomerInvoice"("status");
CREATE INDEX "CustomerInvoice_invoiceDate_idx" ON "CustomerInvoice"("invoiceDate");
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CustomerInvoiceLine" (
  "id" TEXT NOT NULL,
  "customerInvoiceId" TEXT NOT NULL,
  "itemId" TEXT,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(12,4) NOT NULL,
  "taxRate" DECIMAL(6,4),
  "lineTotal" DECIMAL(12,2) NOT NULL,
  "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  CONSTRAINT "CustomerInvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerInvoiceLine_itemId_idx" ON "CustomerInvoiceLine"("itemId");
ALTER TABLE "CustomerInvoiceLine" ADD CONSTRAINT "CustomerInvoiceLine_customerInvoiceId_fkey" FOREIGN KEY ("customerInvoiceId") REFERENCES "CustomerInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerInvoiceLine" ADD CONSTRAINT "CustomerInvoiceLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
