-- Balanced accounting journal entries for AP invoice approval and AP payment reconciliation.
-- Journals are source-linked, idempotent, and do not mutate inventory stock.

CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');
CREATE TYPE "JournalEntryKind" AS ENUM ('AP_INVOICE', 'AP_PAYMENT', 'MANUAL', 'REVERSAL');

CREATE TABLE "JournalEntry" (
  "id" TEXT NOT NULL,
  "entryNumber" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "kind" "JournalEntryKind" NOT NULL,
  "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
  "entryDate" TIMESTAMP(3) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "totalDebit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "totalCredit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "memo" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceReference" TEXT,
  "supplierInvoiceId" TEXT,
  "supplierInvoicePaymentAllocationId" TEXT,
  "reversesJournalEntryId" TEXT,
  "createdBy" TEXT NOT NULL,
  "postedBy" TEXT,
  "postedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalEntry_posted_balanced_chk" CHECK (
    "status" <> 'POSTED'
    OR (
      "totalDebit" = "totalCredit"
      AND "totalDebit" > 0
      AND "postedBy" IS NOT NULL
      AND "postedAt" IS NOT NULL
    )
  )
);

CREATE TABLE "JournalEntryLine" (
  "id" TEXT NOT NULL,
  "journalEntryId" TEXT NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "glAccountId" TEXT NOT NULL,
  "accountCodeSnapshot" TEXT NOT NULL,
  "accountNameSnapshot" TEXT NOT NULL,
  "accountTypeSnapshot" "GLAccountType" NOT NULL,
  "description" TEXT NOT NULL,
  "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sourceLineType" TEXT,
  "sourceLineId" TEXT,
  CONSTRAINT "JournalEntryLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalEntryLine_one_sided_amount_chk" CHECK (
    ("debit" > 0 AND "credit" = 0)
    OR ("credit" > 0 AND "debit" = 0)
  )
);

CREATE UNIQUE INDEX "JournalEntry_entryNumber_key" ON "JournalEntry"("entryNumber");
CREATE UNIQUE INDEX "JournalEntry_idempotencyKey_key" ON "JournalEntry"("idempotencyKey");
CREATE UNIQUE INDEX "JournalEntry_supplierInvoicePaymentAllocationId_key" ON "JournalEntry"("supplierInvoicePaymentAllocationId");
CREATE UNIQUE INDEX "JournalEntry_reversesJournalEntryId_key" ON "JournalEntry"("reversesJournalEntryId");
CREATE INDEX "JournalEntry_status_entryDate_idx" ON "JournalEntry"("status", "entryDate");
CREATE INDEX "JournalEntry_kind_entryDate_idx" ON "JournalEntry"("kind", "entryDate");
CREATE INDEX "JournalEntry_sourceType_sourceId_idx" ON "JournalEntry"("sourceType", "sourceId");
CREATE INDEX "JournalEntry_supplierInvoiceId_idx" ON "JournalEntry"("supplierInvoiceId");

CREATE UNIQUE INDEX "JournalEntryLine_journalEntryId_lineNo_key" ON "JournalEntryLine"("journalEntryId", "lineNo");
CREATE INDEX "JournalEntryLine_glAccountId_idx" ON "JournalEntryLine"("glAccountId");
CREATE INDEX "JournalEntryLine_sourceLineType_sourceLineId_idx" ON "JournalEntryLine"("sourceLineType", "sourceLineId");

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_supplierInvoicePaymentAllocationId_fkey" FOREIGN KEY ("supplierInvoicePaymentAllocationId") REFERENCES "SupplierInvoicePaymentAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversesJournalEntryId_fkey" FOREIGN KEY ("reversesJournalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntryLine" ADD CONSTRAINT "JournalEntryLine_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "GLAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
