-- GovConnect Database Initialization Script
-- This script runs automatically when database container starts
-- Creates separate schemas for each service

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Set timezone to Asia/Jakarta
SET timezone = 'Asia/Jakarta';

-- ==================== CREATE SCHEMAS ====================

-- Schema for Channel Service
CREATE SCHEMA IF NOT EXISTS channel;
COMMENT ON SCHEMA channel IS 'Schema for Channel Service - WhatsApp message handling';

-- Schema for Case Service
CREATE SCHEMA IF NOT EXISTS cases;
COMMENT ON SCHEMA cases IS 'Schema for Case Service - Complaints and tickets';

-- Schema for Notification Service
CREATE SCHEMA IF NOT EXISTS notification;
COMMENT ON SCHEMA notification IS 'Schema for Notification Service - Outbound messaging';

-- Schema for Dashboard Service
CREATE SCHEMA IF NOT EXISTS dashboard;
COMMENT ON SCHEMA dashboard IS 'Schema for Dashboard Service - Admin panel';

-- Schema for Testing (optional)
CREATE SCHEMA IF NOT EXISTS testing;
COMMENT ON SCHEMA testing IS 'Schema for integration and e2e testing';

-- ==================== GRANT PERMISSIONS ====================

-- Grant all privileges on schemas to postgres user
GRANT ALL ON SCHEMA channel TO postgres;
GRANT ALL ON SCHEMA cases TO postgres;
GRANT ALL ON SCHEMA notification TO postgres;
GRANT ALL ON SCHEMA dashboard TO postgres;
GRANT ALL ON SCHEMA testing TO postgres;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA channel GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA cases GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA notification GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA dashboard GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA testing GRANT ALL ON TABLES TO postgres;

-- ==================== HEALTH CHECK FUNCTION ====================

CREATE OR REPLACE FUNCTION public.health_check()
RETURNS TABLE(
    status text, 
    database_name text, 
    version text,
    schemas text[]
) AS $$
BEGIN
    RETURN QUERY SELECT 
        'healthy'::text,
        current_database()::text,
        version()::text,
        ARRAY['channel', 'cases', 'notification', 'dashboard', 'testing']::text[];
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION public.health_check() IS 'Health check function for monitoring';

-- ==================== LOG INITIALIZATION ====================

DO $$
BEGIN
    RAISE NOTICE '================================================';
    RAISE NOTICE 'GovConnect Database Initialized Successfully';
    RAISE NOTICE '================================================';
    RAISE NOTICE 'PostgreSQL Version: %', version();
    RAISE NOTICE 'Current Database: %', current_database();
    RAISE NOTICE 'Timezone: %', current_setting('timezone');
    RAISE NOTICE '';
    RAISE NOTICE 'Created Schemas:';
    RAISE NOTICE '  - channel (Channel Service)';
    RAISE NOTICE '  - cases (Case Service)';
    RAISE NOTICE '  - notification (Notification Service)';
    RAISE NOTICE '  - dashboard (Dashboard Service)';
    RAISE NOTICE '  - testing (Testing)';
    RAISE NOTICE '================================================';
END $$;
