-- ============================================================================
-- FORCE POSTGREST SCHEMA RELOAD
-- ============================================================================
-- Run this in Supabase SQL Editor to force PostgREST to reload the schema
-- This should fix the "table not in schema cache" error
-- ============================================================================

-- 1. Send reload notification to PostgREST
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- 2. Verify tables exist
SELECT
    'VERIFY TABLES EXIST' as status,
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments')
ORDER BY tablename;

-- 3. Count rows in each table
SELECT 'raw_emails' as table_name, COUNT(*) as row_count FROM raw_emails
UNION ALL
SELECT 'document_classifications', COUNT(*) FROM document_classifications
UNION ALL
SELECT 'entity_extractions', COUNT(*) FROM entity_extractions
UNION ALL
SELECT 'raw_attachments', COUNT(*) FROM raw_attachments;

-- 4. Terminate PostgREST connections (forces restart)
SELECT
    'TERMINATE POSTGREST CONNECTIONS' as action,
    pg_terminate_backend(pid) as terminated,
    application_name,
    state
FROM pg_stat_activity
WHERE application_name = 'PostgREST'
   OR application_name LIKE '%postgrest%';

-- 5. Check for any stuck connections
SELECT
    'ACTIVE CONNECTIONS' as status,
    application_name,
    state,
    COUNT(*) as connection_count
FROM pg_stat_activity
WHERE application_name IS NOT NULL
GROUP BY application_name, state
ORDER BY connection_count DESC;

-- ============================================================================
-- After running this, wait 30 seconds then test API access
-- ============================================================================
