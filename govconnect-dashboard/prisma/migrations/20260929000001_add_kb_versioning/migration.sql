-- KB versioning + publish review gate (§5.2 arsitektur-final).
--
-- New columns on knowledge_documents:
--   version            immutable version number of this document row (default 1)
--   supersedes_version version number this row supersedes (informational link)
--   publish_status     review-gate state: draft | published | withdrawn | superseded
--                      (separate from `status`, which is the *processing* state)
--   review_due_at      when this document should be re-reviewed
--
-- Backfill policy (safe, non-breaking):
--   documents already processed (status='completed') were live under the old
--   auto-publish regime -> grandfathered as 'published'.
--   everything else starts as 'draft' and needs explicit admin approval.
--
-- Defensive style: IF NOT EXISTS / idempotent, re-runnable.

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS supersedes_version INTEGER;

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS publish_status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS review_due_at TIMESTAMPTZ;

-- Grandfather already-live documents.
UPDATE knowledge_documents
SET publish_status = 'published'
WHERE status = 'completed' AND publish_status = 'draft';

-- Enforce the allowed state machine values.
DO $$
BEGIN
  ALTER TABLE knowledge_documents
    ADD CONSTRAINT knowledge_documents_publish_status_chk
    CHECK (publish_status IN ('draft', 'published', 'withdrawn', 'superseded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS knowledge_documents_publish_status_idx
  ON knowledge_documents (village_id, publish_status);
