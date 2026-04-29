ALTER TABLE "wa_sessions" ADD COLUMN IF NOT EXISTS "wa_support_user_id" TEXT;
ALTER TABLE "wa_sessions" ADD COLUMN IF NOT EXISTS "wa_support_api_key" TEXT;
ALTER TABLE "wa_sessions" ADD COLUMN IF NOT EXISTS "wa_support_session_id" TEXT;
