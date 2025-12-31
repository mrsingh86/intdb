-- ============================================================================
-- EMAIL EXTRACTION COVERAGE - SQL INVESTIGATION QUERIES
-- ============================================================================
-- Database: intdb (Supabase)
-- Purpose: Investigate why only 171/1,994 (8.6%) emails have entity extractions
-- ============================================================================

-- QUERY 1: Processing Status Breakdown
-- Shows: How many emails in each processing status
SELECT 
  processing_status,
  COUNT(*) as email_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM raw_emails
GROUP BY processing_status
ORDER BY email_count DESC;

-- Expected Result:
-- classified: 969 (96.9%) ← PROBLEM: Not being extracted
-- processed:   30 ( 3.0%) ← Only these get extracted
-- pending:      1 ( 0.1%)


-- QUERY 2: Extraction Coverage by Status
-- Shows: Which processing_status values have extractions
SELECT 
  e.processing_status,
  COUNT(DISTINCT e.id) as total_emails,
  COUNT(DISTINCT ex.email_id) as emails_with_extractions,
  ROUND(COUNT(DISTINCT ex.email_id) * 100.0 / COUNT(DISTINCT e.id), 2) as extraction_coverage_pct
FROM raw_emails e
LEFT JOIN entity_extractions ex ON ex.email_id = e.id
GROUP BY e.processing_status
ORDER BY total_emails DESC;


-- QUERY 3: Emails Ready for Extraction (Classification Pipeline Gap)
-- Shows: Emails that are classified but have NO extractions
SELECT COUNT(*) as emails_ready_for_extraction
FROM raw_emails
WHERE processing_status = 'classified'
  AND id NOT IN (SELECT DISTINCT email_id FROM entity_extractions WHERE email_id IS NOT NULL);

-- Expected Result: ~882 emails
-- ACTION: These should be extracted!


-- QUERY 4: Attachment Statistics for Unextracted Emails
-- Shows: How many unextracted emails have attachments (PDF opportunity)
SELECT 
  has_attachments,
  COUNT(*) as email_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM raw_emails
WHERE processing_status = 'classified'
  AND id NOT IN (SELECT DISTINCT email_id FROM entity_extractions WHERE email_id IS NOT NULL)
GROUP BY has_attachments
ORDER BY has_attachments DESC;

-- Expected Result:
-- true:  ~699 emails (78.9%) ← PDF extraction opportunity
-- false: ~187 emails (21.1%)


-- QUERY 5: Top Senders of Unextracted Emails
-- Shows: Which email senders have the most unextracted emails
SELECT 
  sender_email,
  COUNT(*) as unextracted_count,
  (SELECT COUNT(*) FROM raw_emails WHERE sender_email = e.sender_email) as total_count,
  ROUND(
    (SELECT COUNT(*) FROM raw_emails r 
     JOIN entity_extractions ex ON ex.email_id = r.id 
     WHERE r.sender_email = e.sender_email) * 100.0 / 
    (SELECT COUNT(*) FROM raw_emails WHERE sender_email = e.sender_email), 
    2
  ) as current_coverage_pct
FROM raw_emails e
WHERE processing_status = 'classified'
  AND id NOT IN (SELECT DISTINCT email_id FROM entity_extractions WHERE email_id IS NOT NULL)
GROUP BY sender_email
HAVING COUNT(*) >= 10
ORDER BY unextracted_count DESC
LIMIT 20;

-- Expected Top Results:
-- ops@intoglo.com: 222 unextracted (likely forwarded emails)
-- nam@intoglo.com: 62 unextracted
-- pricing@intoglo.com: 45 unextracted


-- QUERY 6: Entity Extraction Summary
-- Shows: What entities are being extracted successfully
SELECT 
  entity_type,
  COUNT(*) as extraction_count,
  COUNT(DISTINCT email_id) as unique_emails,
  ROUND(AVG(confidence_score), 2) as avg_confidence
FROM entity_extractions
GROUP BY entity_type
ORDER BY extraction_count DESC;


-- QUERY 7: Extraction Methods Used
-- Shows: Which extraction methods are working
SELECT 
  extraction_method,
  COUNT(*) as extraction_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage
FROM entity_extractions
GROUP BY extraction_method
ORDER BY extraction_count DESC;


-- QUERY 8: Case-Sensitive Sender Issue (Hapag Lloyd Example)
-- Shows: How case sensitivity affects extraction coverage
SELECT 
  sender_email,
  COUNT(DISTINCT e.id) as total_emails,
  COUNT(DISTINCT ex.email_id) as extracted_emails,
  ROUND(COUNT(DISTINCT ex.email_id) * 100.0 / COUNT(DISTINCT e.id), 2) as coverage_pct
FROM raw_emails e
LEFT JOIN entity_extractions ex ON ex.email_id = e.id
WHERE LOWER(sender_email) LIKE '%hlag.com%'
GROUP BY sender_email
ORDER BY sender_email;

-- Expected Issue:
-- India@service.hlag.com: 55.9% coverage ← Capital I
-- india@service.hlag.com:  6.9% coverage ← Lowercase i
-- ACTION: Normalize to lowercase!


-- QUERY 9: Sample Unextracted Emails with Attachments
-- Shows: Actual emails that should be extracted from PDFs
SELECT 
  e.id,
  e.subject,
  e.sender_email,
  e.has_attachments,
  e.attachment_count,
  e.processing_status,
  e.received_at
FROM raw_emails e
WHERE e.has_attachments = true
  AND e.processing_status = 'classified'
  AND e.id NOT IN (SELECT DISTINCT email_id FROM entity_extractions WHERE email_id IS NOT NULL)
ORDER BY e.received_at DESC
LIMIT 20;


-- QUERY 10: Backfill Candidate Count by Document Classification
-- Shows: How many emails of each type need extraction
SELECT 
  c.document_type,
  COUNT(*) as unextracted_count
FROM raw_emails e
LEFT JOIN document_classifications c ON c.email_id = e.id
WHERE e.processing_status = 'classified'
  AND e.id NOT IN (SELECT DISTINCT email_id FROM entity_extractions WHERE email_id IS NOT NULL)
GROUP BY c.document_type
ORDER BY unextracted_count DESC;


-- QUERY 11: Forwarded Email Analysis (ops@intoglo.com)
-- Shows: Whether forwarded emails have original sender extracted
SELECT 
  sender_email,
  true_sender_email,
  COUNT(*) as email_count,
  CASE 
    WHEN true_sender_email IS NULL THEN 'Missing true_sender'
    WHEN true_sender_email = sender_email THEN 'Not forwarded'
    ELSE 'Forwarded (has true_sender)'
  END as forwarding_status
FROM raw_emails
WHERE sender_email = 'ops@intoglo.com'
GROUP BY sender_email, true_sender_email, 
         CASE 
           WHEN true_sender_email IS NULL THEN 'Missing true_sender'
           WHEN true_sender_email = sender_email THEN 'Not forwarded'
           ELSE 'Forwarded (has true_sender)'
         END
ORDER BY email_count DESC;


-- QUERY 12: Overall Extraction Coverage Summary
-- Shows: High-level metrics for dashboard
SELECT 
  (SELECT COUNT(*) FROM raw_emails) as total_emails,
  (SELECT COUNT(DISTINCT email_id) FROM entity_extractions) as emails_with_extractions,
  (SELECT COUNT(*) FROM entity_extractions) as total_extractions,
  (SELECT COUNT(*) FROM shipments) as total_shipments,
  ROUND(
    (SELECT COUNT(DISTINCT email_id) FROM entity_extractions) * 100.0 / 
    (SELECT COUNT(*) FROM raw_emails), 
    2
  ) as extraction_coverage_pct,
  ROUND(
    (SELECT COUNT(*) FROM entity_extractions) * 1.0 / 
    (SELECT COUNT(DISTINCT email_id) FROM entity_extractions), 
    2
  ) as avg_entities_per_email;


-- ============================================================================
-- RECOMMENDED FIXES (SQL)
-- ============================================================================

-- FIX 1: Normalize sender emails to lowercase (case-sensitivity issue)
-- WARNING: Test on a backup first!
-- UPDATE raw_emails 
-- SET sender_email = LOWER(sender_email),
--     true_sender_email = LOWER(true_sender_email)
-- WHERE sender_email != LOWER(sender_email) 
--    OR true_sender_email != LOWER(true_sender_email);


-- FIX 2: Find emails that should be re-classified after sender normalization
-- SELECT id, sender_email, true_sender_email
-- FROM raw_emails
-- WHERE sender_email != LOWER(sender_email)
-- ORDER BY received_at DESC;


-- ============================================================================
-- MONITORING QUERIES (Run Daily)
-- ============================================================================

-- Daily Extraction Progress
SELECT 
  DATE(created_at) as extraction_date,
  COUNT(DISTINCT email_id) as emails_processed,
  COUNT(*) as entities_extracted,
  COUNT(DISTINCT entity_type) as unique_entity_types
FROM entity_extractions
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY DATE(created_at)
ORDER BY extraction_date DESC;


-- Current Backlog
SELECT 
  processing_status,
  COUNT(*) as emails_pending_extraction
FROM raw_emails
WHERE id NOT IN (SELECT DISTINCT email_id FROM entity_extractions WHERE email_id IS NOT NULL)
GROUP BY processing_status;


-- ============================================================================
-- END OF QUERIES
-- ============================================================================
