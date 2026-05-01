ALTER TABLE rate_limit_blacklist
  ADD COLUMN IF NOT EXISTS village_id TEXT,
  ADD COLUMN IF NOT EXISTS scope_key TEXT;

UPDATE rate_limit_blacklist
SET scope_key = COALESCE(village_id, '__global__') || ':' || wa_user_id
WHERE scope_key IS NULL;

ALTER TABLE rate_limit_blacklist
  ALTER COLUMN scope_key SET NOT NULL;

DROP INDEX IF EXISTS rate_limit_blacklist_wa_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS rate_limit_blacklist_scope_key_key ON rate_limit_blacklist(scope_key);
CREATE INDEX IF NOT EXISTS rate_limit_blacklist_village_id_idx ON rate_limit_blacklist(village_id);
