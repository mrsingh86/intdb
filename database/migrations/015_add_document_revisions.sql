-- ============================================================================
-- MIGRATION 015: ADD DOCUMENT REVISION TRACKING
-- ============================================================================
-- Purpose: Track multiple versions of the same document type per shipment
-- Ensures latest version is always used for entity extraction
-- ============================================================================

-- Document Revisions Table
CREATE TABLE IF NOT EXISTS document_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,

  -- Revision Info
  revision_number INTEGER NOT NULL DEFAULT 1,
  revision_label VARCHAR(100),  -- "3RD UPDATE", "AMENDMENT 2", etc.
  is_latest BOOLEAN DEFAULT true,

  -- Source
  email_id UUID NOT NULL REFERENCES raw_emails(id),
  classification_id UUID REFERENCES document_classifications(id),

  -- Content Hash (for detecting true duplicates vs amendments)
  content_hash VARCHAR(64),

  -- What Changed
  changed_fields JSONB DEFAULT '{}',
  -- Structure: { "etd": { "old": "2025-01-01", "new": "2025-01-05" }, ... }

  change_summary TEXT,

  -- Metadata
  received_at TIMESTAMP WITH TIME ZONE NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  UNIQUE(shipment_id, document_type, revision_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_doc_rev_shipment ON document_revisions(shipment_id);
CREATE INDEX IF NOT EXISTS idx_doc_rev_doc_type ON document_revisions(document_type);
CREATE INDEX IF NOT EXISTS idx_doc_rev_latest ON document_revisions(shipment_id, document_type, is_latest) WHERE is_latest = true;
CREATE INDEX IF NOT EXISTS idx_doc_rev_email ON document_revisions(email_id);

-- Comments
COMMENT ON TABLE document_revisions IS 'Tracks multiple versions of documents per shipment';
COMMENT ON COLUMN document_revisions.revision_number IS 'Sequential revision number (1, 2, 3...)';
COMMENT ON COLUMN document_revisions.revision_label IS 'Label from email subject (3RD UPDATE, AMENDMENT 2)';
COMMENT ON COLUMN document_revisions.is_latest IS 'True for the most recent revision only';
COMMENT ON COLUMN document_revisions.changed_fields IS 'What changed from previous revision';

-- ============================================================================
-- Add revision tracking to entity_extractions
-- ============================================================================

ALTER TABLE entity_extractions
ADD COLUMN IF NOT EXISTS document_revision_id UUID REFERENCES document_revisions(id);

ALTER TABLE entity_extractions
ADD COLUMN IF NOT EXISTS revision_number INTEGER;

ALTER TABLE entity_extractions
ADD COLUMN IF NOT EXISTS is_from_latest_revision BOOLEAN DEFAULT true;

COMMENT ON COLUMN entity_extractions.document_revision_id IS 'Which document revision this entity came from';
COMMENT ON COLUMN entity_extractions.is_from_latest_revision IS 'Whether this entity is from the latest document revision';

-- ============================================================================
-- Add current document revision tracking to shipments
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS booking_revision_count INTEGER DEFAULT 0;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS si_revision_count INTEGER DEFAULT 0;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS hbl_revision_count INTEGER DEFAULT 0;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS last_document_update TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN shipments.booking_revision_count IS 'Number of booking confirmation revisions received';
COMMENT ON COLUMN shipments.si_revision_count IS 'Number of SI revisions received';
COMMENT ON COLUMN shipments.last_document_update IS 'When the last document update was received';

-- ============================================================================
-- Function to detect revision number from email subject
-- ============================================================================

CREATE OR REPLACE FUNCTION extract_revision_number(subject TEXT)
RETURNS TABLE(revision_number INTEGER, revision_label TEXT) AS $$
DECLARE
  match_result TEXT[];
  ordinal_match TEXT[];
  num INTEGER;
BEGIN
  -- Pattern 1: "3RD UPDATE", "2ND AMENDMENT", "1ST REVISION"
  match_result := regexp_match(subject, '(\d+)(?:ST|ND|RD|TH)\s+(?:UPDATE|AMENDMENT|REVISION)', 'i');
  IF match_result IS NOT NULL THEN
    num := match_result[1]::INTEGER;
    RETURN QUERY SELECT num, match_result[0];
    RETURN;
  END IF;

  -- Pattern 2: "AMENDMENT 2", "REVISION 3", "UPDATE #4"
  match_result := regexp_match(subject, '(?:AMENDMENT|REVISION|UPDATE)\s*#?\s*(\d+)', 'i');
  IF match_result IS NOT NULL THEN
    num := match_result[1]::INTEGER;
    RETURN QUERY SELECT num, 'AMENDMENT ' || num::TEXT;
    RETURN;
  END IF;

  -- Pattern 3: "V2", "V3" version indicators
  match_result := regexp_match(subject, '\bV(\d+)\b', 'i');
  IF match_result IS NOT NULL THEN
    num := match_result[1]::INTEGER;
    RETURN QUERY SELECT num, 'V' || num::TEXT;
    RETURN;
  END IF;

  -- Pattern 4: "AMENDED", "UPDATED" without number = revision 2
  IF subject ~* '\b(AMENDED|UPDATED|REVISED)\b' THEN
    RETURN QUERY SELECT 2, 'AMENDED'::TEXT;
    RETURN;
  END IF;

  -- Default: First version
  RETURN QUERY SELECT 1, NULL::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION extract_revision_number IS 'Extracts revision number from email subject patterns';

-- ============================================================================
-- END MIGRATION 015
-- ============================================================================
