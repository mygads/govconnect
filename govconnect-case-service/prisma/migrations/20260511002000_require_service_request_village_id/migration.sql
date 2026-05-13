UPDATE "service_requests" AS sr
SET "village_id" = s."village_id"
FROM "services_dynamic" AS s
WHERE sr."service_id" = s."id"
  AND sr."village_id" IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "service_requests"
    WHERE "village_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'service_requests.village_id contains NULL rows after backfill';
  END IF;
END $$;

ALTER TABLE "service_requests"
  ALTER COLUMN "village_id" SET NOT NULL;
