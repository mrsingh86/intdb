-- Migration 002: Add Thread Handling and Revision Tracking
-- Purpose: Enable thread-aware processing, duplicate detection, and revision tracking
-- Date: 2025-12-24

-- ============================================================================
-- PART 1: Enhance raw_emails table
-- ============================================================================

-- Add revision tracking fields
ALTER TABLE raw_emails
ADD COLUMN IF NOT EXISTS revision_type VARCHAR(20),
ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS duplicate_of_email_id UUID REFERENCES raw_emails(id),
ADD COLUMN IF NOT EXISTS thread_position INTEGER,
ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_raw_emails_thread_id ON raw_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_raw_emails_is_duplicate ON raw_emails(is_duplicate);
CREATE INDEX IF NOT EXISTS idx_raw_emails_content_hash ON raw_emails(content_hash);
CREATE INDEX IF NOT EXISTS idx_raw_emails_revision_type ON raw_emails(revision_type);

-- Add comments
COMMENT ON COLUMN raw_emails.revision_type IS 'Type of revision: original, 1st_update, 2nd_update, 3rd_update, amendment, cancellation';
COMMENT ON COLUMN raw_emails.is_duplicate IS 'True if this email is a duplicate of another in the same thread';
COMMENT ON COLUMN raw_emails.duplicate_of_email_id IS 'References the original email if this is a duplicate';
COMMENT ON COLUMN raw_emails.thread_position IS 'Position in thread conversation (1, 2, 3, 4...)';
COMMENT ON COLUMN raw_emails.content_hash IS 'SHA256 hash of body_text for duplicate detection';

-- ============================================================================
-- PART 2: Create email_thread_metadata table
-- ============================================================================

CREATE TABLE IF NOT EXISTS email_thread_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id VARCHAR(200) UNIQUE NOT NULL,
  first_email_id UUID REFERENCES raw_emails(id),
  latest_email_id UUID REFERENCES raw_emails(id),
  email_count INTEGER DEFAULT 0,
  unique_email_count INTEGER DEFAULT 0,
  duplicate_count INTEGER DEFAULT 0,
  thread_subject VARCHAR(500),
  thread_type VARCHAR(50),
  primary_booking_number VARCHAR(50),
  primary_bl_number VARCHAR(50),
  primary_vessel_name VARCHAR(200),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_thread_metadata_thread_id ON email_thread_metadata(thread_id);
CREATE INDEX IF NOT EXISTS idx_thread_metadata_booking_number ON email_thread_metadata(primary_booking_number);
CREATE INDEX IF NOT EXISTS idx_thread_metadata_bl_number ON email_thread_metadata(primary_bl_number);

-- Add comments
COMMENT ON TABLE email_thread_metadata IS 'Metadata for email threads - tracks thread-level information';
COMMENT ON COLUMN email_thread_metadata.thread_type IS 'Type: booking_sequence, amendment_sequence, invoice_sequence, misc';
COMMENT ON COLUMN email_thread_metadata.unique_email_count IS 'Count of unique emails (excluding duplicates)';
COMMENT ON COLUMN email_thread_metadata.duplicate_count IS 'Count of duplicate emails in thread';

-- ============================================================================
-- PART 3: Create booking_revisions table
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number VARCHAR(50) NOT NULL,
  revision_number INTEGER NOT NULL,
  revision_type VARCHAR(20),
  source_email_id UUID REFERENCES raw_emails(id),
  changed_fields JSONB,

  -- Snapshot of key fields at this revision
  vessel_name VARCHAR(200),
  voyage_number VARCHAR(50),
  etd DATE,
  eta DATE,
  port_of_loading VARCHAR(100),
  port_of_discharge VARCHAR(100),
  container_type VARCHAR(50),
  shipper_name VARCHAR(200),
  consignee_name VARCHAR(200),

  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_booking_revision UNIQUE(booking_number, revision_number)
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_booking_revisions_booking_number ON booking_revisions(booking_number);
CREATE INDEX IF NOT EXISTS idx_booking_revisions_source_email ON booking_revisions(source_email_id);
CREATE INDEX IF NOT EXISTS idx_booking_revisions_revision_type ON booking_revisions(revision_type);

-- Add comments
COMMENT ON TABLE booking_revisions IS 'Tracks booking changes across email updates (ORIGINAL → 1ST UPDATE → 2ND UPDATE)';
COMMENT ON COLUMN booking_revisions.revision_number IS '0=original, 1=1st update, 2=2nd update, etc.';
COMMENT ON COLUMN booking_revisions.changed_fields IS 'JSON object tracking what changed: {"etd": {"old": "2025-01-01", "new": "2025-01-05"}}';

-- ============================================================================
-- PART 4: Create helper views
-- ============================================================================

-- View: Thread summary with email counts
CREATE OR REPLACE VIEW v_thread_summary AS
SELECT
  t.thread_id,
  t.thread_subject,
  t.email_count,
  t.unique_email_count,
  t.duplicate_count,
  t.primary_booking_number,
  t.primary_bl_number,
  COUNT(DISTINCT dc.document_type) as document_types_count,
  COUNT(DISTINCT ee.entity_type) as entity_types_count,
  MIN(e.received_at) as first_email_at,
  MAX(e.received_at) as latest_email_at
FROM email_thread_metadata t
LEFT JOIN raw_emails e ON e.thread_id = t.thread_id
LEFT JOIN document_classifications dc ON dc.email_id = e.id
LEFT JOIN entity_extractions ee ON ee.email_id = e.id
GROUP BY t.thread_id, t.thread_subject, t.email_count, t.unique_email_count,
         t.duplicate_count, t.primary_booking_number, t.primary_bl_number;

-- View: Booking revision history
CREATE OR REPLACE VIEW v_booking_revision_history AS
SELECT
  br.booking_number,
  br.revision_number,
  br.revision_type,
  br.vessel_name,
  br.voyage_number,
  br.etd,
  br.eta,
  br.port_of_loading,
  br.port_of_discharge,
  br.changed_fields,
  e.subject as source_email_subject,
  e.received_at as revision_received_at,
  br.created_at
FROM booking_revisions br
LEFT JOIN raw_emails e ON e.id = br.source_email_id
ORDER BY br.booking_number, br.revision_number;

COMMENT ON VIEW v_booking_revision_history IS 'Shows booking change history with what changed at each revision';

-- ============================================================================
-- PART 5: Migration complete
-- ============================================================================

-- Log migration completion
DO $$
BEGIN
  RAISE NOTICE 'Migration 002 completed successfully';
  RAISE NOTICE 'Added: revision_type, is_duplicate, duplicate_of_email_id, thread_position, content_hash to raw_emails';
  RAISE NOTICE 'Created: email_thread_metadata table';
  RAISE NOTICE 'Created: booking_revisions table';
  RAISE NOTICE 'Created: v_thread_summary view';
  RAISE NOTICE 'Created: v_booking_revision_history view';
END $$;
