ALTER TABLE "complaints"
  ADD COLUMN IF NOT EXISTS "last_delivery_status" TEXT,
  ADD COLUMN IF NOT EXISTS "last_delivery_error" TEXT,
  ADD COLUMN IF NOT EXISTS "last_delivery_attempt_at" TIMESTAMP(3);

ALTER TABLE "service_requests"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "last_delivery_status" TEXT,
  ADD COLUMN IF NOT EXISTS "last_delivery_error" TEXT,
  ADD COLUMN IF NOT EXISTS "last_delivery_attempt_at" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'service_requests_idempotency_key'
  ) THEN
    ALTER TABLE "service_requests"
      ADD CONSTRAINT "service_requests_idempotency_key"
      UNIQUE ("service_id", "channel", "channel_identifier", "idempotency_key");
  END IF;
END $$;
