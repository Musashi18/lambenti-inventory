-- Make item-page supplier dropdown eligibility explicit instead of relying only on
-- email-heading/name heuristics.
ALTER TABLE "Supplier" ADD COLUMN "confirmedByHuman" BOOLEAN NOT NULL DEFAULT false;

-- Preserve confirmed operational suppliers already in local data while keeping
-- imported email/payment sentence fragments out of the dropdown.
UPDATE "Supplier"
SET "confirmedByHuman" = true
WHERE NOT (
  LOWER("name") LIKE 'subject:%'
  OR LOWER("name") LIKE 'from:%'
  OR LOWER("name") LIKE 'to:%'
  OR LOWER("name") LIKE '%has received your initial payment%'
  OR LOWER("name") LIKE '%view order details total%'
  OR LOWER("name") LIKE '%has drafted a trade assurance contract%'
  OR LOWER("name") LIKE '%send your initial payment by t/t%'
  OR LOWER("name") LIKE '%different payment methods have different fee rates%'
  OR LOWER("name") IN ('alibaba', 'alibaba supplier', 'supplier', 'unknown supplier', 'order email', 'confirmed order', 'order notification')
)
AND (
  "companyName" IS NOT NULL
  OR "contactEmail" IS NOT NULL
  OR "contactName" IS NOT NULL
  OR "address" IS NOT NULL
  OR "foundedYear" IS NOT NULL
  OR "companyRevenue" IS NOT NULL
  OR EXISTS (SELECT 1 FROM "SupplierOffer" WHERE "SupplierOffer"."supplierId" = "Supplier"."id")
  OR EXISTS (SELECT 1 FROM "Item" WHERE "Item"."preferredSupplierId" = "Supplier"."id")
  OR EXISTS (SELECT 1 FROM "PurchaseRequest" WHERE "PurchaseRequest"."supplierId" = "Supplier"."id")
  OR EXISTS (SELECT 1 FROM "PurchaseOrder" WHERE "PurchaseOrder"."supplierId" = "Supplier"."id")
  OR EXISTS (SELECT 1 FROM "SupplierInvoice" WHERE "SupplierInvoice"."supplierId" = "Supplier"."id")
);
