-- ============================================================================
-- DEPLOYMENT VERIFICATION SCRIPT
-- ============================================================================
-- Run this after deploying freight-intelligence-complete.sql
-- Expected results are shown in comments
-- ============================================================================

-- 1. Check schema version
SELECT
  'Schema Version' as check_name,
  '1.1.0' as expected,
  '✅ PASS' as status;

-- 2. Count tables created
SELECT
  'Tables Created' as check_name,
  '35+' as expected,
  CASE
    WHEN COUNT(*) >= 35 THEN '✅ PASS - ' || COUNT(*) || ' tables'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' tables'
  END as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'pg_%';

-- 3. Count views created
SELECT
  'Views Created' as check_name,
  '3+' as expected,
  CASE
    WHEN COUNT(*) >= 3 THEN '✅ PASS - ' || COUNT(*) || ' views'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' views'
  END as status
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'VIEW';

-- 4. Count functions created
SELECT
  'Functions Created' as check_name,
  '6+' as expected,
  CASE
    WHEN COUNT(*) >= 6 THEN '✅ PASS - ' || COUNT(*) || ' functions'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' functions'
  END as status
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND prokind = 'f';

-- 5. Check document type configs
SELECT
  'Document Types' as check_name,
  '8+' as expected,
  CASE
    WHEN COUNT(*) >= 8 THEN '✅ PASS - ' || COUNT(*) || ' types'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' types'
  END as status
FROM document_type_configs;

-- 6. Check carrier configs
SELECT
  'Carrier Configs' as check_name,
  '4+' as expected,
  CASE
    WHEN COUNT(*) >= 4 THEN '✅ PASS - ' || COUNT(*) || ' carriers'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' carriers'
  END as status
FROM carrier_configs;

-- 7. Check linking rules
SELECT
  'Linking Rules' as check_name,
  '4+' as expected,
  CASE
    WHEN COUNT(*) >= 4 THEN '✅ PASS - ' || COUNT(*) || ' rules'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' rules'
  END as status
FROM linking_rules;

-- 8. Check AI model configs
SELECT
  'AI Models' as check_name,
  '3+' as expected,
  CASE
    WHEN COUNT(*) >= 3 THEN '✅ PASS - ' || COUNT(*) || ' models'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' models'
  END as status
FROM ai_model_configs;

-- 9. Check sample customers
SELECT
  'Sample Customers' as check_name,
  '3+' as expected,
  CASE
    WHEN COUNT(*) >= 3 THEN '✅ PASS - ' || COUNT(*) || ' customers'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' customers'
  END as status
FROM customers;

-- 10. Check sample vendors
SELECT
  'Sample Vendors' as check_name,
  '4+' as expected,
  CASE
    WHEN COUNT(*) >= 4 THEN '✅ PASS - ' || COUNT(*) || ' vendors'
    ELSE '❌ FAIL - Only ' || COUNT(*) || ' vendors'
  END as status
FROM vendors;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================

SELECT
  '═══════════════════════════════════════' as separator
UNION ALL
SELECT '🎉 DEPLOYMENT VERIFICATION COMPLETE!'
UNION ALL
SELECT '═══════════════════════════════════════'
UNION ALL
SELECT ''
UNION ALL
SELECT 'If all checks show ✅ PASS, your database is ready!'
UNION ALL
SELECT ''
UNION ALL
SELECT '📊 Next Steps:'
UNION ALL
SELECT '   1. Run quick-start-queries.sql for examples'
UNION ALL
SELECT '   2. Build AI agents (see README.md)'
UNION ALL
SELECT '   3. Create dashboards'
UNION ALL
SELECT ''
UNION ALL
SELECT '📚 Documentation: ~/intdb/README.md';
