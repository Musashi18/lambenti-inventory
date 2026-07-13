-- Durable, privacy-preserving weekly aggregates for Founder OS work analysis.
-- Raw activity detail remains in the local Founder OS evidence JSONL; this table holds
-- only Sunday-week totals and collection metadata for dashboard/history use.
CREATE TABLE "FounderActivityWeek" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "workedMinutes" INTEGER NOT NULL,
    "highLeverageMinutes" INTEGER NOT NULL,
    "workBlockCount" INTEGER NOT NULL,
    "sourceBlockCount" INTEGER NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FounderActivityWeek_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FounderActivityWeek_weekStart_timezone_key" ON "FounderActivityWeek"("weekStart", "timezone");
CREATE INDEX "FounderActivityWeek_timezone_weekStart_idx" ON "FounderActivityWeek"("timezone", "weekStart");
