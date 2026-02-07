-- Migration 078: Reclassify documents with no extractable content
--
-- Three gaps found in cross-verification audit:
-- 1. Maersk "template-only" arrival notices: body = generic template, no attachment, no dates
-- 2. CMA CGM portal-only arrival notices: just "check our portal" links, no attachment
-- 3. COSCO empty arrival notices: no body (HTML-only, now fixed in code), no attachment
-- Also: fix CMA CGM detection pattern to require attachment for arrival_notice

BEGIN;

-- 1. Maersk template-only arrival notices → request
-- These are forwarded emails saying "please find attached" but the attachment was stripped
UPDATE chronicle
SET document_type = 'request'
WHERE document_type = 'arrival_notice'
  AND carrier_name = 'Maersk'
  AND (attachments IS NULL OR attachments::text = '[]')
  AND LOWER(body_preview) LIKE '%please find%attached%arrival%'
  AND eta IS NULL;

-- 2. CMA CGM portal-only arrival notices → notification
-- These are "check our portal" emails with no actual AN data
UPDATE chronicle
SET document_type = 'notification'
WHERE document_type = 'arrival_notice'
  AND carrier_name = 'CMA CGM'
  AND (attachments IS NULL OR attachments::text = '[]')
  AND eta IS NULL;

-- 3. COSCO empty arrival notices → notification
-- These had empty body (HTML-only, now fixed in code) and no attachment
UPDATE chronicle
SET document_type = 'notification'
WHERE document_type = 'arrival_notice'
  AND carrier_name = 'COSCO'
  AND (attachments IS NULL OR attachments::text = '[]')
  AND eta IS NULL;

-- 4. Fix CMA CGM arrival_notice detection pattern to require attachment
-- Without attachment, email falls through to AI which correctly classifies as notification
UPDATE detection_patterns
SET requires_attachment = true
WHERE carrier_id = 'cma-cgm'
  AND document_type = 'arrival_notice'
  AND pattern LIKE '%Arrival notice available%';

COMMIT;
