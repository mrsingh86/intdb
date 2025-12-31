-- ============================================================================
-- RECLASSIFY EMAILS - SQL SCRIPT
-- ============================================================================
-- Run this script directly in Supabase SQL Editor
-- Shows current classification distribution and sample data
-- ============================================================================

-- 1. Current classification distribution
SELECT
    'CURRENT CLASSIFICATION DISTRIBUTION' as status,
    document_type,
    COUNT(*) as count,
    ROUND(AVG(confidence_score), 2) as avg_confidence
FROM document_classifications
GROUP BY document_type
ORDER BY count DESC;

-- 2. Show classifications that might need review (low confidence)
SELECT
    'LOW CONFIDENCE CLASSIFICATIONS (< 70%)' as status,
    dc.id as classification_id,
    re.subject,
    re.sender_email,
    dc.document_type,
    dc.confidence_score,
    dc.classification_reason
FROM document_classifications dc
JOIN raw_emails re ON re.id = dc.email_id
WHERE dc.confidence_score < 70
ORDER BY dc.confidence_score ASC
LIMIT 20;

-- 3. Sample of each document type
WITH ranked_classifications AS (
    SELECT
        dc.id,
        dc.document_type,
        dc.email_id,
        dc.confidence_score,
        ROW_NUMBER() OVER (PARTITION BY dc.document_type ORDER BY dc.classified_at) as rn
    FROM document_classifications dc
)
SELECT
    'SAMPLE EMAILS PER TYPE' as status,
    rc.document_type,
    re.subject,
    re.sender_email,
    rc.confidence_score
FROM ranked_classifications rc
JOIN raw_emails re ON re.id = rc.email_id
WHERE rc.rn = 1
ORDER BY rc.document_type;

-- 4. Entity extraction summary
SELECT
    'ENTITY EXTRACTION SUMMARY' as status,
    entity_type,
    COUNT(*) as count,
    COUNT(DISTINCT email_id) as emails_with_entity
FROM entity_extractions
GROUP BY entity_type
ORDER BY count DESC;

-- 5. Emails without entities
SELECT
    'EMAILS WITHOUT ENTITIES' as status,
    re.id,
    re.subject,
    re.sender_email,
    dc.document_type
FROM raw_emails re
JOIN document_classifications dc ON dc.email_id = re.id
LEFT JOIN entity_extractions ee ON ee.email_id = re.id
WHERE ee.id IS NULL
ORDER BY re.received_at DESC
LIMIT 10;

-- ============================================================================
-- To manually reclassify a specific email, use:
-- ============================================================================
-- UPDATE document_classifications
-- SET
--     document_type = 'correct_type_here',
--     confidence_score = 95,
--     classification_reason = 'Manual correction',
--     is_manual_review = TRUE,
--     reviewed_by = 'user_name',
--     reviewed_at = NOW()
-- WHERE email_id = 'email_id_here';
-- ============================================================================
