-- Add non-destructive operator archive metadata for supplier order email imports.
-- Archived imports are hidden from the default review queue but remain auditable and accessible.
ALTER TABLE "EmailOrderImport"
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT,
  ADD COLUMN "archiveReason" TEXT;

CREATE INDEX "EmailOrderImport_archivedAt_idx" ON "EmailOrderImport"("archivedAt");
