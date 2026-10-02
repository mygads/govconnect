-- Corrective: allow 'resolved' in billing status check constraint.
-- The ai-resolution-billing.service.ts updates ai_message_billings.status to
-- 'resolved' when linking accrued turns to a resolution, but the check
-- constraint did not include it, causing "violates check constraint
-- ai_message_billings_status_check".
ALTER TABLE "ai"."ai_message_billings"
  DROP CONSTRAINT IF EXISTS "ai_message_billings_status_check",
  ADD CONSTRAINT "ai_message_billings_status_check"
    CHECK ("status" IN ('pending', 'billed', 'accrued', 'resolved', 'skipped_zero_cost', 'skipped_no_village', 'failed', 'failed_insufficient_balance'));
