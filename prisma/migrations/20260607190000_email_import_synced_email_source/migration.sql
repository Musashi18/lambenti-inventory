-- Rename the generic mailbox/default order-email source away from the provider-specific legacy label.
ALTER TABLE "EmailOrderImport" ALTER COLUMN "source" SET DEFAULT 'SYNCED_EMAIL';

UPDATE "EmailOrderImport"
SET "source" = 'SYNCED_EMAIL'
WHERE "source" = 'ALIBABA_EMAIL';
