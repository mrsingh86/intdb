-- Force PostgREST to reload schema cache
-- Run this in Supabase SQL Editor

NOTIFY pgrst, 'reload schema';

-- Verify tables exist
SELECT
  schemaname,
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments')
ORDER BY tablename;

-- Count rows
SELECT
  'raw_emails' as table_name,
  COUNT(*) as row_count
FROM raw_emails

UNION ALL

SELECT
  'document_classifications',
  COUNT(*)
FROM document_classifications

UNION ALL

SELECT
  'entity_extractions',
  COUNT(*)
FROM entity_extractions

UNION ALL

SELECT
  'raw_attachments',
  COUNT(*)
FROM raw_attachments;
