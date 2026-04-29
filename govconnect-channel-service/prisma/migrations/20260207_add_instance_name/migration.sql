ALTER TABLE "wa_sessions" ADD COLUMN IF NOT EXISTS "instance_name" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "wa_sessions_instance_name_key" ON "wa_sessions"("instance_name");
