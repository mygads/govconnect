ALTER TABLE "ai_golden_set_runs"
  ADD COLUMN "village_id" TEXT;

CREATE INDEX "ai_golden_set_runs_village_id_completed_at_idx"
  ON "ai_golden_set_runs"("village_id", "completed_at");
