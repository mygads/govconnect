-- Corrective migration for production schema drift.
-- App raw SQL qualifies these tables as ai."..." (see commit e94ecd9),
-- but the squashed baseline created them in public. Move them to ai on fresh installs.
-- Guarded: no-op when tables are already in ai or absent.
CREATE SCHEMA IF NOT EXISTS ai;

DO $$
BEGIN
  IF to_regclass('ai.ai_guardrail_events') IS NULL AND to_regclass('public.ai_guardrail_events') IS NOT NULL THEN
    ALTER TABLE public.ai_guardrail_events SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_interaction_events') IS NULL AND to_regclass('public.ai_interaction_events') IS NOT NULL THEN
    ALTER TABLE public.ai_interaction_events SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_memory_traces') IS NULL AND to_regclass('public.ai_memory_traces') IS NOT NULL THEN
    ALTER TABLE public.ai_memory_traces SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_message_billings') IS NULL AND to_regclass('public.ai_message_billings') IS NOT NULL THEN
    ALTER TABLE public.ai_message_billings SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_models') IS NULL AND to_regclass('public.ai_models') IS NOT NULL THEN
    ALTER TABLE public.ai_models SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_provider_health') IS NULL AND to_regclass('public.ai_provider_health') IS NOT NULL THEN
    ALTER TABLE public.ai_provider_health SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_providers') IS NULL AND to_regclass('public.ai_providers') IS NOT NULL THEN
    ALTER TABLE public.ai_providers SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_retrieval_traces') IS NULL AND to_regclass('public.ai_retrieval_traces') IS NOT NULL THEN
    ALTER TABLE public.ai_retrieval_traces SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_token_usage') IS NULL AND to_regclass('public.ai_token_usage') IS NOT NULL THEN
    ALTER TABLE public.ai_token_usage SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_tool_allowlist_policies') IS NULL AND to_regclass('public.ai_tool_allowlist_policies') IS NOT NULL THEN
    ALTER TABLE public.ai_tool_allowlist_policies SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_tool_policy_events') IS NULL AND to_regclass('public.ai_tool_policy_events') IS NOT NULL THEN
    ALTER TABLE public.ai_tool_policy_events SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_topup_vouchers') IS NULL AND to_regclass('public.ai_topup_vouchers') IS NOT NULL THEN
    ALTER TABLE public.ai_topup_vouchers SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_village_wallets') IS NULL AND to_regclass('public.ai_village_wallets') IS NOT NULL THEN
    ALTER TABLE public.ai_village_wallets SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.ai_wallet_ledger_entries') IS NULL AND to_regclass('public.ai_wallet_ledger_entries') IS NOT NULL THEN
    ALTER TABLE public.ai_wallet_ledger_entries SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.embedding_jobs') IS NULL AND to_regclass('public.embedding_jobs') IS NOT NULL THEN
    ALTER TABLE public.embedding_jobs SET SCHEMA ai;
  END IF;
  IF to_regclass('ai.rate_limit_blacklist') IS NULL AND to_regclass('public.rate_limit_blacklist') IS NOT NULL THEN
    ALTER TABLE public.rate_limit_blacklist SET SCHEMA ai;
  END IF;
END $$;
