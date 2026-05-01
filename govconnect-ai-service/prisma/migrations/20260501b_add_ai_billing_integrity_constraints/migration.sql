SET search_path TO ai;

ALTER TABLE "ai_token_usage"
  DROP CONSTRAINT IF EXISTS "ai_token_usage_billing_status_check",
  ADD CONSTRAINT "ai_token_usage_billing_status_check"
    CHECK ("billing_status" IN ('unbilled', 'not_billable', 'legacy_billed', 'billed', 'skipped_zero_cost', 'skipped_no_village'));

ALTER TABLE "ai_message_billings"
  DROP CONSTRAINT IF EXISTS "ai_message_billings_status_check",
  ADD CONSTRAINT "ai_message_billings_status_check"
    CHECK ("status" IN ('pending', 'billed', 'skipped_zero_cost', 'skipped_no_village', 'failed', 'failed_insufficient_balance'));

ALTER TABLE "ai_topup_vouchers"
  DROP CONSTRAINT IF EXISTS "ai_topup_vouchers_status_check",
  ADD CONSTRAINT "ai_topup_vouchers_status_check"
    CHECK ("status" IN ('active', 'redeemed', 'expired', 'cancelled'));

ALTER TABLE "ai_message_billings"
  DROP CONSTRAINT IF EXISTS "ai_message_billings_ledger_entry_id_fkey",
  ADD CONSTRAINT "ai_message_billings_ledger_entry_id_fkey"
    FOREIGN KEY ("ledger_entry_id") REFERENCES "ai_wallet_ledger_entries"("id") ON DELETE SET NULL;
