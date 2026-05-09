-- Add per-village timezone configuration
ALTER TABLE "villages"
ADD COLUMN IF NOT EXISTS "timezone" TEXT;
