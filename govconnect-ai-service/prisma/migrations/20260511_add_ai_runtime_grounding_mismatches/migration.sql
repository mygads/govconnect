-- Runtime grounding mismatches table.
--
-- Populated by the DB-vs-RAG reconciler when a generated response is
-- rewritten because it contradicts authoritative village data.
--
-- This remains separate from ingest-time knowledge inconsistency records so
-- admins can review runtime grounding failures without mixing them with KB
-- cleanup workflows.

CREATE TABLE IF NOT EXISTS ai."ai_runtime_grounding_mismatches" (
  "id"                  TEXT         NOT NULL,
  "village_id"          TEXT,
  "trace_id"            TEXT,
  "user_query"          TEXT,
  "response_excerpt"    TEXT,
  "tools_used_json"     JSONB,
  "mismatch_kind"       TEXT         NOT NULL,
  "offending_value"     TEXT,
  "authoritative_value" TEXT,
  "entity_type"         TEXT,
  "entity_id"           TEXT,
  "status"              TEXT         NOT NULL DEFAULT 'open',
  "resolved_at"         TIMESTAMP(3),
  "resolved_by"         TEXT,
  "resolution_note"     TEXT,
  "detected_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_runtime_grounding_mismatches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_runtime_grounding_mismatches_village_status_idx"
  ON ai."ai_runtime_grounding_mismatches" (village_id, status, detected_at);

CREATE INDEX IF NOT EXISTS "ai_runtime_grounding_mismatches_kind_idx"
  ON ai."ai_runtime_grounding_mismatches" (mismatch_kind, detected_at);

CREATE INDEX IF NOT EXISTS "ai_runtime_grounding_mismatches_entity_idx"
  ON ai."ai_runtime_grounding_mismatches" (entity_type, detected_at);

CREATE INDEX IF NOT EXISTS "ai_runtime_grounding_mismatches_trace_idx"
  ON ai."ai_runtime_grounding_mismatches" (trace_id);
