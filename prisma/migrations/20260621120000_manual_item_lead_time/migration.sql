-- Manual planning lead times are explicit item-level overrides.
-- When set, they are the primary planning value and observed purchase/receipt averages remain evidence only.
ALTER TABLE "Item" ADD COLUMN "manualLeadTimeDays" INTEGER;
