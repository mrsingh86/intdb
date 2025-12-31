-- Direct SQL query to check raw_emails table
-- Run this in Supabase SQL Editor

SELECT
  COUNT(*) as total_emails,
  COUNT(DISTINCT thread_id) as unique_threads,
  MIN(received_at) as oldest_email,
  MAX(received_at) as newest_email
FROM raw_emails;

-- Sample emails
SELECT
  id,
  subject,
  sender_email,
  thread_id,
  received_at
FROM raw_emails
ORDER BY received_at DESC
LIMIT 10;
