-- CreateTable
CREATE TABLE "ai_memory_traces" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT,
    "wa_user_id" TEXT NOT NULL,
    "village_id" TEXT,
    "channel" TEXT,
    "source" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "top_score" DOUBLE PRECISION,
    "avg_score" DOUBLE PRECISION,
    "selected_memories_json" JSONB,
    "summary_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_memory_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_guardrail_events" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT,
    "wa_user_id" TEXT,
    "village_id" TEXT,
    "channel" TEXT,
    "guard_stage" TEXT NOT NULL,
    "guard_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "message_preview" TEXT,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_guardrail_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_allowlist_policies" (
    "id" TEXT NOT NULL,
    "policy_key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "match_terms_json" JSONB NOT NULL,
    "allowed_tools_json" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evaluation_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tool_allowlist_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_policy_events" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT,
    "wa_user_id" TEXT,
    "village_id" TEXT,
    "channel" TEXT,
    "query" TEXT NOT NULL,
    "policy_key" TEXT,
    "policy_source" TEXT,
    "heuristic_tools_json" JSONB,
    "learned_tools_json" JSONB,
    "allowed_tools_json" JSONB,
    "actual_tools_json" JSONB,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_policy_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_memory_traces_wa_user_id_created_at_idx" ON "ai_memory_traces"("wa_user_id", "created_at");
CREATE INDEX "ai_memory_traces_village_id_created_at_idx" ON "ai_memory_traces"("village_id", "created_at");
CREATE INDEX "ai_memory_traces_source_created_at_idx" ON "ai_memory_traces"("source", "created_at");
CREATE INDEX "ai_memory_traces_channel_created_at_idx" ON "ai_memory_traces"("channel", "created_at");

-- CreateIndex
CREATE INDEX "ai_guardrail_events_guard_type_created_at_idx" ON "ai_guardrail_events"("guard_type", "created_at");
CREATE INDEX "ai_guardrail_events_guard_stage_created_at_idx" ON "ai_guardrail_events"("guard_stage", "created_at");
CREATE INDEX "ai_guardrail_events_village_id_created_at_idx" ON "ai_guardrail_events"("village_id", "created_at");
CREATE INDEX "ai_guardrail_events_channel_created_at_idx" ON "ai_guardrail_events"("channel", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_allowlist_policies_policy_key_key" ON "ai_tool_allowlist_policies"("policy_key");
CREATE INDEX "ai_tool_allowlist_policies_source_updated_at_idx" ON "ai_tool_allowlist_policies"("source", "updated_at");
CREATE INDEX "ai_tool_allowlist_policies_confidence_updated_at_idx" ON "ai_tool_allowlist_policies"("confidence", "updated_at");

-- CreateIndex
CREATE INDEX "ai_tool_policy_events_policy_key_created_at_idx" ON "ai_tool_policy_events"("policy_key", "created_at");
CREATE INDEX "ai_tool_policy_events_village_id_created_at_idx" ON "ai_tool_policy_events"("village_id", "created_at");
CREATE INDEX "ai_tool_policy_events_channel_created_at_idx" ON "ai_tool_policy_events"("channel", "created_at");
