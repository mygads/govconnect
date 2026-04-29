DO $$
DECLARE
  target_table regclass := COALESCE(
    to_regclass('ai.ai_wallet_ledger_entries'),
    to_regclass('public.ai_wallet_ledger_entries'),
    to_regclass('ai_wallet_ledger_entries')
  );
BEGIN
  IF target_table IS NULL THEN
    RAISE NOTICE 'ai_wallet_ledger_entries table not found; skipping entry_type check constraint update';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_wallet_ledger_entry_type_check'
      AND conrelid = target_table
  ) THEN
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT ai_wallet_ledger_entry_type_check', target_table);
  END IF;

  EXECUTE format(
    'ALTER TABLE %s ADD CONSTRAINT ai_wallet_ledger_entry_type_check CHECK (entry_type IN (''topup'', ''usage_debit'', ''voucher_redeem'', ''manual_adjustment'', ''refund'', ''seed'', ''topup_credit'', ''refund_credit''))',
    target_table
  );
END $$;
