ALTER TABLE "ai_golden_set_runs"
  ADD COLUMN "tool_accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "regression_detected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "release_gate_pass" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "ai_golden_set_items"
  ADD COLUMN "expected_tools" JSONB,
  ADD COLUMN "actual_tools" JSONB,
  ADD COLUMN "tool_match" BOOLEAN,
  ADD COLUMN "tool_score" DOUBLE PRECISION,
  ADD COLUMN "trace_score" DOUBLE PRECISION,
  ADD COLUMN "trace_grade" TEXT,
  ADD COLUMN "scenario" TEXT,
  ADD COLUMN "trace_id" TEXT;
