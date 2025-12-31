-- ============================================================================
-- CONNECTION TEST - Run this first to verify Supabase connection
-- ============================================================================

-- 1. Test basic query
SELECT
  'Connection successful! ✅' as status,
  current_database() as database,
  version() as postgres_version,
  NOW() as current_time;

-- 2. Test extension creation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

SELECT 'Extensions enabled ✅' as status;

-- 3. Create a simple test table
CREATE TABLE IF NOT EXISTS connection_test (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Insert test data
INSERT INTO connection_test (test_message)
VALUES ('Supabase INTDB connection working!');

-- 5. Verify insert
SELECT
  '✅ Test table created and data inserted' as status,
  *
FROM connection_test;

-- 6. Cleanup
DROP TABLE connection_test;

SELECT
  '🎉 CONNECTION TEST COMPLETE!' as final_status,
  'Ready to deploy full schema' as next_step;
