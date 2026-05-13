-- Add immutable history entries for service request admin changes.

CREATE TABLE IF NOT EXISTS "service_request_updates" (
  "id" TEXT NOT NULL,
  "service_request_id" TEXT NOT NULL,
  "admin_id" TEXT,
  "admin_name" TEXT,
  "admin_role" TEXT,
  "old_status" TEXT,
  "new_status" TEXT,
  "note_text" TEXT,
  "result_file_url" TEXT,
  "result_file_name" TEXT,
  "result_description" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "service_request_updates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "service_request_updates"
  ADD CONSTRAINT "service_request_updates_service_request_id_fkey"
  FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "service_request_updates_service_request_id_idx"
  ON "service_request_updates"("service_request_id");

CREATE INDEX IF NOT EXISTS "service_request_updates_new_status_idx"
  ON "service_request_updates"("new_status");

CREATE INDEX IF NOT EXISTS "service_request_updates_created_at_idx"
  ON "service_request_updates"("created_at");
