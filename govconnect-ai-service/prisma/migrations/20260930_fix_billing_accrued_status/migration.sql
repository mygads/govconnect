-- Corrective: allow 'accrued' in billing status check constraints.
-- The 20260929_resolution_billing feature accrues turn cost with
-- status='accrued' (see ai-turn-billing.service.ts), but the check
-- constraints from 20260501b_add_ai_billing_integrity_constraints did not
-- include it, causing KB ingest (and any billed turn) to fail with
-- "violates check constraint ..._status_check".
ALTER TABLE "ai"."ai_message_billings"
  DROP CONSTRAINT IF EXISTS "ai_message_billings_status_check",
  ADD CONSTRAINT "ai_message_billings_status_check"
    CHECK ("status" IN ('pending', 'billed', 'accrued', 'skipped_zero_cost', 'skipped_no_village', 'failed', 'failed_insufficient_balance'));
