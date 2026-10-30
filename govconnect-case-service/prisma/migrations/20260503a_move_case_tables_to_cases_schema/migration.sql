-- Corrective migration for production schema drift.
-- App raw SQL qualifies these tables as cases."...", but the squashed
-- baseline created them in public. Move them to cases on fresh installs.
-- Guarded: no-op when tables are already in cases or absent.
CREATE SCHEMA IF NOT EXISTS cases;

DO $$
BEGIN
  IF to_regclass('cases.complaints') IS NULL AND to_regclass('public.complaints') IS NOT NULL THEN
    ALTER TABLE public.complaints SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.complaint_categories') IS NULL AND to_regclass('public.complaint_categories') IS NOT NULL THEN
    ALTER TABLE public.complaint_categories SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.complaint_types') IS NULL AND to_regclass('public.complaint_types') IS NOT NULL THEN
    ALTER TABLE public.complaint_types SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.complaint_updates') IS NULL AND to_regclass('public.complaint_updates') IS NOT NULL THEN
    ALTER TABLE public.complaint_updates SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.service_categories') IS NULL AND to_regclass('public.service_categories') IS NOT NULL THEN
    ALTER TABLE public.service_categories SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.services_dynamic') IS NULL AND to_regclass('public.services_dynamic') IS NOT NULL THEN
    ALTER TABLE public.services_dynamic SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.service_requirements') IS NULL AND to_regclass('public.service_requirements') IS NOT NULL THEN
    ALTER TABLE public.service_requirements SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.service_requests') IS NULL AND to_regclass('public.service_requests') IS NOT NULL THEN
    ALTER TABLE public.service_requests SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.service_request_updates') IS NULL AND to_regclass('public.service_request_updates') IS NOT NULL THEN
    ALTER TABLE public.service_request_updates SET SCHEMA cases;
  END IF;
  IF to_regclass('cases.event_outbox') IS NULL AND to_regclass('public.event_outbox') IS NOT NULL THEN
    ALTER TABLE public.event_outbox SET SCHEMA cases;
  END IF;
END $$;
