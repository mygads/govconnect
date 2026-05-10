-- Knowledge inconsistencies table.
--
-- Populated by the knowledge-consistency pipeline after document ingestion
-- and by periodic sweeps. Each row represents a detected disagreement
-- between two knowledge sources (doc vs doc, doc vs DB, or KB vs KB).
--
-- Admins review open rows to clean up the corpus so the agent doesn't
-- surface contradicting values to users.

CREATE TABLE IF NOT EXISTS ai."ai_knowledge_inconsistencies" (
  "id"               TEXT        NOT NULL,
  "village_id"       TEXT,
  "kind"             TEXT        NOT NULL,
  "topic_hint"       TEXT,
  "source_a_id"      TEXT,
  "source_a_type"    TEXT,
  "source_a_title"   TEXT,
  "source_b_id"      TEXT,
  "source_b_type"    TEXT,
  "source_b_title"   TEXT,
  "snippet_a"        TEXT,
  "snippet_b"        TEXT,
  "similarity_score" DOUBLE PRECISION,
  "severity"         TEXT        NOT NULL DEFAULT 'medium',
  "status"           TEXT        NOT NULL DEFAULT 'open',
  "detected_by"      TEXT,
  "resolved_at"      TIMESTAMP(3),
  "resolved_by"      TEXT,
  "resolution_note"  TEXT,
  "detected_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_knowledge_inconsistencies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_knowledge_inconsistencies_village_status_idx"
  ON ai."ai_knowledge_inconsistencies" (village_id, status, detected_at);

CREATE INDEX IF NOT EXISTS "ai_knowledge_inconsistencies_kind_idx"
  ON ai."ai_knowledge_inconsistencies" (kind, detected_at);

CREATE INDEX IF NOT EXISTS "ai_knowledge_inconsistencies_severity_status_idx"
  ON ai."ai_knowledge_inconsistencies" (severity, status);
