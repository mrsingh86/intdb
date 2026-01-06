-- ============================================================================
-- Migration: 036_separate_extraction_buckets.sql
-- Purpose: Separate email and document extraction into distinct tables
-- Architecture: Based on Opus 4.5 analysis recommendation
-- ============================================================================

-- ============================================================================
-- EMAIL EXTRACTIONS (from subject/body text)
-- ============================================================================
CREATE TABLE IF NOT EXISTS email_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,

  -- Entity Information
  entity_type VARCHAR(100) NOT NULL,
  entity_value TEXT NOT NULL,
  entity_normalized TEXT,

  -- Extraction Metadata
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  extraction_method VARCHAR(100) NOT NULL, -- regex_subject, regex_body, ai_nlp
  source_field VARCHAR(50) NOT NULL, -- subject, body_text, body_html

  -- Position/Context (for debugging/highlighting)
  context_snippet TEXT,
  position_start INTEGER,
  position_end INTEGER,

  -- Thread Context
  is_from_reply BOOLEAN DEFAULT false,
  thread_position INTEGER, -- Position in thread (1 = original, 2 = first reply, etc.)

  -- Validation
  is_valid BOOLEAN DEFAULT true,
  validation_errors JSONB,

  -- Human Feedback
  is_correct BOOLEAN,
  corrected_value TEXT,
  feedback_by UUID,
  feedback_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Uniqueness constraint
  CONSTRAINT email_extractions_unique UNIQUE (email_id, entity_type, entity_value)
);

-- Indexes for email_extractions
CREATE INDEX IF NOT EXISTS idx_email_extractions_email_id ON email_extractions(email_id);
CREATE INDEX IF NOT EXISTS idx_email_extractions_entity_type ON email_extractions(entity_type);
CREATE INDEX IF NOT EXISTS idx_email_extractions_entity_value ON email_extractions(entity_value);
CREATE INDEX IF NOT EXISTS idx_email_extractions_entity_normalized ON email_extractions(entity_normalized);
CREATE INDEX IF NOT EXISTS idx_email_extractions_confidence ON email_extractions(confidence_score);
CREATE INDEX IF NOT EXISTS idx_email_extractions_source_field ON email_extractions(source_field);
CREATE INDEX IF NOT EXISTS idx_email_extractions_method ON email_extractions(extraction_method);

COMMENT ON TABLE email_extractions IS 'Entities extracted from email subject/body text. Optimized for NLP/regex patterns.';


-- ============================================================================
-- DOCUMENT EXTRACTIONS (from PDF/attachment content)
-- ============================================================================
CREATE TABLE IF NOT EXISTS document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES raw_attachments(id) ON DELETE CASCADE,
  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE, -- Denormalized for queries

  -- Entity Information
  entity_type VARCHAR(100) NOT NULL,
  entity_value TEXT NOT NULL,
  entity_normalized TEXT,

  -- Document Context
  page_number INTEGER DEFAULT 1,
  section_name VARCHAR(100), -- "header", "cargo_details", "party_section", "cutoff_section"
  table_name VARCHAR(100), -- If extracted from a table
  table_row INTEGER, -- Row number in table
  table_column VARCHAR(100), -- Column name in table

  -- Visual Context (for PDF layout analysis)
  bbox_x1 FLOAT, -- Bounding box coordinates
  bbox_y1 FLOAT,
  bbox_x2 FLOAT,
  bbox_y2 FLOAT,

  -- Extraction Metadata
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  extraction_method VARCHAR(100) NOT NULL, -- ocr_pattern, table_parser, ai_vision, form_field, regex

  -- Document Metadata
  document_type VARCHAR(100) NOT NULL, -- booking_confirmation, invoice, bill_of_lading, etc.
  document_revision INTEGER DEFAULT 1,
  is_latest_revision BOOLEAN DEFAULT true,

  -- Validation
  is_valid BOOLEAN DEFAULT true,
  validation_errors JSONB,

  -- Human Feedback
  is_correct BOOLEAN,
  corrected_value TEXT,
  feedback_by UUID,
  feedback_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Uniqueness constraint (page matters for documents)
  CONSTRAINT document_extractions_unique UNIQUE (attachment_id, entity_type, entity_value, page_number)
);

-- Indexes for document_extractions
CREATE INDEX IF NOT EXISTS idx_document_extractions_attachment_id ON document_extractions(attachment_id);
CREATE INDEX IF NOT EXISTS idx_document_extractions_email_id ON document_extractions(email_id);
CREATE INDEX IF NOT EXISTS idx_document_extractions_entity_type ON document_extractions(entity_type);
CREATE INDEX IF NOT EXISTS idx_document_extractions_entity_value ON document_extractions(entity_value);
CREATE INDEX IF NOT EXISTS idx_document_extractions_entity_normalized ON document_extractions(entity_normalized);
CREATE INDEX IF NOT EXISTS idx_document_extractions_document_type ON document_extractions(document_type);
CREATE INDEX IF NOT EXISTS idx_document_extractions_confidence ON document_extractions(confidence_score);
CREATE INDEX IF NOT EXISTS idx_document_extractions_section ON document_extractions(section_name);
CREATE INDEX IF NOT EXISTS idx_document_extractions_method ON document_extractions(extraction_method);

COMMENT ON TABLE document_extractions IS 'Entities extracted from PDF attachments. Optimized for layout/table/OCR extraction.';


-- ============================================================================
-- UNIFIED VIEW (for backward compatibility and easy queries)
-- ============================================================================
CREATE OR REPLACE VIEW unified_extractions AS
SELECT
  e.id,
  e.email_id,
  NULL::UUID as attachment_id,
  e.entity_type,
  e.entity_value,
  e.entity_normalized,
  e.confidence_score,
  e.extraction_method,
  'email' as source_type,
  e.source_field as source_detail,
  NULL::VARCHAR(100) as document_type,
  NULL::INTEGER as page_number,
  NULL::VARCHAR(100) as section_name,
  e.context_snippet,
  e.is_valid,
  e.is_correct,
  e.extracted_at,
  e.created_at
FROM email_extractions e

UNION ALL

SELECT
  d.id,
  d.email_id,
  d.attachment_id,
  d.entity_type,
  d.entity_value,
  d.entity_normalized,
  d.confidence_score,
  d.extraction_method,
  'document' as source_type,
  COALESCE(d.section_name, 'page_' || COALESCE(d.page_number, 1)::TEXT) as source_detail,
  d.document_type,
  d.page_number,
  d.section_name,
  NULL::TEXT as context_snippet,
  d.is_valid,
  d.is_correct,
  d.extracted_at,
  d.created_at
FROM document_extractions d;

COMMENT ON VIEW unified_extractions IS 'Combined view of email and document extractions for unified queries.';


-- ============================================================================
-- BEST ENTITIES VIEW (aggregated, deduplicated entities per email)
-- ============================================================================
CREATE OR REPLACE VIEW shipment_entities AS
WITH ranked_entities AS (
  SELECT
    email_id,
    entity_type,
    entity_value,
    entity_normalized,
    confidence_score,
    source_type,
    document_type,
    ROW_NUMBER() OVER (
      PARTITION BY email_id, entity_type
      ORDER BY
        confidence_score DESC,
        -- Documents preferred over emails for detailed data
        CASE source_type WHEN 'document' THEN 1 ELSE 2 END,
        extracted_at DESC
    ) as rank
  FROM unified_extractions
  WHERE is_valid = true
)
SELECT
  email_id,
  entity_type,
  entity_value,
  entity_normalized,
  confidence_score,
  source_type,
  document_type
FROM ranked_entities
WHERE rank = 1;

COMMENT ON VIEW shipment_entities IS 'Best entity value per type for each email. Documents preferred over emails.';


-- ============================================================================
-- ENTITY TYPE REFERENCE TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS extraction_entity_types (
  id VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NOT NULL, -- identifier, date, party, location, cargo, financial
  expected_in_emails BOOLEAN DEFAULT true,
  expected_in_documents BOOLEAN DEFAULT true,
  validation_regex TEXT,
  normalization_rules JSONB,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed entity types
INSERT INTO extraction_entity_types (id, display_name, category, expected_in_emails, expected_in_documents, description) VALUES
  -- Identifiers
  ('booking_number', 'Booking Number', 'identifier', true, true, 'Carrier booking reference'),
  ('bl_number', 'Bill of Lading Number', 'identifier', true, true, 'HBL or MBL number'),
  ('hbl_number', 'House BL Number', 'identifier', true, true, 'House Bill of Lading'),
  ('mbl_number', 'Master BL Number', 'identifier', true, true, 'Master Bill of Lading'),
  ('container_number', 'Container Number', 'identifier', true, true, 'Container ID (e.g., MSKU1234567)'),
  ('invoice_number', 'Invoice Number', 'identifier', true, true, 'Invoice reference'),
  ('job_number', 'Job Number', 'identifier', true, true, 'Internal job reference'),
  ('reference_number', 'Reference Number', 'identifier', true, true, 'Generic reference'),

  -- Dates
  ('etd', 'ETD', 'date', true, true, 'Estimated Time of Departure'),
  ('eta', 'ETA', 'date', true, true, 'Estimated Time of Arrival'),
  ('atd', 'ATD', 'date', true, true, 'Actual Time of Departure'),
  ('ata', 'ATA', 'date', true, true, 'Actual Time of Arrival'),
  ('si_cutoff', 'SI Cutoff', 'date', true, true, 'Shipping Instruction cutoff'),
  ('vgm_cutoff', 'VGM Cutoff', 'date', true, true, 'VGM submission deadline'),
  ('cargo_cutoff', 'Cargo Cutoff', 'date', true, true, 'Cargo delivery deadline'),
  ('free_time_expires', 'Free Time Expiry', 'date', true, true, 'Last free day'),

  -- Parties
  ('shipper', 'Shipper', 'party', false, true, 'Shipper/Exporter name'),
  ('consignee', 'Consignee', 'party', false, true, 'Consignee/Importer name'),
  ('notify_party', 'Notify Party', 'party', false, true, 'Notify party name'),
  ('carrier', 'Carrier', 'party', true, true, 'Shipping line name'),

  -- Locations
  ('port_of_loading', 'Port of Loading', 'location', true, true, 'POL'),
  ('port_of_discharge', 'Port of Discharge', 'location', true, true, 'POD'),
  ('place_of_delivery', 'Place of Delivery', 'location', false, true, 'Final delivery location'),
  ('place_of_receipt', 'Place of Receipt', 'location', false, true, 'Cargo pickup location'),

  -- Vessel/Voyage
  ('vessel_name', 'Vessel Name', 'vessel', true, true, 'Ship name'),
  ('voyage_number', 'Voyage Number', 'vessel', true, true, 'Voyage reference'),
  ('service_name', 'Service Name', 'vessel', true, true, 'Trade lane/service'),

  -- Cargo
  ('commodity', 'Commodity', 'cargo', false, true, 'Cargo description'),
  ('weight_kg', 'Weight (KG)', 'cargo', false, true, 'Gross weight'),
  ('volume_cbm', 'Volume (CBM)', 'cargo', false, true, 'Cubic meters'),
  ('package_count', 'Package Count', 'cargo', false, true, 'Number of packages'),
  ('container_type', 'Container Type', 'cargo', true, true, 'e.g., 40HC, 20GP'),

  -- Financial
  ('freight_amount', 'Freight Amount', 'financial', true, true, 'Freight charges'),
  ('total_amount', 'Total Amount', 'financial', true, true, 'Total invoice amount'),
  ('currency', 'Currency', 'financial', true, true, 'Currency code')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE extraction_entity_types IS 'Reference table defining valid entity types and their characteristics.';


-- ============================================================================
-- MIGRATION TRACKING
-- ============================================================================
-- Add column to entity_extractions to track migration
ALTER TABLE entity_extractions
ADD COLUMN IF NOT EXISTS migrated_to VARCHAR(50),
ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN entity_extractions.migrated_to IS 'Target table after migration (email_extractions or document_extractions)';


-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON email_extractions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_extractions TO authenticated;
GRANT SELECT ON unified_extractions TO authenticated;
GRANT SELECT ON shipment_entities TO authenticated;
GRANT SELECT ON extraction_entity_types TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON email_extractions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_extractions TO service_role;
GRANT SELECT ON unified_extractions TO service_role;
GRANT SELECT ON shipment_entities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON extraction_entity_types TO service_role;
