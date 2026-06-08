-- Observable, idempotent automation framework for safe analysis-only workflows.
CREATE TYPE "AutomationRunKind" AS ENUM (
  'STOCK_REORDER_SCAN',
  'BOM_SHORTAGE_SCAN',
  'SUPPLIER_EMAIL_SYNC',
  'ALIBABA_PORTAL_SYNC',
  'INVOICE_RECONCILIATION',
  'PO_RECONCILIATION',
  'INVENTORY_ANOMALY_SCAN',
  'CYCLE_COUNT_PLANNER',
  'SUPPLIER_SCORE_REFRESH'
);

CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');
CREATE TYPE "AutomationFindingSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "AutomationFindingStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

CREATE TABLE "AutomationRun" (
  "id" TEXT NOT NULL,
  "kind" "AutomationRunKind" NOT NULL,
  "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "actorType" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "inputHash" TEXT,
  "summaryJson" JSONB,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationFinding" (
  "id" TEXT NOT NULL,
  "automationRunId" TEXT NOT NULL,
  "severity" "AutomationFindingSeverity" NOT NULL,
  "category" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "suggestedActionType" TEXT,
  "suggestedActionJson" JSONB,
  "status" "AutomationFindingStatus" NOT NULL DEFAULT 'OPEN',
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "AutomationFinding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationRun_kind_createdAt_idx" ON "AutomationRun"("kind", "createdAt");
CREATE INDEX "AutomationRun_status_createdAt_idx" ON "AutomationRun"("status", "createdAt");
CREATE INDEX "AutomationRun_actorId_createdAt_idx" ON "AutomationRun"("actorId", "createdAt");
CREATE UNIQUE INDEX "AutomationFinding_dedupeKey_key" ON "AutomationFinding"("dedupeKey");
CREATE INDEX "AutomationFinding_status_severity_idx" ON "AutomationFinding"("status", "severity");
CREATE INDEX "AutomationFinding_category_idx" ON "AutomationFinding"("category");
CREATE INDEX "AutomationFinding_entityType_entityId_idx" ON "AutomationFinding"("entityType", "entityId");
CREATE INDEX "AutomationFinding_createdAt_idx" ON "AutomationFinding"("createdAt");
ALTER TABLE "AutomationFinding" ADD CONSTRAINT "AutomationFinding_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
