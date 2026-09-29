-- W17: LAPOR! status sync balik.
-- Kolom untuk menyimpan status terakhir dari sisi LAPOR! (via webhook atau polling),
-- terpisah dari `status` (status pengiriman outbox internal).
ALTER TABLE pipeline_lapor_outbox
  ADD COLUMN IF NOT EXISTS lapor_status TEXT,
  ADD COLUMN IF NOT EXISTS lapor_status_note TEXT,
  ADD COLUMN IF NOT EXISTS lapor_status_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS pipeline_lapor_outbox_tracking_idx
  ON pipeline_lapor_outbox (tracking_id);
CREATE INDEX IF NOT EXISTS pipeline_lapor_outbox_lapor_status_idx
  ON pipeline_lapor_outbox (lapor_status);
