SET search_path TO ai;

CREATE TABLE IF NOT EXISTS "ai_generation_logs" (
  "id" TEXT NOT NULL,
  "token_usage_id" TEXT,
  "village_id" TEXT,
  "wa_user_id" TEXT,
  "session_id" TEXT,
  "channel" TEXT,
  "message_id" TEXT,
  "trace_id" TEXT,
  "billing_group_id" TEXT,
  "lane_type" TEXT,
  "layer_type" TEXT,
  "call_type" TEXT,
  "provider_id" TEXT,
  "model_config_id" TEXT,
  "provider" TEXT,
  "model" TEXT NOT NULL,
  "gateway_source" TEXT,
  "response_id" TEXT,
  "finish_reason" TEXT,
  "streaming" BOOLEAN NOT NULL DEFAULT false,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "actual_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "adjusted_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "duration_ms" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'success',
  "error_message" TEXT,
  "request_json" JSONB,
  "response_json" JSONB,
  "prompt_preview" TEXT,
  "completion_preview" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_generation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ai_generation_logs_token_usage_id_idx" ON "ai_generation_logs"("token_usage_id");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_village_id_created_at_idx" ON "ai_generation_logs"("village_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_trace_id_idx" ON "ai_generation_logs"("trace_id");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_billing_group_id_idx" ON "ai_generation_logs"("billing_group_id");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_provider_id_idx" ON "ai_generation_logs"("provider_id");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_model_config_id_idx" ON "ai_generation_logs"("model_config_id");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_lane_type_idx" ON "ai_generation_logs"("lane_type");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_layer_type_idx" ON "ai_generation_logs"("layer_type");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_call_type_idx" ON "ai_generation_logs"("call_type");
CREATE INDEX IF NOT EXISTS "ai_generation_logs_status_created_at_idx" ON "ai_generation_logs"("status", "created_at");
