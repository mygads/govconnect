-- KB publish-status mirror on ai.document_vectors (§5.2 arsitektur-final).
--
-- Retrieval must exclude non-published documents WITHOUT cross-database joins
-- (deployments may use one database with schemas OR separate databases per
-- service), so the dashboard document's review state is denormalized here.
--
-- Backfill: existing rows were indexed under the old auto-publish regime and
-- are already being served -> grandfathered as 'published'. New ingests write
-- 'draft' explicitly (see document-ingest.service.ts) until an admin approves.
--
-- Defensive style: IF NOT EXISTS / idempotent, re-runnable.

ALTER TABLE ai.document_vectors
  ADD COLUMN IF NOT EXISTS publish_status TEXT NOT NULL DEFAULT 'published';

DO $$
BEGIN
  ALTER TABLE ai.document_vectors
    ADD CONSTRAINT document_vectors_publish_status_chk
    CHECK (publish_status IN ('draft', 'published', 'withdrawn', 'superseded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS document_vectors_publish_status_idx
  ON ai.document_vectors (village_id, publish_status);
