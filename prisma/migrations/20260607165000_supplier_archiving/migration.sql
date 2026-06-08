-- Add non-destructive supplier archiving metadata. Active supplier lists filter
-- archived rows by default; hard delete is allowed only after archiving.
ALTER TABLE "Supplier" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Supplier" ADD COLUMN "archivedBy" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "Supplier_archivedAt_idx" ON "Supplier"("archivedAt");
