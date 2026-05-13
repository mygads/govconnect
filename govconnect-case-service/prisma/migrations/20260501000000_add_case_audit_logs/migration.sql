CREATE TABLE IF NOT EXISTS case_audit_logs (
  id TEXT PRIMARY KEY,
  village_id TEXT,
  admin_id TEXT,
  admin_role TEXT,
  admin_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_label TEXT,
  reason TEXT,
  metadata JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS case_audit_logs_village_id_idx ON case_audit_logs(village_id);
CREATE INDEX IF NOT EXISTS case_audit_logs_admin_id_idx ON case_audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS case_audit_logs_entity_type_entity_id_idx ON case_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS case_audit_logs_action_idx ON case_audit_logs(action);
CREATE INDEX IF NOT EXISTS case_audit_logs_created_at_idx ON case_audit_logs(created_at);
