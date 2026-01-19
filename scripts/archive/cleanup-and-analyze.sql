-- ============================================================================
-- DATA CLEANUP AND ANALYSIS
-- ============================================================================

-- 1. Find duplicate classifications (multiple classifications per email)
SELECT
    'DUPLICATE CLASSIFICATIONS' as issue,
    email_id,
    COUNT(*) as classification_count,
    STRING_AGG(DISTINCT document_type, ', ') as all_types
FROM document_classifications
GROUP BY email_id
HAVING COUNT(*) > 1
ORDER BY classification_count DESC;

-- 2. Count bad emails (Failed to fetch)
SELECT
    'BAD EMAILS COUNT' as issue,
    COUNT(*) as count
FROM raw_emails
WHERE subject = 'Failed to fetch' OR sender_email = 'unknown';

-- 3. Show all bad emails
SELECT
    'BAD EMAILS DETAIL' as issue,
    id,
    subject,
    sender_email,
    received_at,
    body_text
FROM raw_emails
WHERE subject = 'Failed to fetch' OR sender_email = 'unknown'
ORDER BY received_at DESC;

-- 4. Classification distribution (excluding bad data)
SELECT
    'GOOD CLASSIFICATIONS' as status,
    dc.document_type,
    COUNT(*) as count,
    ROUND(AVG(dc.confidence_score), 2) as avg_confidence
FROM document_classifications dc
JOIN raw_emails re ON re.id = dc.email_id
WHERE re.subject != 'Failed to fetch' AND re.sender_email != 'unknown'
GROUP BY dc.document_type
ORDER BY count DESC;

-- 5. Emails with entities (excluding bad data)
SELECT
    'EMAILS WITH ENTITIES' as status,
    COUNT(DISTINCT ee.email_id) as emails_with_entities,
    COUNT(*) as total_entities
FROM entity_extractions ee
JOIN raw_emails re ON re.id = ee.email_id
WHERE re.subject != 'Failed to fetch' AND re.sender_email != 'unknown';

-- 6. Good emails without entities
SELECT
    'GOOD EMAILS WITHOUT ENTITIES' as status,
    re.id,
    re.subject,
    re.sender_email,
    dc.document_type,
    dc.confidence_score
FROM raw_emails re
LEFT JOIN document_classifications dc ON dc.email_id = re.id
LEFT JOIN entity_extractions ee ON ee.email_id = re.id
WHERE re.subject != 'Failed to fetch'
  AND re.sender_email != 'unknown'
  AND ee.id IS NULL
ORDER BY re.received_at DESC;

-- ============================================================================
-- CLEANUP OPERATIONS (Run these separately after reviewing above)
-- ============================================================================

-- DELETE BAD EMAILS (Uncomment to run)
-- DELETE FROM raw_emails WHERE subject = 'Failed to fetch' OR sender_email = 'unknown';

-- DELETE DUPLICATE CLASSIFICATIONS (Keep only the latest one per email)
-- DELETE FROM document_classifications
-- WHERE id NOT IN (
--     SELECT DISTINCT ON (email_id) id
--     FROM document_classifications
--     ORDER BY email_id, classified_at DESC
-- );
