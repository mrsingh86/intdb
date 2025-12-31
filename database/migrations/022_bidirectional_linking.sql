-- ============================================================================
-- MIGRATION 022: Bi-Directional Email-Shipment Linking
--
-- Purpose: Enable linking emails to shipments in both directions:
--   1. Email processed → link to existing shipment (already works)
--   2. Shipment created → backfill related emails (NEW)
--
-- Changes:
--   - Add link tracking columns to shipment_documents
--   - Create pending_email_links table for backfill queue
--   - Create shipment_link_audit table for audit trail
-- ============================================================================

-- ============================================================================
-- 1. ENHANCE shipment_documents TABLE
-- ============================================================================

-- Link source: how was this link created?
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS link_source VARCHAR(20) DEFAULT 'realtime'
CHECK (link_source IN ('realtime', 'backfill', 'manual', 'migration'));

-- Which identifier was used to create the link?
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS link_identifier_type VARCHAR(30)
CHECK (link_identifier_type IN ('booking_number', 'bl_number', 'container_number', 'reference_number', 'manual'));

-- The actual identifier value used
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS link_identifier_value TEXT;

-- Confidence score for this link (0-100)
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS link_confidence_score INTEGER DEFAULT 95
CHECK (link_confidence_score >= 0 AND link_confidence_score <= 100);

-- Email authority: 1=direct carrier, 2=forwarded carrier, 3=internal, 4=third party
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS email_authority INTEGER DEFAULT 4
CHECK (email_authority >= 1 AND email_authority <= 4);

-- Is this the source of truth for this document type?
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS is_source_of_truth BOOLEAN DEFAULT false;

-- When was this link created?
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Index for backfill queries
CREATE INDEX IF NOT EXISTS idx_shipment_docs_link_identifier
ON shipment_documents(link_identifier_type, link_identifier_value);

-- Index for source of truth lookups
CREATE INDEX IF NOT EXISTS idx_shipment_docs_source_of_truth
ON shipment_documents(shipment_id, document_type, is_source_of_truth)
WHERE is_source_of_truth = true;

-- ============================================================================
-- 2. CREATE shipment_link_audit TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_link_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was linked
  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Operation details
  operation VARCHAR(20) NOT NULL CHECK (operation IN ('link', 'unlink', 'update', 'conflict')),
  link_source VARCHAR(20) NOT NULL,
  link_identifier_type VARCHAR(30),
  link_identifier_value TEXT,

  -- Confidence at time of link
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  confidence_breakdown JSONB,

  -- Authority tracking
  email_authority INTEGER,

  -- Conflict info
  conflict_type VARCHAR(50),
  conflict_resolution JSONB,

  -- Who/what created this
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Notes
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_link_audit_email ON shipment_link_audit(email_id);
CREATE INDEX IF NOT EXISTS idx_link_audit_shipment ON shipment_link_audit(shipment_id);
CREATE INDEX IF NOT EXISTS idx_link_audit_created ON shipment_link_audit(created_at DESC);

COMMENT ON TABLE shipment_link_audit IS 'Complete audit trail for email-shipment links';

-- ============================================================================
-- 3. CREATE pending_email_links TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pending_email_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,

  -- What we're waiting to match on
  booking_number VARCHAR(100),
  bl_number VARCHAR(100),
  container_numbers TEXT[],

  -- Email metadata
  document_type VARCHAR(100),
  email_authority INTEGER,
  received_at TIMESTAMP WITH TIME ZONE,

  -- Status
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending', 'linked', 'expired', 'no_match')),
  linked_shipment_id UUID REFERENCES shipments(id),
  linked_at TIMESTAMP WITH TIME ZONE,

  -- Expiry (don't try to link very old emails)
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '90 days',

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint on email_id
  CONSTRAINT unique_pending_email UNIQUE (email_id)
);

-- Indexes for efficient backfill queries
CREATE INDEX IF NOT EXISTS idx_pending_links_booking ON pending_email_links(booking_number)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_links_bl ON pending_email_links(bl_number)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_links_status ON pending_email_links(status, created_at DESC);

COMMENT ON TABLE pending_email_links IS 'Queue for emails waiting for shipment creation';

-- ============================================================================
-- 4. UPDATE existing shipment_documents with defaults
-- ============================================================================

-- Set link_source to 'migration' for existing records
UPDATE shipment_documents
SET link_source = 'migration',
    link_identifier_type = 'booking_number',
    linked_at = created_at
WHERE link_source IS NULL OR link_source = 'realtime';

-- ============================================================================
-- 5. ADD HELPFUL VIEW
-- ============================================================================

CREATE OR REPLACE VIEW v_shipment_linking_stats AS
SELECT
  s.id as shipment_id,
  s.booking_number,
  COUNT(DISTINCT sd.email_id) as total_emails,
  COUNT(DISTINCT CASE WHEN sd.link_source = 'realtime' THEN sd.email_id END) as realtime_links,
  COUNT(DISTINCT CASE WHEN sd.link_source = 'backfill' THEN sd.email_id END) as backfill_links,
  COUNT(DISTINCT CASE WHEN sd.link_source = 'migration' THEN sd.email_id END) as migration_links,
  COUNT(DISTINCT CASE WHEN sd.is_source_of_truth THEN sd.email_id END) as source_of_truth_count,
  AVG(sd.link_confidence_score) as avg_confidence
FROM shipments s
LEFT JOIN shipment_documents sd ON s.id = sd.shipment_id
GROUP BY s.id, s.booking_number;

COMMENT ON VIEW v_shipment_linking_stats IS 'Statistics about email-shipment linking per shipment';

-- ============================================================================
-- DONE
-- ============================================================================
