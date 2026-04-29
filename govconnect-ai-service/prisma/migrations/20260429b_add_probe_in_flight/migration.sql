-- DB-backed probe gate for cross-instance smart routing.
DO $$
DECLARE
  target_table regclass := COALESCE(
    to_regclass('ai.ai_provider_health'),
    to_regclass('public.ai_provider_health'),
    to_regclass('ai_provider_health')
  );
BEGIN
  IF target_table IS NULL THEN
    RAISE NOTICE 'ai_provider_health table not found; skipping probe_in_flight_until migration';
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS probe_in_flight_until TIMESTAMP(3)', target_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS ai_provider_health_probe_in_flight_until_idx ON %s (probe_in_flight_until)', target_table);
END $$;
