-- Auth and human-confirmed receiving foundations.
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATIONS', 'PURCHASING', 'ACCOUNTING', 'VIEWER', 'AGENT');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT,
  "name" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");

ALTER TABLE "StockLot"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD';

ALTER TABLE "StockMovement"
  ADD COLUMN "purchaseOrderLineId" TEXT;

CREATE INDEX "StockMovement_itemId_createdAt_idx" ON "StockMovement"("itemId", "createdAt");
CREATE INDEX "StockMovement_stockLotId_createdAt_idx" ON "StockMovement"("stockLotId", "createdAt");
CREATE INDEX "StockMovement_purchaseOrderLineId_idx" ON "StockMovement"("purchaseOrderLineId");

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_purchaseOrderLineId_fkey"
  FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
