-- Add notification_enabled column to village_behavior_configs
-- This column was added to schema.prisma without a migration
ALTER TABLE "village_behavior_configs"
  ADD COLUMN IF NOT EXISTS "notification_enabled" BOOLEAN DEFAULT true;
