-- ============================================================================
-- DATA QUALITY DIAGNOSTIC QUERIES
-- Run these in your SQL editor to understand the pipeline health
-- ============================================================================

-- ============================================================================
-- LAYER 1: RAW EMAILS
-- ============================================================================

-- 1.1 Total emails count
SELECT
  'raw_emails' as table_name,
  COUNT(*) as total_count
FROM raw_emails;

-- 1.2 Emails by processing status (if column exists)
SELECT
  COALESCE(processing_status, 'no_status') as status,
  COUNT(*) as count
FROM raw_emails
GROUP BY processing_status
ORDER BY count DESC;

-- ============================================================================
-- LAYER 2: CLASSIFICATIONS
-- ============================================================================

-- 2.1 Classification coverage
SELECT
  (SELECT COUNT(*) FROM raw_emails) as total_emails,
  (SELECT COUNT(*) FROM document_classifications) as classified_emails,
  (SELECT COUNT(*) FROM raw_emails) - (SELECT COUNT(*) FROM document_classifications) as unclassified_emails;

-- 2.2 Document type distribution (THIS IS KEY!)
SELECT
  COALESCE(document_type, 'NULL/MISSING') as document_type,
  COUNT(*) as count,
  ROUND(AVG(confidence_score), 1) as avg_confidence
FROM document_classifications
GROUP BY document_type
ORDER BY count DESC;

-- 2.3 Classifications with NULL document_type (PROBLEM!)
SELECT
  dc.id,
  re.subject,
  re.sender_email,
  dc.confidence_score,
  dc.classification_reason
FROM document_classifications dc
JOIN raw_emails re ON re.id = dc.email_id
WHERE dc.document_type IS NULL
LIMIT 20;

-- ============================================================================
-- LAYER 2: ENTITY EXTRACTIONS
-- ============================================================================

-- 3.1 Entity extraction coverage
SELECT
  entity_type,
  COUNT(*) as count,
  ROUND(AVG(confidence_score), 1) as avg_confidence
FROM entity_extractions
GROUP BY entity_type
ORDER BY count DESC;

-- 3.2 Emails with booking numbers extracted
SELECT COUNT(DISTINCT email_id) as emails_with_booking_number
FROM entity_extractions
WHERE entity_type = 'booking_number';

-- 3.3 Emails with dates extracted
SELECT
  entity_type,
  COUNT(DISTINCT email_id) as emails_with_dates
FROM entity_extractions
WHERE entity_type IN ('etd', 'eta', 'atd', 'ata')
GROUP BY entity_type;

-- ============================================================================
-- LAYER 3: SHIPMENTS
-- ============================================================================

-- 4.1 Shipment status distribution (THE PROBLEM!)
SELECT
  status,
  COUNT(*) as count
FROM shipments
GROUP BY status
ORDER BY
  CASE status
    WHEN 'draft' THEN 1
    WHEN 'booked' THEN 2
    WHEN 'in_transit' THEN 3
    WHEN 'arrived' THEN 4
    WHEN 'delivered' THEN 5
    ELSE 6
  END;

-- 4.2 Shipments with dates populated
SELECT
  COUNT(*) as total_shipments,
  COUNT(etd) as with_etd,
  COUNT(eta) as with_eta,
  COUNT(CASE WHEN etd IS NOT NULL AND eta IS NOT NULL THEN 1 END) as with_both_dates,
  COUNT(CASE WHEN etd IS NULL AND eta IS NULL THEN 1 END) as no_dates
FROM shipments;

-- 4.3 Draft shipments analysis
SELECT
  s.id,
  s.booking_number,
  s.bl_number,
  s.etd,
  s.eta,
  s.created_at,
  (SELECT COUNT(*) FROM shipment_documents sd WHERE sd.shipment_id = s.id) as linked_docs
FROM shipments s
WHERE s.status = 'draft'
ORDER BY s.created_at DESC
LIMIT 20;

-- ============================================================================
-- LAYER 3: EMAIL-TO-SHIPMENT LINKING (CRITICAL!)
-- ============================================================================

-- 5.1 Shipment documents count (links between emails and shipments)
SELECT
  'shipment_documents' as table_name,
  COUNT(*) as total_links
FROM shipment_documents;

-- 5.2 Shipments with vs without linked documents
SELECT
  CASE WHEN doc_count > 0 THEN 'has_documents' ELSE 'no_documents' END as link_status,
  COUNT(*) as shipment_count
FROM (
  SELECT s.id, COUNT(sd.id) as doc_count
  FROM shipments s
  LEFT JOIN shipment_documents sd ON sd.shipment_id = s.id
  GROUP BY s.id
) sub
GROUP BY link_status;

-- 5.3 Document types linked to shipments
SELECT
  sd.document_type,
  COUNT(*) as count
FROM shipment_documents sd
GROUP BY sd.document_type
ORDER BY count DESC;

-- 5.4 Link candidates (pending review)
SELECT
  is_confirmed,
  is_rejected,
  COUNT(*) as count
FROM shipment_link_candidates
GROUP BY is_confirmed, is_rejected;

-- ============================================================================
-- PIPELINE HEALTH SUMMARY (RUN THIS FIRST!)
-- ============================================================================

SELECT
  'Pipeline Health Summary' as report,
  (SELECT COUNT(*) FROM raw_emails) as "1_total_emails",
  (SELECT COUNT(*) FROM document_classifications) as "2_classified",
  (SELECT COUNT(*) FROM document_classifications WHERE document_type IS NOT NULL) as "2b_with_doc_type",
  (SELECT COUNT(DISTINCT email_id) FROM entity_extractions) as "3_with_entities",
  (SELECT COUNT(DISTINCT email_id) FROM entity_extractions WHERE entity_type = 'booking_number') as "3b_with_booking_num",
  (SELECT COUNT(*) FROM shipments) as "4_shipments",
  (SELECT COUNT(*) FROM shipments WHERE status = 'draft') as "4b_draft_shipments",
  (SELECT COUNT(*) FROM shipment_documents) as "5_email_shipment_links",
  (SELECT COUNT(DISTINCT shipment_id) FROM shipment_documents) as "5b_shipments_with_docs";

-- ============================================================================
-- ROOT CAUSE ANALYSIS
-- ============================================================================

-- 6.1 Shipments in draft with linked documents (should have status!)
SELECT
  s.id,
  s.booking_number,
  s.status,
  sd.document_type as linked_doc_type,
  dc.document_type as classification_doc_type,
  s.etd,
  s.eta
FROM shipments s
JOIN shipment_documents sd ON sd.shipment_id = s.id
LEFT JOIN document_classifications dc ON dc.email_id = sd.email_id
WHERE s.status = 'draft'
LIMIT 20;

-- 6.2 Classification document_type vs shipment_documents document_type mismatch
SELECT
  sd.document_type as shipment_doc_type,
  dc.document_type as classification_doc_type,
  COUNT(*) as count
FROM shipment_documents sd
LEFT JOIN document_classifications dc ON dc.email_id = sd.email_id
GROUP BY sd.document_type, dc.document_type
ORDER BY count DESC;

-- 6.3 Emails that have entities but no shipment link
SELECT
  re.id,
  re.subject,
  ee.entity_value as booking_number,
  dc.document_type
FROM raw_emails re
JOIN entity_extractions ee ON ee.email_id = re.id AND ee.entity_type = 'booking_number'
LEFT JOIN document_classifications dc ON dc.email_id = re.id
LEFT JOIN shipment_documents sd ON sd.email_id = re.id
WHERE sd.id IS NULL
LIMIT 20;
