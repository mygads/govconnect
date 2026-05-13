ALTER TABLE cases.complaint_types
ADD COLUMN IF NOT EXISTS important_contact_category_id TEXT;

CREATE INDEX IF NOT EXISTS complaint_types_important_contact_category_id_idx
  ON cases.complaint_types (important_contact_category_id);
