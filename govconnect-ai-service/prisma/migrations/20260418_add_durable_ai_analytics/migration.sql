-- CreateTable
CREATE TABLE "ai_interaction_events" (
    "id" TEXT NOT NULL,
    "analytics_session_id" TEXT NOT NULL,
    "wa_user_id" TEXT NOT NULL,
    "village_id" TEXT,
    "channel" TEXT,
    "intent" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "has_knowledge" BOOLEAN NOT NULL DEFAULT false,
    "is_fallback" BOOLEAN NOT NULL DEFAULT false,
    "agent_mode" TEXT,
    "response_source" TEXT,
    "tools_used_json" JSONB,
    "tool_count" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "processing_time_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interaction_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_retrieval_traces" (
    "id" TEXT NOT NULL,
    "trace_id" TEXT,
    "wa_user_id" TEXT,
    "village_id" TEXT,
    "channel" TEXT,
    "query" TEXT NOT NULL,
    "retrieval_mode" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "has_knowledge" BOOLEAN NOT NULL DEFAULT false,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "search_time_ms" INTEGER NOT NULL DEFAULT 0,
    "top_score" DOUBLE PRECISION,
    "avg_top_score" DOUBLE PRECISION,
    "source_titles_json" JSONB,
    "candidate_debug_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_retrieval_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_interaction_events_analytics_session_id_idx" ON "ai_interaction_events"("analytics_session_id");

-- CreateIndex
CREATE INDEX "ai_interaction_events_wa_user_id_created_at_idx" ON "ai_interaction_events"("wa_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_interaction_events_village_id_created_at_idx" ON "ai_interaction_events"("village_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_interaction_events_intent_created_at_idx" ON "ai_interaction_events"("intent", "created_at");

-- CreateIndex
CREATE INDEX "ai_interaction_events_channel_created_at_idx" ON "ai_interaction_events"("channel", "created_at");

-- CreateIndex
CREATE INDEX "ai_retrieval_traces_village_id_created_at_idx" ON "ai_retrieval_traces"("village_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_retrieval_traces_retrieval_mode_created_at_idx" ON "ai_retrieval_traces"("retrieval_mode", "created_at");

-- CreateIndex
CREATE INDEX "ai_retrieval_traces_confidence_created_at_idx" ON "ai_retrieval_traces"("confidence", "created_at");

-- CreateIndex
CREATE INDEX "ai_retrieval_traces_channel_created_at_idx" ON "ai_retrieval_traces"("channel", "created_at");
