-- CreateEnum
CREATE TYPE "CostConfidence" AS ENUM ('UNKNOWN', 'ESTIMATED', 'QUOTED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "StorageLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageLocation_code_key" ON "StorageLocation"("code");

-- Preserve existing freeform locations by converting each distinct value to a structured row.
INSERT INTO "StorageLocation" ("id", "code", "name", "createdAt", "updatedAt")
SELECT
    'loc_' || md5("storageLocation"),
    upper(regexp_replace(regexp_replace("storageLocation", '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')),
    "storageLocation",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "storageLocation" FROM "Item") locations;

-- AddColumns
ALTER TABLE "Item" ADD COLUMN "storageLocationId" TEXT;
ALTER TABLE "Item" ADD COLUMN "estimatedUnitCost" DECIMAL(10,2);
ALTER TABLE "Item" ADD COLUMN "costCurrency" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "Item" ADD COLUMN "costConfidence" "CostConfidence" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Item" ADD COLUMN "costSourceRef" TEXT;

-- Backfill item location relation from old freeform value.
UPDATE "Item"
SET "storageLocationId" = 'loc_' || md5("storageLocation");

-- Require structured location after backfill.
ALTER TABLE "Item" ALTER COLUMN "storageLocationId" SET NOT NULL;

-- Drop old freeform location column.
ALTER TABLE "Item" DROP COLUMN "storageLocation";

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_storageLocationId_fkey" FOREIGN KEY ("storageLocationId") REFERENCES "StorageLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
