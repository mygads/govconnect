-- Corrective (part 2): allow 'accrued' in ai_token_usage.billing_status.
-- Same root cause as 20260930_fix_billing_accrued_status: the
-- 20260929_resolution_billing feature writes billing_status='accrued'
-- (ai-turn-billing.service.ts markTokenUsageBilled), but the constraint
-- from 20260501b did not include it.
ALTER TABLE "ai"."ai_token_usage"
  DROP CONSTRAINT IF EXISTS "ai_token_usage_billing_status_check",
  ADD CONSTRAINT "ai_token_usage_billing_status_check"
    CHECK ("billing_status" IN ('unbilled', 'not_billable', 'legacy_billed', 'billed', 'accrued', 'skipped_zero_cost', 'skipped_no_village'));
