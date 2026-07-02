-- NLU few-shot examples table.
--
-- Admin-curated examples for the micro-NLU classifier. When an admin flags a
-- wrong answer as "should have been intent X", the villager's phrasing is
-- stored here and injected into the classifier prompt for that village, so the
-- agent progressively understands local/colloquial phrasing without retraining.
--
-- Sourced from the "Pesan Gagal" dashboard flow or POST /admin/nlu-examples.

CREATE TABLE IF NOT EXISTS ai."ai_nlu_few_shot_examples" (
  "id"                TEXT         NOT NULL,
  "village_id"        TEXT,
  "utterance"         TEXT         NOT NULL,
  "correct_intent"    TEXT,
  "correct_category"  TEXT,
  "source_message_id" TEXT,
  "created_by"        TEXT,
  "enabled"           BOOLEAN      NOT NULL DEFAULT true,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_nlu_few_shot_examples_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_nlu_few_shot_examples_village_enabled_idx"
  ON ai."ai_nlu_few_shot_examples" (village_id, enabled);
