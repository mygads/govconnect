-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "knowledge_vectors" (
    "id" TEXT NOT NULL,
    "village_id" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keywords" TEXT[],
    "embedding" vector(768) NOT NULL,
    "embedding_model" TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
    "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "retrieval_count" INTEGER NOT NULL DEFAULT 0,
    "last_retrieved" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_vectors" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "village_id" TEXT,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "document_title" TEXT,
    "category" TEXT,
    "page_number" INTEGER,
    "section_title" TEXT,
    "embedding" vector(768) NOT NULL,
    "embedding_model" TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding_jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "embedding_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_variants" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'knowledge',
    "village_id" TEXT,
    "variant_text" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "embedding_model" TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_token_usage" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "layer_type" TEXT NOT NULL,
    "call_type" TEXT NOT NULL,
    "village_id" TEXT,
    "wa_user_id" TEXT,
    "session_id" TEXT,
    "channel" TEXT,
    "intent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "duration_ms" INTEGER,
    "key_source" TEXT,
    "key_id" TEXT,
    "key_tier" TEXT,
    "provider_id" TEXT,
    "model_config_id" TEXT,
    "lane_type" TEXT,
    "actual_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjusted_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "margin_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_village_wallets" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "balance_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "warning_threshold_usd" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'exhausted',
    "last_topup_at" TIMESTAMP(3),
    "last_exhausted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_village_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_wallet_ledger_entries" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "entry_type" TEXT NOT NULL,
    "amount_usd" DOUBLE PRECISION NOT NULL,
    "balance_before_usd" DOUBLE PRECISION NOT NULL,
    "balance_after_usd" DOUBLE PRECISION NOT NULL,
    "actual_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adjusted_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "margin_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "metadata_json" JSONB,
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_topup_vouchers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount_usd" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3),
    "redeemed_by_village_id" TEXT,
    "redeemed_by_admin_id" TEXT,
    "redeemed_at" TIMESTAMP(3),
    "metadata_json" JSONB,
    "created_by_admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_topup_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "provider_kind" TEXT NOT NULL DEFAULT 'openai_compatible',
    "base_url" TEXT NOT NULL,
    "api_key_encrypted" TEXT,
    "default_headers_json" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_models" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "lane_type" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "upstream_model_name" TEXT NOT NULL,
    "endpoint_path" TEXT,
    "actual_pricing_type" TEXT NOT NULL DEFAULT 'per_million_tokens',
    "actual_fixed_price_usd" DOUBLE PRECISION,
    "actual_input_price_per_million_usd" DOUBLE PRECISION,
    "actual_output_price_per_million_usd" DOUBLE PRECISION,
    "adjusted_pricing_type" TEXT NOT NULL DEFAULT 'per_million_tokens',
    "adjusted_fixed_price_usd" DOUBLE PRECISION,
    "adjusted_input_price_per_million_usd" DOUBLE PRECISION,
    "adjusted_output_price_per_million_usd" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_publicly_selectable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_lane_assignments" (
    "id" TEXT NOT NULL,
    "lane_type" TEXT NOT NULL,
    "primary_model_id" TEXT NOT NULL,
    "fallback_model_id" TEXT,
    "village_id" TEXT,
    "is_global_default" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_lane_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_health" (
    "provider_id" TEXT NOT NULL,
    "lane_type" TEXT NOT NULL,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "demoted_until" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "probe_in_flight_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_health_pkey" PRIMARY KEY ("provider_id","lane_type")
);

-- CreateTable
CREATE TABLE "conversation_sessions" (
    "id" TEXT NOT NULL,
    "wa_user_id" TEXT NOT NULL,
    "session_key" TEXT NOT NULL,
    "state_json" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_blacklist" (
    "id" TEXT NOT NULL,
    "wa_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "violation_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "durable_user_profiles" (
    "wa_user_id" TEXT NOT NULL,
    "preferred_language" TEXT NOT NULL DEFAULT 'auto',
    "communication_style" TEXT NOT NULL DEFAULT 'auto',
    "response_detail" TEXT NOT NULL DEFAULT 'auto',
    "data_consent" BOOLEAN NOT NULL DEFAULT false,
    "data_consent_at" TIMESTAMP(3),
    "data_consent_version" TEXT,
    "default_address" TEXT,
    "default_rt_rw" TEXT,
    "default_kelurahan" TEXT,
    "nama_lengkap" TEXT,
    "nik" TEXT,
    "no_hp" TEXT,
    "frequent_services" TEXT[],
    "total_complaints" INTEGER NOT NULL DEFAULT 0,
    "total_service_requests" INTEGER NOT NULL DEFAULT 0,
    "first_interaction" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_interaction" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_messages" INTEGER NOT NULL DEFAULT 0,
    "avg_sentiment_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frustration_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "durable_user_profiles_pkey" PRIMARY KEY ("wa_user_id")
);

-- CreateTable
CREATE TABLE "user_memory_entries" (
    "id" TEXT NOT NULL,
    "wa_user_id" TEXT NOT NULL,
    "village_id" TEXT,
    "memory_type" TEXT NOT NULL,
    "memory_key" TEXT,
    "content" TEXT NOT NULL,
    "metadata_json" JSONB,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "last_accessed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_memory_vectors" (
    "id" TEXT NOT NULL,
    "memory_entry_id" TEXT NOT NULL,
    "wa_user_id" TEXT NOT NULL,
    "village_id" TEXT,
    "memory_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "embedding" vector(768) NOT NULL,
    "embedding_model" TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_memory_vectors_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "knowledge_vectors_category_idx" ON "knowledge_vectors"("category");

-- CreateIndex
CREATE INDEX "knowledge_vectors_village_id_idx" ON "knowledge_vectors"("village_id");

-- CreateIndex
CREATE INDEX "knowledge_vectors_quality_score_idx" ON "knowledge_vectors"("quality_score");

-- CreateIndex
CREATE INDEX "document_vectors_document_id_idx" ON "document_vectors"("document_id");

-- CreateIndex
CREATE INDEX "document_vectors_village_id_idx" ON "document_vectors"("village_id");

-- CreateIndex
CREATE INDEX "document_vectors_category_idx" ON "document_vectors"("category");

-- CreateIndex
CREATE UNIQUE INDEX "document_vectors_document_id_chunk_index_key" ON "document_vectors"("document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "embedding_jobs_status_idx" ON "embedding_jobs"("status");

-- CreateIndex
CREATE INDEX "embedding_jobs_priority_idx" ON "embedding_jobs"("priority");

-- CreateIndex
CREATE INDEX "question_variants_source_id_idx" ON "question_variants"("source_id");

-- CreateIndex
CREATE INDEX "question_variants_village_id_idx" ON "question_variants"("village_id");

-- CreateIndex
CREATE INDEX "ai_token_usage_model_idx" ON "ai_token_usage"("model");

-- CreateIndex
CREATE INDEX "ai_token_usage_village_id_idx" ON "ai_token_usage"("village_id");

-- CreateIndex
CREATE INDEX "ai_token_usage_layer_type_idx" ON "ai_token_usage"("layer_type");

-- CreateIndex
CREATE INDEX "ai_token_usage_call_type_idx" ON "ai_token_usage"("call_type");

-- CreateIndex
CREATE INDEX "ai_token_usage_created_at_idx" ON "ai_token_usage"("created_at");

-- CreateIndex
CREATE INDEX "ai_token_usage_village_id_created_at_idx" ON "ai_token_usage"("village_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_token_usage_model_created_at_idx" ON "ai_token_usage"("model", "created_at");

-- CreateIndex
CREATE INDEX "ai_token_usage_channel_created_at_idx" ON "ai_token_usage"("channel", "created_at");

-- CreateIndex
CREATE INDEX "ai_token_usage_key_source_idx" ON "ai_token_usage"("key_source");

-- CreateIndex
CREATE INDEX "ai_token_usage_provider_id_idx" ON "ai_token_usage"("provider_id");

-- CreateIndex
CREATE INDEX "ai_token_usage_model_config_id_idx" ON "ai_token_usage"("model_config_id");

-- CreateIndex
CREATE INDEX "ai_token_usage_lane_type_idx" ON "ai_token_usage"("lane_type");

-- CreateIndex
CREATE UNIQUE INDEX "ai_village_wallets_village_id_key" ON "ai_village_wallets"("village_id");

-- CreateIndex
CREATE INDEX "ai_village_wallets_status_idx" ON "ai_village_wallets"("status");

-- CreateIndex
CREATE INDEX "ai_village_wallets_updated_at_idx" ON "ai_village_wallets"("updated_at");

-- CreateIndex
CREATE INDEX "ai_wallet_ledger_entries_village_id_created_at_idx" ON "ai_wallet_ledger_entries"("village_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_wallet_ledger_entries_wallet_id_created_at_idx" ON "ai_wallet_ledger_entries"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_wallet_ledger_entries_entry_type_created_at_idx" ON "ai_wallet_ledger_entries"("entry_type", "created_at");

-- CreateIndex
CREATE INDEX "ai_wallet_ledger_entries_reference_type_reference_id_idx" ON "ai_wallet_ledger_entries"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_topup_vouchers_code_key" ON "ai_topup_vouchers"("code");

-- CreateIndex
CREATE INDEX "ai_topup_vouchers_status_idx" ON "ai_topup_vouchers"("status");

-- CreateIndex
CREATE INDEX "ai_topup_vouchers_redeemed_by_village_id_idx" ON "ai_topup_vouchers"("redeemed_by_village_id");

-- CreateIndex
CREATE INDEX "ai_topup_vouchers_created_at_idx" ON "ai_topup_vouchers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_slug_key" ON "ai_providers"("slug");

-- CreateIndex
CREATE INDEX "ai_providers_is_active_idx" ON "ai_providers"("is_active");

-- CreateIndex
CREATE INDEX "ai_models_provider_id_idx" ON "ai_models"("provider_id");

-- CreateIndex
CREATE INDEX "ai_models_lane_type_idx" ON "ai_models"("lane_type");

-- CreateIndex
CREATE INDEX "ai_models_is_active_idx" ON "ai_models"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ai_models_provider_id_lane_type_upstream_model_name_key" ON "ai_models"("provider_id", "lane_type", "upstream_model_name");

-- CreateIndex
CREATE INDEX "ai_lane_assignments_lane_type_idx" ON "ai_lane_assignments"("lane_type");

-- CreateIndex
CREATE INDEX "ai_lane_assignments_village_id_idx" ON "ai_lane_assignments"("village_id");

-- CreateIndex
CREATE INDEX "ai_lane_assignments_is_global_default_idx" ON "ai_lane_assignments"("is_global_default");

-- CreateIndex
CREATE INDEX "ai_lane_assignments_is_active_idx" ON "ai_lane_assignments"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ai_lane_assignments_lane_type_village_id_is_global_default_key" ON "ai_lane_assignments"("lane_type", "village_id", "is_global_default");

-- CreateIndex
CREATE INDEX "ai_provider_health_demoted_until_idx" ON "ai_provider_health"("demoted_until");

-- CreateIndex
CREATE INDEX "ai_provider_health_probe_in_flight_until_idx" ON "ai_provider_health"("probe_in_flight_until");

-- CreateIndex
CREATE INDEX "conversation_sessions_wa_user_id_idx" ON "conversation_sessions"("wa_user_id");

-- CreateIndex
CREATE INDEX "conversation_sessions_expires_at_idx" ON "conversation_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_sessions_wa_user_id_session_key_key" ON "conversation_sessions"("wa_user_id", "session_key");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_blacklist_wa_user_id_key" ON "rate_limit_blacklist"("wa_user_id");

-- CreateIndex
CREATE INDEX "rate_limit_blacklist_wa_user_id_idx" ON "rate_limit_blacklist"("wa_user_id");

-- CreateIndex
CREATE INDEX "rate_limit_blacklist_expires_at_idx" ON "rate_limit_blacklist"("expires_at");

-- CreateIndex
CREATE INDEX "durable_user_profiles_last_interaction_idx" ON "durable_user_profiles"("last_interaction");

-- CreateIndex
CREATE INDEX "durable_user_profiles_updated_at_idx" ON "durable_user_profiles"("updated_at");

-- CreateIndex
CREATE INDEX "user_memory_entries_wa_user_id_idx" ON "user_memory_entries"("wa_user_id");

-- CreateIndex
CREATE INDEX "user_memory_entries_wa_user_id_created_at_idx" ON "user_memory_entries"("wa_user_id", "created_at");

-- CreateIndex
CREATE INDEX "user_memory_entries_wa_user_id_memory_type_idx" ON "user_memory_entries"("wa_user_id", "memory_type");

-- CreateIndex
CREATE INDEX "user_memory_entries_village_id_idx" ON "user_memory_entries"("village_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_memory_vectors_memory_entry_id_key" ON "user_memory_vectors"("memory_entry_id");

-- CreateIndex
CREATE INDEX "user_memory_vectors_wa_user_id_idx" ON "user_memory_vectors"("wa_user_id");

-- CreateIndex
CREATE INDEX "user_memory_vectors_wa_user_id_memory_type_idx" ON "user_memory_vectors"("wa_user_id", "memory_type");

-- CreateIndex
CREATE INDEX "user_memory_vectors_village_id_idx" ON "user_memory_vectors"("village_id");

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

-- CreateIndex
CREATE INDEX "ai_memory_traces_wa_user_id_created_at_idx" ON "ai_memory_traces"("wa_user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_memory_traces_village_id_created_at_idx" ON "ai_memory_traces"("village_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_memory_traces_source_created_at_idx" ON "ai_memory_traces"("source", "created_at");

-- CreateIndex
CREATE INDEX "ai_memory_traces_channel_created_at_idx" ON "ai_memory_traces"("channel", "created_at");

-- CreateIndex
CREATE INDEX "ai_guardrail_events_guard_type_created_at_idx" ON "ai_guardrail_events"("guard_type", "created_at");

-- CreateIndex
CREATE INDEX "ai_guardrail_events_guard_stage_created_at_idx" ON "ai_guardrail_events"("guard_stage", "created_at");

-- CreateIndex
CREATE INDEX "ai_guardrail_events_village_id_created_at_idx" ON "ai_guardrail_events"("village_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_guardrail_events_channel_created_at_idx" ON "ai_guardrail_events"("channel", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_allowlist_policies_policy_key_key" ON "ai_tool_allowlist_policies"("policy_key");

-- CreateIndex
CREATE INDEX "ai_tool_allowlist_policies_source_updated_at_idx" ON "ai_tool_allowlist_policies"("source", "updated_at");

-- CreateIndex
CREATE INDEX "ai_tool_allowlist_policies_confidence_updated_at_idx" ON "ai_tool_allowlist_policies"("confidence", "updated_at");

-- CreateIndex
CREATE INDEX "ai_tool_policy_events_policy_key_created_at_idx" ON "ai_tool_policy_events"("policy_key", "created_at");

-- CreateIndex
CREATE INDEX "ai_tool_policy_events_village_id_created_at_idx" ON "ai_tool_policy_events"("village_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_tool_policy_events_channel_created_at_idx" ON "ai_tool_policy_events"("channel", "created_at");

-- AddForeignKey
ALTER TABLE "ai_wallet_ledger_entries" ADD CONSTRAINT "ai_wallet_ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "ai_village_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lane_assignments" ADD CONSTRAINT "ai_lane_assignments_primary_model_id_fkey" FOREIGN KEY ("primary_model_id") REFERENCES "ai_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lane_assignments" ADD CONSTRAINT "ai_lane_assignments_fallback_model_id_fkey" FOREIGN KEY ("fallback_model_id") REFERENCES "ai_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_memory_vectors" ADD CONSTRAINT "user_memory_vectors_memory_entry_id_fkey" FOREIGN KEY ("memory_entry_id") REFERENCES "user_memory_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

