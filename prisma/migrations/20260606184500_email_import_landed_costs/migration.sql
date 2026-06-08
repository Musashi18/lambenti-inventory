-- Track per-line landed cost provenance for email-imported supplier orders.
ALTER TABLE "EmailOrderLineImport"
  ADD COLUMN "shippingAllocated" DECIMAL(12,2),
  ADD COLUMN "taxAllocated" DECIMAL(12,2),
  ADD COLUMN "landedUnitCost" DECIMAL(12,4);
