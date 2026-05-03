ALTER TABLE cases.services_dynamic
  ADD COLUMN IF NOT EXISTS estimated_cost TEXT,
  ADD COLUMN IF NOT EXISTS estimated_processing_time TEXT;
