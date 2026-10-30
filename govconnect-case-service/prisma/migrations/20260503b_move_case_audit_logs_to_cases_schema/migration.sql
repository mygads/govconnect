-- Move case_audit_logs to cases schema (app uses cases.case_audit_logs).
-- Guarded: no-op when already moved or absent.
DO $$
BEGIN
  IF to_regclass('cases.case_audit_logs') IS NULL AND to_regclass('public.case_audit_logs') IS NOT NULL THEN
    ALTER TABLE public.case_audit_logs SET SCHEMA cases;
  END IF;
END $$;
