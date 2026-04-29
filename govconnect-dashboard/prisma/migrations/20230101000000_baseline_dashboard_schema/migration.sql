-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'village_admin',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "village_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "details" JSONB,
    "ip_address" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "village_behavior_configs" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "active_service_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "important_contacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "service_hours" JSONB,
    "local_faq_priority" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escalation_routing" JSONB,
    "complaint_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "service_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notice" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "village_behavior_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_golden_set_runs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "village_id" TEXT,
    "total" INTEGER NOT NULL,
    "intent_accuracy" DOUBLE PRECISION NOT NULL,
    "tool_accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "keyword_accuracy" DOUBLE PRECISION NOT NULL,
    "overall_accuracy" DOUBLE PRECISION NOT NULL,
    "regression_detected" BOOLEAN NOT NULL DEFAULT false,
    "release_gate_pass" BOOLEAN NOT NULL DEFAULT true,
    "thresholds" JSONB NOT NULL,
    "status" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_golden_set_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_golden_set_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "expected_intent" TEXT,
    "expected_tools" JSONB,
    "actual_tools" JSONB,
    "predicted_intent" TEXT NOT NULL,
    "reply_text" TEXT NOT NULL,
    "intent_match" BOOLEAN,
    "tool_match" BOOLEAN,
    "tool_score" DOUBLE PRECISION,
    "keyword_match" BOOLEAN,
    "keyword_score" DOUBLE PRECISION,
    "score" DOUBLE PRECISION NOT NULL,
    "trace_score" DOUBLE PRECISION,
    "trace_grade" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "scenario" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_golden_set_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_gaps" (
    "id" TEXT NOT NULL,
    "query_text" TEXT NOT NULL,
    "query_hash" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "confidence_level" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "village_id" TEXT NOT NULL DEFAULT '',
    "hit_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "resolution_kb_id" TEXT,

    CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_conflicts" (
    "id" TEXT NOT NULL,
    "conflict_hash" TEXT NOT NULL,
    "village_id" TEXT NOT NULL DEFAULT '',
    "source1_title" TEXT NOT NULL,
    "source2_title" TEXT NOT NULL,
    "content_summary" TEXT NOT NULL,
    "similarity_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "query_text" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'system',
    "hit_count" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'open',
    "auto_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_base" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "category_id" TEXT,
    "village_id" TEXT,
    "keywords" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "admin_id" TEXT,
    "last_edited_at" TIMESTAMP(3),
    "last_embedded_at" TIMESTAMP(3),
    "embedding_status" TEXT NOT NULL DEFAULT 'pending',
    "embedding_error" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_base_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_url" TEXT NOT NULL,
    "village_id" TEXT,
    "category_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "title" TEXT,
    "description" TEXT,
    "category" TEXT,
    "total_chunks" INTEGER,
    "total_tokens" INTEGER,
    "admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "page_number" INTEGER,
    "section_title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "villages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "villages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "village_profiles" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "gmaps_url" TEXT,
    "short_name" TEXT NOT NULL,
    "operating_hours" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "village_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_categories" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "important_contact_categories" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "important_contact_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "important_contacts" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "important_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "genfity_whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "village_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "session_name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "logged_in" BOOLEAN NOT NULL DEFAULT false,
    "jid" TEXT,
    "qrcode" TEXT,
    "message" TEXT,
    "webhook" TEXT,
    "events" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genfity_whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gemini_api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "gmail_account" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'free',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "invalid_reason" TEXT,
    "last_error" TEXT,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "last_validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gemini_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gemini_api_key_usage" (
    "id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "period_type" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "gemini_api_key_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_key" ON "admin_sessions"("token");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "admin_sessions_expires_at_idx" ON "admin_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "activity_logs_admin_id_idx" ON "activity_logs"("admin_id");

-- CreateIndex
CREATE INDEX "activity_logs_timestamp_idx" ON "activity_logs"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "village_behavior_configs_village_id_key" ON "village_behavior_configs"("village_id");

-- CreateIndex
CREATE INDEX "village_behavior_configs_village_id_idx" ON "village_behavior_configs"("village_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_golden_set_runs_run_id_key" ON "ai_golden_set_runs"("run_id");

-- CreateIndex
CREATE INDEX "ai_golden_set_runs_completed_at_idx" ON "ai_golden_set_runs"("completed_at");

-- CreateIndex
CREATE INDEX "ai_golden_set_items_run_id_idx" ON "ai_golden_set_items"("run_id");

-- CreateIndex
CREATE INDEX "knowledge_gaps_village_id_idx" ON "knowledge_gaps"("village_id");

-- CreateIndex
CREATE INDEX "knowledge_gaps_status_idx" ON "knowledge_gaps"("status");

-- CreateIndex
CREATE INDEX "knowledge_gaps_hit_count_idx" ON "knowledge_gaps"("hit_count");

-- CreateIndex
CREATE INDEX "knowledge_gaps_last_seen_at_idx" ON "knowledge_gaps"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_gaps_query_hash_village_id_key" ON "knowledge_gaps"("query_hash", "village_id");

-- CreateIndex
CREATE INDEX "knowledge_conflicts_village_id_idx" ON "knowledge_conflicts"("village_id");

-- CreateIndex
CREATE INDEX "knowledge_conflicts_status_idx" ON "knowledge_conflicts"("status");

-- CreateIndex
CREATE INDEX "knowledge_conflicts_hit_count_idx" ON "knowledge_conflicts"("hit_count");

-- CreateIndex
CREATE INDEX "knowledge_conflicts_last_seen_at_idx" ON "knowledge_conflicts"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_conflicts_conflict_hash_village_id_key" ON "knowledge_conflicts"("conflict_hash", "village_id");

-- CreateIndex
CREATE INDEX "knowledge_base_category_idx" ON "knowledge_base"("category");

-- CreateIndex
CREATE INDEX "knowledge_base_category_id_idx" ON "knowledge_base"("category_id");

-- CreateIndex
CREATE INDEX "knowledge_base_village_id_idx" ON "knowledge_base"("village_id");

-- CreateIndex
CREATE INDEX "knowledge_base_is_active_idx" ON "knowledge_base"("is_active");

-- CreateIndex
CREATE INDEX "knowledge_base_keywords_idx" ON "knowledge_base"("keywords");

-- CreateIndex
CREATE INDEX "knowledge_documents_status_idx" ON "knowledge_documents"("status");

-- CreateIndex
CREATE INDEX "knowledge_documents_category_idx" ON "knowledge_documents"("category");

-- CreateIndex
CREATE INDEX "knowledge_documents_category_id_idx" ON "knowledge_documents"("category_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_village_id_idx" ON "knowledge_documents"("village_id");

-- CreateIndex
CREATE INDEX "knowledge_documents_created_at_idx" ON "knowledge_documents"("created_at");

-- CreateIndex
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");

-- CreateIndex
CREATE INDEX "document_chunks_chunk_index_idx" ON "document_chunks"("chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "villages_slug_key" ON "villages"("slug");

-- CreateIndex
CREATE INDEX "village_profiles_village_id_idx" ON "village_profiles"("village_id");

-- CreateIndex
CREATE INDEX "knowledge_categories_village_id_idx" ON "knowledge_categories"("village_id");

-- CreateIndex
CREATE INDEX "knowledge_categories_name_idx" ON "knowledge_categories"("name");

-- CreateIndex
CREATE INDEX "important_contact_categories_village_id_idx" ON "important_contact_categories"("village_id");

-- CreateIndex
CREATE INDEX "important_contact_categories_name_idx" ON "important_contact_categories"("name");

-- CreateIndex
CREATE INDEX "important_contacts_category_id_idx" ON "important_contacts"("category_id");

-- CreateIndex
CREATE INDEX "important_contacts_phone_idx" ON "important_contacts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "genfity_whatsapp_sessions_village_id_key" ON "genfity_whatsapp_sessions"("village_id");

-- CreateIndex
CREATE UNIQUE INDEX "genfity_whatsapp_sessions_session_id_key" ON "genfity_whatsapp_sessions"("session_id");

-- CreateIndex
CREATE INDEX "genfity_whatsapp_sessions_village_id_idx" ON "genfity_whatsapp_sessions"("village_id");

-- CreateIndex
CREATE INDEX "genfity_whatsapp_sessions_session_id_idx" ON "genfity_whatsapp_sessions"("session_id");

-- CreateIndex
CREATE INDEX "genfity_whatsapp_sessions_connected_idx" ON "genfity_whatsapp_sessions"("connected");

-- CreateIndex
CREATE INDEX "gemini_api_keys_is_active_is_valid_idx" ON "gemini_api_keys"("is_active", "is_valid");

-- CreateIndex
CREATE INDEX "gemini_api_keys_tier_idx" ON "gemini_api_keys"("tier");

-- CreateIndex
CREATE INDEX "gemini_api_keys_priority_idx" ON "gemini_api_keys"("priority");

-- CreateIndex
CREATE INDEX "gemini_api_key_usage_key_id_idx" ON "gemini_api_key_usage"("key_id");

-- CreateIndex
CREATE INDEX "gemini_api_key_usage_period_type_period_key_idx" ON "gemini_api_key_usage"("period_type", "period_key");

-- CreateIndex
CREATE INDEX "gemini_api_key_usage_key_id_model_period_type_period_key_idx" ON "gemini_api_key_usage"("key_id", "model", "period_type", "period_key");

-- CreateIndex
CREATE UNIQUE INDEX "gemini_api_key_usage_key_id_model_period_type_period_key_key" ON "gemini_api_key_usage"("key_id", "model", "period_type", "period_key");

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "village_behavior_configs" ADD CONSTRAINT "village_behavior_configs_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_golden_set_items" ADD CONSTRAINT "ai_golden_set_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_golden_set_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "knowledge_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "knowledge_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "village_profiles" ADD CONSTRAINT "village_profiles_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "important_contact_categories" ADD CONSTRAINT "important_contact_categories_village_id_fkey" FOREIGN KEY ("village_id") REFERENCES "villages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "important_contacts" ADD CONSTRAINT "important_contacts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "important_contact_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gemini_api_key_usage" ADD CONSTRAINT "gemini_api_key_usage_key_id_fkey" FOREIGN KEY ("key_id") REFERENCES "gemini_api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

