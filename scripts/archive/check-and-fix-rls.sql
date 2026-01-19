-- Check if RLS is enabled on our tables
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments', 
                     'classification_feedback', 'entity_feedback', 'classification_rules', 
                     'feedback_applications', 'feedback_impact_metrics')
ORDER BY tablename;

-- Disable RLS on all feedback system tables
ALTER TABLE raw_emails DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_classifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE entity_extractions DISABLE ROW LEVEL SECURITY;
ALTER TABLE raw_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE classification_feedback DISABLE ROW LEVEL SECURITY;
ALTER TABLE entity_feedback DISABLE ROW LEVEL SECURITY;
ALTER TABLE classification_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_applications DISABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_impact_metrics DISABLE ROW LEVEL SECURITY;

-- Force PostgREST reload
NOTIFY pgrst, 'reload schema';

-- Verify RLS is now disabled
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments')
ORDER BY tablename;
