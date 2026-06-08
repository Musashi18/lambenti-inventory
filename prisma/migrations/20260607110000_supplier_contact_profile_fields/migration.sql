-- Add editable supplier contact/profile fields used by the supplier comparison workspace.
ALTER TABLE "Supplier" ADD COLUMN "companyName" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "companyRevenue" DECIMAL(14,2);
ALTER TABLE "Supplier" ADD COLUMN "foundedYear" INTEGER;
ALTER TABLE "Supplier" ADD COLUMN "address" TEXT;
