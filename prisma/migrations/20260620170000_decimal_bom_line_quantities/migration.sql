-- Allow fractional quantity-per-unit values for BOM components such as meter-based LED strips.
ALTER TABLE "BOMLine" ALTER COLUMN "quantity" TYPE DECIMAL(12,4) USING "quantity"::DECIMAL(12,4);
