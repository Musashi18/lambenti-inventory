-- Add invoice approval/payment provenance fields without changing ledger behavior.
ALTER TABLE "SupplierInvoice" ADD COLUMN "approvalNotes" TEXT;
ALTER TABLE "SupplierInvoice" ADD COLUMN "approvedBy" TEXT;
ALTER TABLE "SupplierInvoice" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "SupplierInvoice" ADD COLUMN "paymentReference" TEXT;
ALTER TABLE "SupplierInvoice" ADD COLUMN "paidBy" TEXT;
ALTER TABLE "SupplierInvoice" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "SupplierInvoice" ADD COLUMN "voidReason" TEXT;
