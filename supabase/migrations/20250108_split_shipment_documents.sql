-- ============================================================================
-- Migration: Split shipment_documents into email_shipment_links + attachment_shipment_links
--
-- Purpose: Follow classification architecture pattern for consistency
-- - email_shipment_links: Email-level association (thread tracking, correspondence)
-- - attachment_shipment_links: Document-level linking (actual proof documents)
--
-- Benefits:
-- - Multi-attachment emails can link to different shipments
-- - Clean separation of email intent vs document content
-- - Consistent with email_classifications + attachment_classifications
-- ============================================================================

-- ============================================================================
-- STEP 1: Create new tables
-- ============================================================================

-- Email-level shipment links (for thread tracking, correspondence)
CREATE TABLE IF NOT EXISTS email_shipment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
  thread_id TEXT,  -- For thread-level grouping

  -- Linking metadata
  linking_id UUID,  -- Shared ID when email has attachments (links to attachment_shipment_links)
  link_method VARCHAR(50),  -- 'auto', 'manual', 'backfill', 'thread_authority'
  link_source VARCHAR(50),  -- 'email_extraction', 'thread_summary', 'user'
  link_confidence_score INTEGER,  -- 0-100

  -- What identifier was matched
  link_identifier_type VARCHAR(50),  -- 'booking_number', 'bl_number', 'container_number', 'hbl_number'
  link_identifier_value VARCHAR(255),

  -- Thread authority (for RE:/FW: chains)
  is_thread_authority BOOLEAN DEFAULT false,  -- True if this email defines the thread's shipment
  authority_email_id UUID REFERENCES raw_emails(id),  -- Which email is the authority
  thread_position INTEGER,  -- Position in thread (1 = original, 2+ = replies)

  -- Email context (denormalized for quick filtering)
  email_type VARCHAR(100),  -- From email_classifications
  sender_category VARCHAR(50),  -- 'carrier', 'broker', 'customer', 'internal'
  is_inbound BOOLEAN,

  -- Status
  status VARCHAR(30) DEFAULT 'linked',  -- 'linked', 'orphan', 'manual_review'

  -- Timestamps
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  linked_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_email_shipment UNIQUE (email_id, shipment_id)
);

-- Attachment-level shipment links (for actual document proof)
CREATE TABLE IF NOT EXISTS attachment_shipment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys
  attachment_id UUID NOT NULL REFERENCES raw_attachments(id) ON DELETE CASCADE,
  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,
  thread_id TEXT,

  -- Linking metadata
  linking_id UUID,  -- Shared with email_shipment_links when same email
  link_method VARCHAR(50),
  link_source VARCHAR(50),  -- 'document_extraction', 'schema', 'regex', 'user'
  link_confidence_score INTEGER,

  -- What identifier was matched
  link_identifier_type VARCHAR(50),
  link_identifier_value VARCHAR(255),
  matched_booking_number VARCHAR(100),
  matched_bl_number VARCHAR(100),
  matched_hbl_number VARCHAR(100),
  matched_container_number VARCHAR(100),

  -- Document metadata (denormalized for quick filtering)
  document_type VARCHAR(100) NOT NULL,  -- 'booking_confirmation', 'mbl', 'invoice', etc.
  document_category VARCHAR(50),  -- 'workflow', 'commercial', 'compliance', 'operational'
  document_date DATE,
  document_number VARCHAR(255),
  is_primary BOOLEAN DEFAULT false,  -- Is this the primary document of this type for shipment?

  -- Extraction reference
  extraction_id UUID,  -- Link to document_extractions if available

  -- Status
  status VARCHAR(30) DEFAULT 'linked',  -- 'linked', 'orphan', 'superseded', 'manual_review'

  -- Timestamps
  linked_at TIMESTAMPTZ DEFAULT NOW(),
  linked_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_attachment_shipment UNIQUE (attachment_id, shipment_id)
);

-- ============================================================================
-- STEP 2: Create indexes
-- ============================================================================

-- email_shipment_links indexes
CREATE INDEX idx_email_shipment_links_email_id ON email_shipment_links(email_id);
CREATE INDEX idx_email_shipment_links_shipment_id ON email_shipment_links(shipment_id);
CREATE INDEX idx_email_shipment_links_thread_id ON email_shipment_links(thread_id);
CREATE INDEX idx_email_shipment_links_linking_id ON email_shipment_links(linking_id);
CREATE INDEX idx_email_shipment_links_status ON email_shipment_links(status);
CREATE INDEX idx_email_shipment_links_identifier ON email_shipment_links(link_identifier_type, link_identifier_value);

-- attachment_shipment_links indexes
CREATE INDEX idx_attachment_shipment_links_attachment_id ON attachment_shipment_links(attachment_id);
CREATE INDEX idx_attachment_shipment_links_email_id ON attachment_shipment_links(email_id);
CREATE INDEX idx_attachment_shipment_links_shipment_id ON attachment_shipment_links(shipment_id);
CREATE INDEX idx_attachment_shipment_links_thread_id ON attachment_shipment_links(thread_id);
CREATE INDEX idx_attachment_shipment_links_linking_id ON attachment_shipment_links(linking_id);
CREATE INDEX idx_attachment_shipment_links_document_type ON attachment_shipment_links(document_type);
CREATE INDEX idx_attachment_shipment_links_status ON attachment_shipment_links(status);
CREATE INDEX idx_attachment_shipment_links_booking ON attachment_shipment_links(matched_booking_number);

-- ============================================================================
-- STEP 3: Migrate existing data from shipment_documents
-- ============================================================================

-- 3a. Migrate to email_shipment_links (one per email)
INSERT INTO email_shipment_links (
  email_id,
  shipment_id,
  thread_id,
  linking_id,
  link_method,
  link_source,
  link_confidence_score,
  link_identifier_type,
  link_identifier_value,
  is_thread_authority,
  authority_email_id,
  status,
  linked_at,
  linked_by,
  created_at
)
SELECT DISTINCT ON (sd.email_id)
  sd.email_id,
  sd.shipment_id,
  re.thread_id,
  gen_random_uuid() as linking_id,  -- Generate new linking_id
  sd.link_method,
  sd.link_source,
  sd.link_confidence_score,
  sd.link_identifier_type,
  sd.link_identifier_value,
  COALESCE(sd.email_authority = 1, false) as is_thread_authority,
  sd.authority_email_id,
  CASE WHEN sd.shipment_id IS NULL THEN 'orphan' ELSE COALESCE(sd.status, 'linked') END,
  sd.linked_at,
  sd.linked_by,
  sd.created_at
FROM shipment_documents sd
JOIN raw_emails re ON re.id = sd.email_id
ORDER BY sd.email_id, sd.created_at;

-- 3b. Migrate to attachment_shipment_links (one per attachment)
INSERT INTO attachment_shipment_links (
  attachment_id,
  email_id,
  shipment_id,
  thread_id,
  linking_id,
  link_method,
  link_source,
  link_confidence_score,
  link_identifier_type,
  link_identifier_value,
  matched_booking_number,
  matched_bl_number,
  matched_container_number,
  document_type,
  document_date,
  document_number,
  is_primary,
  status,
  linked_at,
  linked_by,
  created_at
)
SELECT DISTINCT ON (ra.id, sd.shipment_id)
  ra.id as attachment_id,
  sd.email_id,
  sd.shipment_id,
  re.thread_id,
  esl.linking_id,  -- Use same linking_id from email_shipment_links
  sd.link_method,
  COALESCE(sd.link_source, 'migration'),
  sd.link_confidence_score,
  sd.link_identifier_type,
  sd.link_identifier_value,
  sd.matched_booking_number,
  sd.matched_bl_number,
  sd.matched_container_number,
  sd.document_type,
  sd.document_date,
  sd.document_number,
  sd.is_primary,
  CASE WHEN sd.shipment_id IS NULL THEN 'orphan' ELSE COALESCE(sd.status, 'linked') END,
  sd.linked_at,
  sd.linked_by,
  sd.created_at
FROM shipment_documents sd
JOIN raw_emails re ON re.id = sd.email_id
JOIN raw_attachments ra ON ra.email_id = sd.email_id
LEFT JOIN email_shipment_links esl ON esl.email_id = sd.email_id
WHERE ra.mime_type LIKE '%pdf%'
   OR ra.filename ILIKE '%.pdf'
ORDER BY ra.id, sd.shipment_id, sd.created_at;

-- ============================================================================
-- STEP 4: Create backward-compatible view
-- ============================================================================

-- This view allows existing code to continue working during transition
CREATE OR REPLACE VIEW v_shipment_documents AS
SELECT
  -- Use attachment link ID if exists, else email link ID
  COALESCE(asl.id, esl.id) as id,
  esl.email_id,
  asl.attachment_id,
  COALESCE(asl.shipment_id, esl.shipment_id) as shipment_id,
  COALESCE(asl.document_type, 'email') as document_type,
  asl.document_date,
  asl.document_number,
  asl.is_primary,
  COALESCE(asl.link_confidence_score, esl.link_confidence_score) as link_confidence_score,
  COALESCE(asl.link_method, esl.link_method) as link_method,
  COALESCE(asl.link_source, esl.link_source) as link_source,
  COALESCE(asl.link_identifier_type, esl.link_identifier_type) as link_identifier_type,
  COALESCE(asl.link_identifier_value, esl.link_identifier_value) as link_identifier_value,
  asl.matched_booking_number,
  asl.matched_bl_number,
  asl.matched_container_number,
  COALESCE(asl.status, esl.status) as status,
  COALESCE(asl.linked_at, esl.linked_at) as linked_at,
  COALESCE(asl.linked_by, esl.linked_by) as linked_by,
  COALESCE(asl.created_at, esl.created_at) as created_at,
  -- New fields from split
  esl.linking_id,
  esl.thread_id,
  esl.is_thread_authority,
  esl.authority_email_id,
  esl.email_type,
  esl.sender_category
FROM email_shipment_links esl
LEFT JOIN attachment_shipment_links asl ON asl.linking_id = esl.linking_id;

-- ============================================================================
-- STEP 5: Update document_extractions to link to attachment_shipment_links
-- ============================================================================

-- Add foreign key reference (optional, for data integrity)
ALTER TABLE document_extractions
ADD COLUMN IF NOT EXISTS shipment_link_id UUID REFERENCES attachment_shipment_links(id);

-- Backfill the shipment_link_id
UPDATE document_extractions de
SET shipment_link_id = asl.id
FROM attachment_shipment_links asl
WHERE de.attachment_id = asl.attachment_id
  AND de.shipment_link_id IS NULL;

-- ============================================================================
-- STEP 6: Add RLS policies (match existing patterns)
-- ============================================================================

ALTER TABLE email_shipment_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachment_shipment_links ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (adjust based on your auth model)
CREATE POLICY "Allow authenticated access to email_shipment_links"
  ON email_shipment_links FOR ALL
  TO authenticated
  USING (true);

CREATE POLICY "Allow authenticated access to attachment_shipment_links"
  ON attachment_shipment_links FOR ALL
  TO authenticated
  USING (true);

-- Allow service role full access
CREATE POLICY "Service role full access to email_shipment_links"
  ON email_shipment_links FOR ALL
  TO service_role
  USING (true);

CREATE POLICY "Service role full access to attachment_shipment_links"
  ON attachment_shipment_links FOR ALL
  TO service_role
  USING (true);

-- ============================================================================
-- STEP 7: Comments for documentation
-- ============================================================================

COMMENT ON TABLE email_shipment_links IS 'Email-level shipment associations. Tracks which emails relate to which shipments at the email/thread level.';
COMMENT ON TABLE attachment_shipment_links IS 'Attachment/document-level shipment associations. Links specific PDF documents to shipments with extracted identifiers.';

COMMENT ON COLUMN email_shipment_links.linking_id IS 'Shared UUID linking email_shipment_links to attachment_shipment_links for the same email';
COMMENT ON COLUMN email_shipment_links.is_thread_authority IS 'True if this email defines the shipment for the entire thread (original booking confirmation)';
COMMENT ON COLUMN attachment_shipment_links.linking_id IS 'Shared UUID linking to email_shipment_links for the parent email';
COMMENT ON COLUMN attachment_shipment_links.document_type IS 'Type of document: booking_confirmation, mbl, hbl, invoice, etc.';

-- ============================================================================
-- NOTE: Do NOT drop shipment_documents yet!
-- Keep it for rollback safety. Drop after verifying migration success.
--
-- To drop later:
-- DROP TABLE shipment_documents;
-- DROP VIEW v_shipment_documents;
-- CREATE VIEW shipment_documents AS SELECT * FROM v_shipment_documents;
-- ============================================================================
