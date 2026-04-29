-- Guard wallet ledger entry_type values without breaking deploys that contain legacy data.
DO $$
DECLARE
  target_table regclass := COALESCE(
    to_regclass('ai.ai_wallet_ledger_entries'),
    to_regclass('public.ai_wallet_ledger_entries'),
    to_regclass('ai_wallet_ledger_entries')
  );
  invalid_count integer := 0;
BEGIN
  IF target_table IS NULL THEN
    RAISE NOTICE 'ai_wallet_ledger_entries table not found; skipping entry_type check constraint';
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT COUNT(*) FROM (SELECT DISTINCT entry_type FROM %s WHERE entry_type NOT IN (''usage_debit'', ''topup_credit'', ''refund_credit'', ''manual_adjustment'')) invalid_values',
    target_table
  ) INTO invalid_count;

  IF invalid_count > 0 THEN
    RAISE NOTICE 'Skipping ai_wallet_ledger_entry_type_check because % invalid entry_type value(s) exist', invalid_count;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_wallet_ledger_entry_type_check'
      AND conrelid = target_table
  ) THEN
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT ai_wallet_ledger_entry_type_check CHECK (entry_type IN (''usage_debit'', ''topup_credit'', ''refund_credit'', ''manual_adjustment''))',
      target_table
    );
  END IF;
END $$;
