-- Add per-message AI billing while preserving historical per-call rows.
ALTER TABLE "ai_token_usage"
  ADD COLUMN "message_id" TEXT,
  ADD COLUMN "trace_id" TEXT,
  ADD COLUMN "billing_group_id" TEXT,
  ADD COLUMN "billing_status" TEXT NOT NULL DEFAULT 'unbilled',
  ADD COLUMN "billed_at" TIMESTAMP(3),
  ADD COLUMN "pricing_source" TEXT,
  ADD COLUMN "actual_pricing_type" TEXT,
  ADD COLUMN "actual_fixed_price_usd" DOUBLE PRECISION,
  ADD COLUMN "actual_input_price_per_million_usd" DOUBLE PRECISION,
  ADD COLUMN "actual_output_price_per_million_usd" DOUBLE PRECISION,
  ADD COLUMN "adjusted_pricing_type" TEXT,
  ADD COLUMN "adjusted_fixed_price_usd" DOUBLE PRECISION,
  ADD COLUMN "adjusted_input_price_per_million_usd" DOUBLE PRECISION,
  ADD COLUMN "adjusted_output_price_per_million_usd" DOUBLE PRECISION,
  ADD COLUMN "pricing_snapshot_json" JSONB;

UPDATE "ai_token_usage"
SET "billing_status" = 'legacy_billed'
WHERE "billing_group_id" IS NULL;

CREATE TABLE "ai_message_billings" (
  "id" TEXT NOT NULL,
  "village_id" TEXT,
  "message_id" TEXT,
  "trace_id" TEXT NOT NULL,
  "billing_group_id" TEXT NOT NULL,
  "channel" TEXT,
  "wa_user_id" TEXT,
  "session_id" TEXT,
  "batched_message_ids" TEXT[],
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "call_count" INTEGER NOT NULL DEFAULT 0,
  "actual_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "adjusted_cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "margin_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "ledger_entry_id" TEXT,
  "error_message" TEXT,
  "metadata_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "billed_at" TIMESTAMP(3),

  CONSTRAINT "ai_message_billings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_message_billings_billing_group_id_key" ON "ai_message_billings"("billing_group_id");
CREATE INDEX "ai_token_usage_village_id_message_id_idx" ON "ai_token_usage"("village_id", "message_id");
CREATE INDEX "ai_token_usage_trace_id_idx" ON "ai_token_usage"("trace_id");
CREATE INDEX "ai_token_usage_billing_group_id_idx" ON "ai_token_usage"("billing_group_id");
CREATE INDEX "ai_token_usage_billing_status_created_at_idx" ON "ai_token_usage"("billing_status", "created_at");
CREATE INDEX "ai_token_usage_village_id_billing_status_created_at_idx" ON "ai_token_usage"("village_id", "billing_status", "created_at");
CREATE INDEX "ai_message_billings_village_id_created_at_idx" ON "ai_message_billings"("village_id", "created_at");
CREATE INDEX "ai_message_billings_message_id_idx" ON "ai_message_billings"("message_id");
CREATE INDEX "ai_message_billings_trace_id_idx" ON "ai_message_billings"("trace_id");
CREATE INDEX "ai_message_billings_status_created_at_idx" ON "ai_message_billings"("status", "created_at");
CREATE INDEX "ai_message_billings_ledger_entry_id_idx" ON "ai_message_billings"("ledger_entry_id");
CREATE UNIQUE INDEX "ai_wallet_ledger_unique_reference_idx"
  ON "ai_wallet_ledger_entries"("entry_type", "reference_type", "reference_id")
  WHERE "entry_type" = 'usage_debit' AND "reference_type" IS NOT NULL AND "reference_id" IS NOT NULL;
