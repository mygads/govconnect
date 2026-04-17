-- Add durable hybrid memory tables for profile facts + episodic memories

CREATE TABLE IF NOT EXISTS durable_user_profiles (
  wa_user_id TEXT PRIMARY KEY,
  preferred_language TEXT NOT NULL DEFAULT 'auto',
  communication_style TEXT NOT NULL DEFAULT 'auto',
  response_detail TEXT NOT NULL DEFAULT 'auto',
  data_consent BOOLEAN NOT NULL DEFAULT FALSE,
  data_consent_at TIMESTAMP(3),
  data_consent_version TEXT,
  default_address TEXT,
  default_rt_rw TEXT,
  default_kelurahan TEXT,
  nama_lengkap TEXT,
  nik TEXT,
  no_hp TEXT,
  frequent_services TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  total_complaints INTEGER NOT NULL DEFAULT 0,
  total_service_requests INTEGER NOT NULL DEFAULT 0,
  first_interaction TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_interaction TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_messages INTEGER NOT NULL DEFAULT 0,
  avg_sentiment_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  frustration_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS durable_user_profiles_last_interaction_idx
ON durable_user_profiles (last_interaction);

CREATE INDEX IF NOT EXISTS durable_user_profiles_updated_at_idx
ON durable_user_profiles (updated_at);

CREATE TABLE IF NOT EXISTS user_memory_entries (
  id TEXT PRIMARY KEY,
  wa_user_id TEXT NOT NULL,
  village_id TEXT,
  memory_type TEXT NOT NULL,
  memory_key TEXT,
  content TEXT NOT NULL,
  metadata_json JSONB,
  importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  last_accessed_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS user_memory_entries_wa_user_id_idx
ON user_memory_entries (wa_user_id);

CREATE INDEX IF NOT EXISTS user_memory_entries_wa_user_id_created_at_idx
ON user_memory_entries (wa_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_memory_entries_wa_user_id_memory_type_idx
ON user_memory_entries (wa_user_id, memory_type);

CREATE INDEX IF NOT EXISTS user_memory_entries_village_id_idx
ON user_memory_entries (village_id);
