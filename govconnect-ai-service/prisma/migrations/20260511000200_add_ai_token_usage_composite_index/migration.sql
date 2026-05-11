CREATE INDEX IF NOT EXISTS "ai_token_usage_village_id_created_at_call_type_idx"
  ON "ai_token_usage" ("village_id", "created_at", "call_type");
