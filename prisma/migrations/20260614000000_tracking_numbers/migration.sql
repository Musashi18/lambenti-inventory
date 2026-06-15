-- Shipment/tracking metadata is evidence-only. It links supplier portal/email tracking numbers
-- to purchase/order evidence without receiving stock or changing the inventory ledger.

CREATE TABLE "TrackingNumber" (
  "id" TEXT NOT NULL,
  "trackingNumber" TEXT NOT NULL,
  "carrier" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'UNCONFIGURED',
  "currentStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "statusDescription" TEXT,
  "origin" TEXT,
  "destination" TEXT,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "sourceUrl" TEXT,
  "externalOrderId" TEXT,
  "supplierName" TEXT,
  "purchaseOrderId" TEXT,
  "emailOrderImportId" TEXT,
  "lastEventAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "nextRefreshAt" TIMESTAMP(3),
  "refreshStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "refreshError" TEXT,
  "rawStatusJson" JSONB,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrackingNumber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrackingEvent" (
  "id" TEXT NOT NULL,
  "trackingNumberId" TEXT NOT NULL,
  "status" TEXT,
  "description" TEXT NOT NULL,
  "location" TEXT,
  "occurredAt" TIMESTAMP(3),
  "rawEventJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackingNumber_trackingNumber_key" ON "TrackingNumber"("trackingNumber");
CREATE INDEX "TrackingNumber_externalOrderId_idx" ON "TrackingNumber"("externalOrderId");
CREATE INDEX "TrackingNumber_purchaseOrderId_idx" ON "TrackingNumber"("purchaseOrderId");
CREATE INDEX "TrackingNumber_emailOrderImportId_idx" ON "TrackingNumber"("emailOrderImportId");
CREATE INDEX "TrackingNumber_currentStatus_idx" ON "TrackingNumber"("currentStatus");
CREATE INDEX "TrackingNumber_nextRefreshAt_idx" ON "TrackingNumber"("nextRefreshAt");
CREATE INDEX "TrackingNumber_updatedAt_idx" ON "TrackingNumber"("updatedAt");
CREATE INDEX "TrackingEvent_trackingNumberId_occurredAt_idx" ON "TrackingEvent"("trackingNumberId", "occurredAt");

ALTER TABLE "TrackingNumber" ADD CONSTRAINT "TrackingNumber_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrackingNumber" ADD CONSTRAINT "TrackingNumber_emailOrderImportId_fkey" FOREIGN KEY ("emailOrderImportId") REFERENCES "EmailOrderImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_trackingNumberId_fkey" FOREIGN KEY ("trackingNumberId") REFERENCES "TrackingNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
