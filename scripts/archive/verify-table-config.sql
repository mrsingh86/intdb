-- Verify tables exist in public schema
SELECT 
    table_schema,
    table_name,
    table_type
FROM information_schema.tables
WHERE table_name IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments')
ORDER BY table_name;

-- Check table ownership
SELECT 
    schemaname,
    tablename,
    tableowner
FROM pg_tables
WHERE tablename IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments')
ORDER BY tablename;

-- Check all permissions on these tables
SELECT 
    grantee,
    table_schema,
    table_name,
    string_agg(privilege_type, ', ') as privileges
FROM information_schema.table_privileges
WHERE table_name IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments')
GROUP BY grantee, table_schema, table_name
ORDER BY table_name, grantee;

-- Check if PostgREST role (authenticator) has access
SELECT 
    r.rolname,
    r.rolsuper,
    r.rolinherit,
    r.rolcreaterole,
    r.rolcreatedb,
    r.rolcanlogin
FROM pg_roles r
WHERE r.rolname IN ('authenticator', 'anon', 'authenticated', 'service_role', 'postgres')
ORDER BY r.rolname;
