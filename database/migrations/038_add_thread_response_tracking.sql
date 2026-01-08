-- Migration 038: Add Thread Response Tracking
-- Purpose: Track RE:/FW: emails to prevent duplicate document classification
-- Date: 2025-01-07

-- ============================================================================
-- PART 1: Add is_response and related columns to raw_emails
-- ============================================================================

ALTER TABLE raw_emails
ADD COLUMN IF NOT EXISTS is_response BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS in_reply_to_message_id TEXT,
ADD COLUMN IF NOT EXISTS clean_subject TEXT;

-- Add index for quick filtering
CREATE INDEX IF NOT EXISTS idx_raw_emails_is_response ON raw_emails(is_response);

-- Add comments
COMMENT ON COLUMN raw_emails.is_response IS 'True if subject starts with RE:/FW:/Fwd: or has In-Reply-To header';
COMMENT ON COLUMN raw_emails.in_reply_to_message_id IS 'Value of In-Reply-To header for threading';
COMMENT ON COLUMN raw_emails.clean_subject IS 'Subject with RE:/FW:/Fwd: prefixes removed';

-- ============================================================================
-- PART 2: Backfill existing emails
-- ============================================================================

-- Set is_response for existing emails based on subject pattern
UPDATE raw_emails
SET
  is_response = true,
  clean_subject = REGEXP_REPLACE(subject, '^(RE|Re|FW|Fw|Fwd|FWD):\s*', '', 'gi')
WHERE subject ~* '^(RE|FW|Fwd):\s*'
  AND is_response IS NOT true;

-- Set clean_subject for non-response emails
UPDATE raw_emails
SET clean_subject = subject
WHERE is_response = false OR is_response IS NULL;

-- ============================================================================
-- PART 3: Add thread_first_doc_type to track first document type per thread
-- ============================================================================

-- This helps prevent classifying RE: emails as new documents when thread already has that type
ALTER TABLE email_thread_metadata
ADD COLUMN IF NOT EXISTS first_document_types TEXT[],
ADD COLUMN IF NOT EXISTS first_email_received_at TIMESTAMP;

COMMENT ON COLUMN email_thread_metadata.first_document_types IS 'Array of document types from first email in thread';
COMMENT ON COLUMN email_thread_metadata.first_email_received_at IS 'Timestamp of first email in thread';

-- ============================================================================
-- PART 4: Log migration completion
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 038 completed successfully';
  RAISE NOTICE 'Added: is_response, in_reply_to_message_id, clean_subject to raw_emails';
  RAISE NOTICE 'Backfilled is_response for existing RE:/FW: emails';
END $$;
