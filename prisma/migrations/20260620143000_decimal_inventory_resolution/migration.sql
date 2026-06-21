-- Preserve high-resolution item costs and meter-based stock movement quantities.
ALTER TABLE "Item" ALTER COLUMN "estimatedUnitCost" TYPE DECIMAL(12,4);
ALTER TABLE "StockLot" ALTER COLUMN "unitCost" TYPE DECIMAL(12,4);
ALTER TABLE "StockMovement" ALTER COLUMN "quantity" TYPE DECIMAL(12,4) USING "quantity"::DECIMAL(12,4);

-- LED strips are measured and moved by length, not by discrete pieces.
UPDATE "Item"
SET "unit" = 'METER'
WHERE "sku" IN ('LED-COB-12V-3000K', 'LED-COB-12V-6500K');
