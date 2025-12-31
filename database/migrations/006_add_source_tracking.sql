-- ============================================================================
-- MIGRATION 006: ADD SOURCE TRACKING TO ENTITY EXTRACTIONS
-- ============================================================================
-- Purpose: Track which document type each entity was extracted from
-- Enables: Multi-source ETA/ETD conflict detection (Orion feature)
-- Principle: Database-Driven Everything (CLAUDE.md #9)
-- Author: AI Intelligence System
-- Date: 2025-12-25
-- Dependencies: Migrations 001-005 must be applied first
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: Add source_document_type to entity_extractions
-- Tracks which document type the entity was extracted from
-- ----------------------------------------------------------------------------
ALTER TABLE entity_extractions
ADD COLUMN IF NOT EXISTS source_document_type VARCHAR(100);

COMMENT ON COLUMN entity_extractions.source_document_type IS
  'Document type of the source email (e.g., booking_confirmation, arrival_notice). Enables multi-source tracking for ETD/ETA conflict detection.';

-- Add index for efficient querying by source document type
CREATE INDEX IF NOT EXISTS idx_entity_source_doc_type
ON entity_extractions(source_document_type);

-- Composite index for querying entities by type and source
CREATE INDEX IF NOT EXISTS idx_entity_type_source
ON entity_extractions(entity_type, source_document_type);

-- ----------------------------------------------------------------------------
-- PART 2: Add revision tracking to document_classifications
-- Tracks revision number for amendment emails
-- ----------------------------------------------------------------------------
ALTER TABLE document_classifications
ADD COLUMN IF NOT EXISTS revision_type VARCHAR(30),
ADD COLUMN IF NOT EXISTS revision_number INTEGER DEFAULT 0;

COMMENT ON COLUMN document_classifications.revision_type IS
  'Type of revision: original, update, amendment, cancellation';
COMMENT ON COLUMN document_classifications.revision_number IS
  'Revision sequence number (1 for 1st update, 2 for 2nd, etc.)';

-- Index for revision queries
CREATE INDEX IF NOT EXISTS idx_classification_revision
ON document_classifications(revision_type, revision_number);

-- ----------------------------------------------------------------------------
-- PART 3: Add cutoff date entity types to config (if table exists)
-- ----------------------------------------------------------------------------
INSERT INTO entity_type_config (type_name, display_name, description, example_values, category, icon_name, is_required)
VALUES
  ('si_cutoff', 'SI Cutoff', 'Shipping Instruction submission deadline', ARRAY['2025-12-28', 'DEC 28, 2025'], 'date', 'Clock', FALSE),
  ('vgm_cutoff', 'VGM Cutoff', 'Verified Gross Mass submission deadline', ARRAY['2025-12-29', 'DEC 29, 2025'], 'date', 'Clock', FALSE),
  ('cargo_cutoff', 'Cargo Cutoff', 'Cargo receiving deadline', ARRAY['2025-12-27', 'DEC 27, 2025'], 'date', 'Clock', FALSE),
  ('gate_cutoff', 'Gate Cutoff', 'Terminal gate closing time', ARRAY['2025-12-28 17:00', 'DEC 28, 5PM'], 'date', 'Clock', FALSE)
ON CONFLICT (type_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- PART 4: Backfill source_document_type for existing entities
-- Uses the classification of the source email
-- ----------------------------------------------------------------------------
UPDATE entity_extractions ee
SET source_document_type = dc.document_type
FROM document_classifications dc
WHERE ee.classification_id = dc.id
  AND ee.source_document_type IS NULL;

-- For entities without classification_id, try to match via email_id
UPDATE entity_extractions ee
SET source_document_type = (
  SELECT dc.document_type
  FROM document_classifications dc
  WHERE dc.email_id = ee.email_id
  ORDER BY dc.created_at DESC
  LIMIT 1
)
WHERE ee.source_document_type IS NULL
  AND ee.email_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- SUMMARY VIEW: Multi-source entity tracking per shipment
-- Useful for detecting ETD/ETA conflicts
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_multi_source_entities AS
SELECT
  sd.shipment_id,
  s.booking_number,
  ee.entity_type,
  ee.entity_value,
  ee.source_document_type,
  ee.confidence_score,
  ee.email_id,
  re.received_at as email_date,
  ee.created_at as extracted_at
FROM entity_extractions ee
JOIN shipment_documents sd ON sd.email_id = ee.email_id
JOIN shipments s ON s.id = sd.shipment_id
LEFT JOIN raw_emails re ON re.id = ee.email_id
WHERE ee.entity_type IN ('eta', 'etd', 'vessel_name', 'voyage_number')
ORDER BY sd.shipment_id, ee.entity_type, re.received_at DESC;

COMMENT ON VIEW v_multi_source_entities IS
  'Shows entities from multiple source documents per shipment, enabling conflict detection';

-- ============================================================================
-- END MIGRATION 006
-- ============================================================================
