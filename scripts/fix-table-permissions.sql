-- ============================================================================
-- FIX TABLE PERMISSIONS FOR POSTGREST
-- ============================================================================
-- PostgREST needs explicit permissions to expose tables via API
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Grant permissions to anon and authenticated roles
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

-- Specific grants for our new tables
GRANT SELECT, INSERT, UPDATE, DELETE ON raw_emails TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_classifications TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_extractions TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON raw_attachments TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON classification_feedback TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON entity_feedback TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON classification_rules TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback_applications TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON feedback_impact_metrics TO anon, authenticated, service_role;

-- Grant on sequences (for auto-increment IDs if any)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Force PostgREST to reload schema after permissions change
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- Verify permissions were granted
SELECT
    'PERMISSIONS GRANTED' as status,
    tablename,
    grantee,
    privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND tablename IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments')
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY tablename, grantee, privilege_type;
