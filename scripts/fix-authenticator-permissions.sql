-- Grant to authenticator role (PostgREST's login role)
GRANT USAGE ON SCHEMA public TO authenticator;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticator;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticator;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticator;

-- Also ensure authenticator can switch to these roles
GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;

-- Force reload
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- Verify authenticator has permissions
SELECT 
    grantee,
    table_name,
    string_agg(privilege_type, ', ') as privileges
FROM information_schema.table_privileges
WHERE table_name IN ('raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments')
  AND grantee = 'authenticator'
GROUP BY grantee, table_name
ORDER BY table_name;
