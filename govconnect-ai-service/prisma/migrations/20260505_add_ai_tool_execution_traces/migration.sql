SET search_path TO ai;

CREATE TABLE IF NOT EXISTS "ai_tool_execution_traces" (
  "id" TEXT NOT NULL,
  "trace_id" TEXT,
  "billing_group_id" TEXT,
  "message_id" TEXT,
  "wa_user_id" TEXT,
  "session_id" TEXT,
  "village_id" TEXT,
  "channel" TEXT,
  "tool_name" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "duration_ms" INTEGER,
  "trust_level" TEXT,
  "source_kind" TEXT,
  "error_message" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_tool_execution_traces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_tool_execution_traces_trace_id_idx"
  ON "ai_tool_execution_traces"("trace_id");

CREATE INDEX IF NOT EXISTS "ai_tool_execution_traces_billing_group_id_idx"
  ON "ai_tool_execution_traces"("billing_group_id");

CREATE INDEX IF NOT EXISTS "ai_tool_execution_traces_village_id_created_at_idx"
  ON "ai_tool_execution_traces"("village_id", "created_at");

CREATE INDEX IF NOT EXISTS "ai_tool_execution_traces_tool_name_idx"
  ON "ai_tool_execution_traces"("tool_name");

CREATE INDEX IF NOT EXISTS "ai_tool_execution_traces_success_created_at_idx"
  ON "ai_tool_execution_traces"("success", "created_at");
