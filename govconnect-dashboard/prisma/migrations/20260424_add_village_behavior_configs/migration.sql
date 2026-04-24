CREATE TABLE IF NOT EXISTS village_behavior_configs (
  id TEXT PRIMARY KEY,
  village_id TEXT NOT NULL UNIQUE,
  active_service_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  important_contacts TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  service_hours JSONB,
  local_faq_priority TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  escalation_routing JSONB,
  complaint_rules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  service_rules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  notice TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT village_behavior_configs_village_id_fkey
    FOREIGN KEY (village_id) REFERENCES villages(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS village_behavior_configs_village_id_idx
  ON village_behavior_configs(village_id);
