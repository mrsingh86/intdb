-- ============================================================================
-- FREIGHT INTELLIGENCE - QUICK START QUERIES
-- ============================================================================
-- Run these queries after deployment to verify and explore your database
-- ============================================================================

-- ============================================================================
-- SECTION 1: VERIFY DEPLOYMENT
-- ============================================================================

-- 1.1 Check schema version and installation
SELECT
  'Schema Version' as metric,
  '1.1.0 - Freight Intelligence with Stakeholder Intelligence' as value
UNION ALL
SELECT
  'Deployment Date',
  NOW()::text
UNION ALL
SELECT
  'Tables Created',
  COUNT(*)::text
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'pg_%'
UNION ALL
SELECT
  'Views Created',
  COUNT(*)::text
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'VIEW'
UNION ALL
SELECT
  'Functions Created',
  COUNT(*)::text
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace;


-- 1.2 List all tables by layer
SELECT
  CASE
    WHEN table_name LIKE 'raw_%' THEN '1. Raw Data Layer'
    WHEN table_name IN ('document_classifications', 'entity_extractions', 'shipment_link_candidates', 'structured_extractions') THEN '2. Intelligence Layer'
    WHEN table_name LIKE 'shipment%' THEN '3. Decision Support Layer'
    WHEN table_name IN ('customers', 'parties', 'vendors', 'stakeholder_communications', 'customer_intelligence', 'vendor_performance_log', 'contact_persons', 'customer_party_relationships') THEN '3. Stakeholder Intelligence'
    WHEN table_name LIKE '%config%' OR table_name LIKE '%rule%' THEN '4. Configuration Layer'
    ELSE '5. Other'
  END as layer,
  table_name,
  COALESCE(obj_description((table_schema||'.'||table_name)::regclass, 'pg_class'), 'No description') as description
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'pg_%'
ORDER BY layer, table_name;


-- ============================================================================
-- SECTION 2: EXPLORE CONFIGURATION
-- ============================================================================

-- 2.1 View document type configurations
SELECT
  document_type,
  display_name,
  document_category,
  array_length(email_subject_patterns, 1) as subject_patterns_count,
  array_length(content_keywords, 1) as keyword_count,
  min_confidence_auto_classify,
  processing_priority,
  enabled
FROM document_type_configs
ORDER BY processing_priority DESC, document_type;


-- 2.2 View carrier configurations
SELECT
  id as carrier_id,
  carrier_name,
  array_length(email_sender_patterns, 1) as sender_patterns,
  booking_number_regex,
  array_to_string(container_number_prefix, ', ') as container_prefixes,
  enabled
FROM carrier_configs
ORDER BY carrier_name;


-- 2.3 View linking rules
SELECT
  rule_name,
  rule_priority,
  array_to_string(matching_entity_types, ', ') as entity_types,
  match_strategy,
  base_confidence,
  confidence_boost_per_match,
  enabled
FROM linking_rules
ORDER BY rule_priority DESC;


-- 2.4 View AI model configurations
SELECT
  model_name,
  model_version,
  model_type,
  is_active,
  is_default,
  accuracy_rate,
  total_predictions
FROM ai_model_configs
ORDER BY is_default DESC, model_name;


-- ============================================================================
-- SECTION 3: STAKEHOLDER DATA
-- ============================================================================

-- 3.1 View customers
SELECT
  customer_code,
  customer_name,
  customer_type,
  customer_segment,
  industry,
  status,
  total_shipments,
  total_revenue,
  on_time_payment_rate
FROM customers
ORDER BY customer_code;


-- 3.2 View vendors by type
SELECT
  vendor_type,
  COUNT(*) as count,
  AVG(performance_rating) as avg_rating,
  SUM(total_transactions) as total_transactions
FROM vendors
GROUP BY vendor_type
ORDER BY vendor_type;


-- 3.3 View all vendors
SELECT
  vendor_code,
  vendor_name,
  vendor_type,
  vendor_category,
  performance_rating,
  status
FROM vendors
ORDER BY vendor_type, vendor_name;


-- 3.4 View customer 360 (comprehensive view)
SELECT
  customer_code,
  customer_name,
  total_shipments,
  shipments_last_30_days,
  active_shipments,
  total_communications,
  avg_response_time_hours,
  pending_invoices
FROM customer_360
ORDER BY total_shipments DESC;


-- 3.5 View vendor scorecard
SELECT
  vendor_code,
  vendor_name,
  vendor_type,
  performance_rating,
  on_time_delivery_rate,
  rating_last_90_days,
  delays_last_90_days,
  outstanding_amount
FROM vendor_scorecard
ORDER BY performance_rating DESC;


-- ============================================================================
-- SECTION 4: INSERT TEST DATA
-- ============================================================================

-- 4.1 Insert test customer
INSERT INTO customers (
  customer_code,
  customer_name,
  customer_type,
  customer_segment,
  industry,
  primary_contact_email,
  status
) VALUES (
  'TEST001',
  'Test Customer Pvt Ltd',
  'direct',
  'sme',
  'electronics',
  'contact@testcustomer.com',
  'active'
)
ON CONFLICT (customer_code) DO NOTHING
RETURNING customer_code, customer_name, 'Customer created successfully' as status;


-- 4.2 Insert test shipper
INSERT INTO parties (
  party_code,
  party_name,
  party_type,
  contact_email,
  city,
  country,
  status
) VALUES (
  'SHIP001',
  'Test Shipper Ltd',
  'shipper',
  'export@testshipper.com',
  'Mumbai',
  'India',
  'active'
)
ON CONFLICT (party_code) DO NOTHING
RETURNING party_code, party_name, party_type, 'Party created successfully' as status;


-- 4.3 Insert test consignee
INSERT INTO parties (
  party_code,
  party_name,
  party_type,
  contact_email,
  city,
  country,
  status
) VALUES (
  'CONS001',
  'Test Consignee Inc',
  'consignee',
  'import@testconsignee.com',
  'Los Angeles',
  'USA',
  'active'
)
ON CONFLICT (party_code) DO NOTHING
RETURNING party_code, party_name, party_type, 'Party created successfully' as status;


-- 4.4 Insert test email
INSERT INTO raw_emails (
  gmail_message_id,
  sender_email,
  sender_name,
  subject,
  body_text,
  received_at,
  has_attachments,
  processing_status
) VALUES (
  'test-msg-' || EXTRACT(EPOCH FROM NOW())::bigint,
  'booking@maersk.com',
  'Maersk Line Booking',
  'Booking Confirmation - MAEU1234567890',
  E'Dear Customer,\n\nYour booking has been confirmed.\n\nBooking Number: MAEU1234567890\nVessel: MAERSK ESSEX\nVoyage: 225W\nETD: 2025-02-15\nETA: 2025-03-20\nPort of Loading: INNSA (Nhava Sheva)\nPort of Discharge: USLAX (Los Angeles)\n\nBest regards,\nMaersk Line',
  NOW(),
  false,
  'pending'
)
RETURNING id, gmail_message_id, subject, 'Email created successfully' as status;


-- 4.5 Create test shipment
INSERT INTO shipments (
  shipment_number,
  booking_number,
  shipment_mode,
  shipment_type,
  service_type,
  status,
  carrier_id,
  carrier_name,
  etd,
  eta,
  port_of_loading_code,
  port_of_loading_name,
  port_of_discharge_code,
  port_of_discharge_name,
  lifecycle_stage
) VALUES (
  'SHP-TEST-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'),
  'MAEU1234567890',
  'sea',
  'FCL',
  'export',
  'booked',
  'maersk',
  'Maersk',
  '2025-02-15',
  '2025-03-20',
  'INNSA',
  'Nhava Sheva',
  'USLAX',
  'Los Angeles',
  'active'
)
RETURNING shipment_number, booking_number, status, 'Shipment created successfully' as status;


-- ============================================================================
-- SECTION 5: TEST QUERIES (After inserting test data)
-- ============================================================================

-- 5.1 View all test data
SELECT 'Test Customers' as data_type, COUNT(*)::text as count
FROM customers WHERE customer_code LIKE 'TEST%'
UNION ALL
SELECT 'Test Parties', COUNT(*)::text
FROM parties WHERE party_code LIKE 'SHIP%' OR party_code LIKE 'CONS%'
UNION ALL
SELECT 'Test Emails', COUNT(*)::text
FROM raw_emails WHERE gmail_message_id LIKE 'test-msg-%'
UNION ALL
SELECT 'Test Shipments', COUNT(*)::text
FROM shipments WHERE shipment_number LIKE 'SHP-TEST-%';


-- 5.2 View recent emails
SELECT
  id,
  gmail_message_id,
  sender_email,
  subject,
  received_at,
  processing_status
FROM raw_emails
ORDER BY received_at DESC
LIMIT 10;


-- 5.3 View active shipments
SELECT
  shipment_number,
  booking_number,
  carrier_name,
  status,
  etd,
  eta,
  port_of_loading_code || ' → ' || port_of_discharge_code as route
FROM shipments
WHERE lifecycle_stage = 'active'
ORDER BY etd DESC;


-- ============================================================================
-- SECTION 6: AI AGENT QUERIES
-- ============================================================================

-- 6.1 Find unprocessed emails (for classification agent)
SELECT
  id,
  gmail_message_id,
  sender_email,
  subject,
  received_at
FROM raw_emails
WHERE processing_status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM document_classifications dc WHERE dc.email_id = raw_emails.id
  )
ORDER BY received_at ASC
LIMIT 10;


-- 6.2 Find emails needing classification
SELECT
  re.id,
  re.subject,
  re.sender_email,
  re.received_at,
  dc.document_type,
  dc.confidence_score
FROM raw_emails re
LEFT JOIN document_classifications dc ON dc.email_id = re.id
WHERE re.processing_status = 'pending'
ORDER BY re.received_at DESC
LIMIT 10;


-- 6.3 Find documents needing manual review (low confidence)
SELECT
  re.subject,
  re.sender_email,
  dc.document_type,
  dc.confidence_score,
  dc.classification_reason
FROM raw_emails re
JOIN document_classifications dc ON dc.email_id = re.id
WHERE dc.confidence_score < 85
  OR dc.is_correct = false
ORDER BY dc.classified_at DESC;


-- 6.4 View shipment linking candidates
SELECT
  slc.id,
  re.subject as email_subject,
  s.shipment_number,
  slc.confidence_score,
  slc.link_status,
  slc.linking_reason
FROM shipment_link_candidates slc
JOIN raw_emails re ON re.id = slc.email_id
LEFT JOIN shipments s ON s.id = slc.shipment_id
WHERE slc.link_status = 'candidate'
ORDER BY slc.confidence_score DESC;


-- ============================================================================
-- SECTION 7: BUSINESS INTELLIGENCE QUERIES
-- ============================================================================

-- 7.1 Shipments by carrier (last 30 days)
SELECT
  carrier_name,
  COUNT(*) as total_shipments,
  COUNT(*) FILTER (WHERE status = 'in_transit') as in_transit,
  COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
  AVG(EXTRACT(DAY FROM (ata - atd))) as avg_transit_days
FROM shipments
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY carrier_name
ORDER BY total_shipments DESC;


-- 7.2 Top customers by revenue
SELECT
  c.customer_code,
  c.customer_name,
  c.total_shipments,
  c.total_revenue,
  c.average_shipment_value,
  c.on_time_payment_rate
FROM customers c
WHERE c.status = 'active'
ORDER BY c.total_revenue DESC
LIMIT 10;


-- 7.3 Vendor performance summary
SELECT
  v.vendor_name,
  v.vendor_type,
  v.performance_rating,
  v.on_time_delivery_rate,
  v.total_transactions,
  v.total_amount_paid
FROM vendors v
WHERE v.status = 'active'
ORDER BY v.performance_rating DESC;


-- 7.4 Communication sentiment analysis
SELECT
  sentiment,
  COUNT(*) as total,
  AVG(response_time_hours) as avg_response_time,
  COUNT(*) FILTER (WHERE requires_response = true) as needs_response
FROM stakeholder_communications
WHERE communication_timestamp > NOW() - INTERVAL '30 days'
GROUP BY sentiment
ORDER BY
  CASE sentiment
    WHEN 'critical' THEN 1
    WHEN 'negative' THEN 2
    WHEN 'neutral' THEN 3
    WHEN 'positive' THEN 4
  END;


-- ============================================================================
-- SECTION 8: AI FUNCTIONS TESTING
-- ============================================================================

-- 8.1 Test update customer metrics function
-- (Run after creating shipments for a customer)
-- SELECT update_customer_metrics(id) FROM customers WHERE customer_code = 'TEST001';


-- 8.2 Test vendor performance calculation
-- (Run after creating vendor performance logs)
-- SELECT calculate_vendor_performance(id) FROM vendors WHERE vendor_code = 'VEN-MAERSK';


-- 8.3 Test customer preference detection
-- (Run after customer has multiple shipments)
-- SELECT detect_customer_preferences(id) FROM customers WHERE total_shipments > 3;


-- 8.4 Test link confidence calculation
-- SELECT calculate_link_confidence(
--   '{"booking_number": "MAEU123", "container_number": "ABCD1234567"}'::jsonb,
--   'shipment-uuid',
--   NOW()
-- );


-- ============================================================================
-- SECTION 9: CLEANUP TEST DATA (Optional)
-- ============================================================================

-- WARNING: Only run this if you want to delete test data!

-- DELETE FROM customers WHERE customer_code LIKE 'TEST%';
-- DELETE FROM parties WHERE party_code LIKE 'SHIP%' OR party_code LIKE 'CONS%';
-- DELETE FROM raw_emails WHERE gmail_message_id LIKE 'test-msg-%';
-- DELETE FROM shipments WHERE shipment_number LIKE 'SHP-TEST-%';


-- ============================================================================
-- SECTION 10: USEFUL ADMIN QUERIES
-- ============================================================================

-- 10.1 Database size
SELECT
  pg_size_pretty(pg_database_size(current_database())) as database_size;


-- 10.2 Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY size_bytes DESC
LIMIT 20;


-- 10.3 Index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC
LIMIT 20;


-- 10.4 Check for missing indexes (slow queries)
SELECT
  schemaname,
  tablename,
  seq_scan,
  seq_tup_read,
  idx_scan,
  seq_tup_read / seq_scan as avg_rows_per_scan
FROM pg_stat_user_tables
WHERE seq_scan > 0
  AND schemaname = 'public'
ORDER BY seq_tup_read DESC
LIMIT 10;


-- ============================================================================
-- COMPLETION
-- ============================================================================

SELECT
  '✅ Quick Start Queries Complete!' as status,
  'Ready to build AI agents and dashboards' as next_step,
  'See FREIGHT-INTELLIGENCE-README.md for full documentation' as documentation;
