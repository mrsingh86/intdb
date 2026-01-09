-- Migration: Move hardcoded patterns to database
-- This migration creates tables for:
-- 1. Sender patterns (for email sender classification)
-- 2. Content markers (for document type classification)
-- 3. Extraction schemas and fields (for data extraction)

-- ============================================================================
-- PHASE 2: Sender Patterns Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS sender_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_type VARCHAR(50) NOT NULL UNIQUE,
  domains TEXT[] DEFAULT '{}',
  name_patterns TEXT[] DEFAULT '{}',
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sender_patterns_type ON sender_patterns(sender_type);
CREATE INDEX idx_sender_patterns_enabled ON sender_patterns(enabled);

-- ============================================================================
-- PHASE 3: Content Markers Table (for document classification)
-- ============================================================================

CREATE TABLE IF NOT EXISTS content_markers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(100) NOT NULL,
  required_keywords TEXT[] NOT NULL DEFAULT '{}',
  optional_keywords TEXT[] DEFAULT '{}',
  exclude_keywords TEXT[] DEFAULT '{}',
  confidence_score INT NOT NULL DEFAULT 70,
  marker_order INT DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_content_markers_doc_type ON content_markers(document_type);
CREATE INDEX idx_content_markers_enabled ON content_markers(enabled);

-- Add filename_patterns column to document_type_configs if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'document_type_configs'
                 AND column_name = 'filename_patterns') THEN
    ALTER TABLE document_type_configs ADD COLUMN filename_patterns TEXT[] DEFAULT '{}';
  END IF;
END $$;

-- ============================================================================
-- PHASE 4: Extraction Schemas Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS extraction_schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(200),
  category VARCHAR(50),
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_extraction_schemas_doc_type ON extraction_schemas(document_type);

CREATE TABLE IF NOT EXISTS entity_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id UUID REFERENCES extraction_schemas(id) ON DELETE CASCADE,
  field_name VARCHAR(100) NOT NULL,
  field_type VARCHAR(50) DEFAULT 'string',
  required BOOLEAN DEFAULT false,
  label_patterns TEXT[] DEFAULT '{}',
  value_patterns TEXT[] DEFAULT '{}',
  validation_regex TEXT,
  validation_rules JSONB DEFAULT '{}',
  field_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_entity_fields_schema ON entity_fields(schema_id);
CREATE INDEX idx_entity_fields_name ON entity_fields(field_name);

CREATE TABLE IF NOT EXISTS section_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id UUID REFERENCES extraction_schemas(id) ON DELETE CASCADE,
  section_name VARCHAR(100) NOT NULL,
  start_markers TEXT[] DEFAULT '{}',
  end_markers TEXT[] DEFAULT '{}',
  fields TEXT[] DEFAULT '{}',
  section_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_section_definitions_schema ON section_definitions(schema_id);

CREATE TABLE IF NOT EXISTS table_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id UUID REFERENCES extraction_schemas(id) ON DELETE CASCADE,
  table_name VARCHAR(100) NOT NULL,
  header_patterns TEXT[] DEFAULT '{}',
  row_pattern TEXT,
  table_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_table_definitions_schema ON table_definitions(schema_id);

CREATE TABLE IF NOT EXISTS table_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID REFERENCES table_definitions(id) ON DELETE CASCADE,
  column_name VARCHAR(100) NOT NULL,
  header_patterns TEXT[] DEFAULT '{}',
  value_patterns TEXT[] DEFAULT '{}',
  column_type VARCHAR(50) DEFAULT 'string',
  column_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_table_columns_table ON table_columns(table_id);

-- ============================================================================
-- PHASE 1 & 2: Populate carrier_configs with missing domains
-- ============================================================================

-- Update existing carriers with additional domains
UPDATE carrier_configs
SET email_sender_patterns = array_cat(
  COALESCE(email_sender_patterns, '{}'),
  ARRAY['service.hlag.com']::TEXT[]
)
WHERE id = 'hapag'
AND NOT ('service.hlag.com' = ANY(COALESCE(email_sender_patterns, '{}')));

-- Insert missing carriers if they don't exist
INSERT INTO carrier_configs (id, carrier_name, email_sender_patterns, enabled)
VALUES
  ('evergreen', 'Evergreen', ARRAY['evergreen-line.com', 'evergreen-marine.com'], true),
  ('oocl', 'OOCL', ARRAY['oocl.com'], true),
  ('cosco', 'COSCO', ARRAY['cosco.com', 'coscoshipping.com'], true),
  ('yangming', 'Yang Ming', ARRAY['yangming.com'], true),
  ('one', 'Ocean Network Express', ARRAY['one-line.com'], true),
  ('zim', 'ZIM', ARRAY['zim.com'], true),
  ('hmm', 'HMM', ARRAY['hmm21.com'], true),
  ('pil', 'PIL', ARRAY['pilship.com'], true),
  ('wanhai', 'Wan Hai', ARRAY['wanhai.com'], true),
  ('sitc', 'SITC', ARRAY['sitc.com'], true)
ON CONFLICT (id) DO UPDATE SET
  email_sender_patterns = EXCLUDED.email_sender_patterns,
  enabled = true;

-- ============================================================================
-- PHASE 2: Populate sender_patterns
-- ============================================================================

INSERT INTO sender_patterns (sender_type, domains, name_patterns, description) VALUES
(
  'shipping_line',
  ARRAY['maersk.com', 'sealandmaersk.com', 'hlag.com', 'service.hlag.com', 'hapag-lloyd.com',
        'msc.com', 'cma-cgm.com', 'evergreen-line.com', 'evergreen-marine.com', 'oocl.com',
        'cosco.com', 'coscoshipping.com', 'yangming.com', 'one-line.com', 'zim.com',
        'hmm21.com', 'pilship.com', 'wanhai.com', 'sitc.com'],
  ARRAY['maersk', 'hapag', 'msc ', 'cma cgm', 'evergreen', 'oocl', 'cosco',
        'yang ming', 'one line', 'ocean network', 'zim ', 'hmm ', 'wan hai', 'sitc'],
  'Ocean carriers / shipping lines'
),
(
  'freight_forwarder',
  ARRAY['intoglo.com', 'dhl.com', 'dbschenker.com', 'kuehne-nagel.com', 'expeditors.com',
        'chrobinson.com', 'flexport.com', 'geodis.com', 'ceva-logistics.com'],
  ARRAY['freight', 'forwarder', 'logistics', 'forwarding'],
  'Freight forwarders and logistics providers'
),
(
  'customs_broker_us',
  ARRAY['livingston.com', 'usacustomsclearance.com'],
  ARRAY['customs broker', 'customs clearance', 'cbp ', 'entry'],
  'US Customs brokers'
),
(
  'customs_broker_india',
  ARRAY['icegate.gov.in'],
  ARRAY['customs', 'dgft', 'icegate', 'shipping bill'],
  'Indian Customs / DGFT'
),
(
  'port_terminal',
  ARRAY['apm-terminals.com', 'dpworld.com', 'psa.com', 'hutchison-ports.com'],
  ARRAY['terminal', 'port ', 'gateway', 'container terminal'],
  'Port terminals and operators'
),
(
  'nvocc',
  ARRAY['ecuworldwide.com', 'allcargologistics.com'],
  ARRAY['nvocc', 'consolidator', 'lcl '],
  'NVOCCs and consolidators'
),
(
  'insurance',
  ARRAY['tiba.com', 'marsh.com', 'aon.com'],
  ARRAY['insurance', 'cargo insurance', 'marine insurance'],
  'Cargo insurance providers'
),
(
  'inspection',
  ARRAY['sgs.com', 'intertek.com', 'bvinspection.com'],
  ARRAY['inspection', 'survey', 'certificate', 'sgs ', 'intertek'],
  'Inspection and certification agencies'
)
ON CONFLICT (sender_type) DO UPDATE SET
  domains = EXCLUDED.domains,
  name_patterns = EXCLUDED.name_patterns,
  description = EXCLUDED.description;

-- ============================================================================
-- PHASE 3: Populate content_markers for key document types
-- ============================================================================

-- Booking Confirmation markers
INSERT INTO content_markers (document_type, required_keywords, optional_keywords, exclude_keywords, confidence_score, marker_order) VALUES
('booking_confirmation', ARRAY['BOOKING CONFIRMATION'], ARRAY['BOOKING NUMBER', 'CONTAINER', 'VESSEL', 'ETD'], ARRAY['BOOKING AMENDMENT', 'BOOKING CANCELLED'], 95, 1),
('booking_confirmation', ARRAY['BOOKING CONFIRMED'], ARRAY['REFERENCE', 'SHIPMENT'], ARRAY['AMENDMENT'], 90, 2),
('booking_confirmation', ARRAY['BKG CONFIRMATION', 'BOOKING NO'], ARRAY[], ARRAY[], 85, 3);

-- Shipping Instructions markers
INSERT INTO content_markers (document_type, required_keywords, optional_keywords, exclude_keywords, confidence_score, marker_order) VALUES
('shipping_instruction', ARRAY['SHIPPING INSTRUCTION', 'SI SUB TYPE'], ARRAY['B/L TYPE', 'TRANSPORT DOCUMENT'], ARRAY[], 95, 1),
('shipping_instruction', ARRAY['SHIPPING INSTRUCTION', 'B/L TYPE'], ARRAY['CONTAINER DETAILS'], ARRAY[], 90, 2),
('shipping_instruction', ARRAY['SI DRAFT', 'SHIPPER'], ARRAY['CONSIGNEE', 'NOTIFY'], ARRAY[], 85, 3);

-- Bill of Lading markers
INSERT INTO content_markers (document_type, required_keywords, optional_keywords, exclude_keywords, confidence_score, marker_order) VALUES
('bill_of_lading', ARRAY['BILL OF LADING'], ARRAY['SHIPPED ON BOARD', 'B/L NUMBER', 'FREIGHT'], ARRAY['DRAFT'], 95, 1),
('bill_of_lading', ARRAY['B/L', 'SHIPPED ON BOARD'], ARRAY['OCEAN BILL', 'ORIGINAL'], ARRAY[], 90, 2),
('mbl', ARRAY['MASTER BILL OF LADING', 'MBL'], ARRAY['CARRIER'], ARRAY[], 95, 1),
('hbl', ARRAY['HOUSE BILL OF LADING', 'HBL'], ARRAY['NVOCC', 'FORWARDER'], ARRAY[], 95, 1);

-- Arrival Notice markers
INSERT INTO content_markers (document_type, required_keywords, optional_keywords, exclude_keywords, confidence_score, marker_order) VALUES
('arrival_notice', ARRAY['ARRIVAL NOTICE'], ARRAY['ETA', 'VESSEL ARRIVAL', 'CONTAINER'], ARRAY[], 95, 1),
('arrival_notice', ARRAY['CARGO ARRIVAL', 'VESSEL ETA'], ARRAY['PORT OF DISCHARGE'], ARRAY[], 90, 2);

-- Invoice markers
INSERT INTO content_markers (document_type, required_keywords, optional_keywords, exclude_keywords, confidence_score, marker_order) VALUES
('commercial_invoice', ARRAY['COMMERCIAL INVOICE'], ARRAY['INVOICE NO', 'TOTAL AMOUNT', 'FOB', 'CIF'], ARRAY[], 95, 1),
('freight_invoice', ARRAY['FREIGHT INVOICE'], ARRAY['OCEAN FREIGHT', 'CHARGES', 'AMOUNT DUE'], ARRAY[], 95, 1),
('freight_invoice', ARRAY['DEBIT NOTE', 'FREIGHT CHARGES'], ARRAY['THC', 'BAF', 'CAF'], ARRAY[], 90, 2);

-- Entry Summary markers
INSERT INTO content_markers (document_type, required_keywords, optional_keywords, exclude_keywords, confidence_score, marker_order) VALUES
('entry_summary', ARRAY['ENTRY SUMMARY', 'CBP FORM 7501'], ARRAY['DEPARTMENT OF HOMELAND SECURITY'], ARRAY[], 98, 1),
('entry_summary', ARRAY['CUSTOMS ENTRY', 'ENTRY NUMBER'], ARRAY['DUTY', 'HTS'], ARRAY[], 90, 2);

-- Packing List markers
INSERT INTO content_markers (document_type, required_keywords, optional_keywords, exclude_keywords, confidence_score, marker_order) VALUES
('packing_list', ARRAY['PACKING LIST'], ARRAY['CARTONS', 'GROSS WEIGHT', 'NET WEIGHT', 'CBM'], ARRAY[], 95, 1),
('packing_list', ARRAY['PACKING SLIP', 'PACKAGES'], ARRAY['DIMENSIONS', 'WEIGHT'], ARRAY[], 85, 2);

-- ============================================================================
-- PHASE 4: Populate extraction schemas for key document types
-- ============================================================================

-- Booking Confirmation Schema
INSERT INTO extraction_schemas (document_type, display_name, category) VALUES
('booking_confirmation', 'Booking Confirmation', 'documentation')
ON CONFLICT (document_type) DO NOTHING;

-- Get the schema ID and insert fields
DO $$
DECLARE
  schema_uuid UUID;
BEGIN
  SELECT id INTO schema_uuid FROM extraction_schemas WHERE document_type = 'booking_confirmation';

  IF schema_uuid IS NOT NULL THEN
    INSERT INTO entity_fields (schema_id, field_name, field_type, required, label_patterns, value_patterns, field_order) VALUES
    (schema_uuid, 'booking_number', 'string', true,
     ARRAY['BOOKING\\s+(?:NO|NUMBER|#|REF(?:ERENCE)?)[.:]*', 'BOOKING[.:]+$', 'BKG\\s*(?:NO|#)?[:]?'],
     ARRAY['[A-Z0-9]{6,15}'], 1),
    (schema_uuid, 'vessel_name', 'string', false,
     ARRAY['VESSEL[:]?', 'SHIP\\s*NAME[:]?'],
     ARRAY['([A-Z][A-Z ]{2,}[A-Z])\\s*/\\s*[A-Z0-9]+\\s*(?:Vessel|Voyage)', 'VESSEL[:\\s]+([A-Z][A-Z \\-.]{2,25}[A-Z])'], 2),
    (schema_uuid, 'voyage_number', 'string', false,
     ARRAY['VOYAGE[:]?', 'VOY[:]?'],
     ARRAY['/\\s*([A-Z0-9]{6,12})(?:Vessel|Voyage)', 'VOYAGE[:\\s#]+([A-Z0-9]{4,15})'], 3),
    (schema_uuid, 'port_of_loading', 'string', false,
     ARRAY['PORT\\s*OF\\s*LOADING[:]?', 'POL[:]?', 'LOADING\\s*PORT[:]?'],
     ARRAY[], 4),
    (schema_uuid, 'port_of_discharge', 'string', false,
     ARRAY['PORT\\s*OF\\s*DISCHARGE[:]?', 'POD[:]?', 'DISCHARGE\\s*PORT[:]?'],
     ARRAY[], 5),
    (schema_uuid, 'etd', 'date', false,
     ARRAY['ETD[:]?', 'ESTIMATED\\s*(?:TIME\\s*OF\\s*)?DEPARTURE[:]?', 'SAILING\\s*DATE[:]?'],
     ARRAY[], 6),
    (schema_uuid, 'eta', 'date', false,
     ARRAY['ETA[:]?', 'ESTIMATED\\s*(?:TIME\\s*OF\\s*)?ARRIVAL[:]?'],
     ARRAY[], 7),
    (schema_uuid, 'si_cutoff', 'date', false,
     ARRAY['SI\\s*CUT\\s*OFF[:]?', 'SHIPPING\\s*INSTRUCTION\\s*DEADLINE[:]?'],
     ARRAY[], 8),
    (schema_uuid, 'vgm_cutoff', 'date', false,
     ARRAY['VGM\\s*CUT\\s*OFF[:]?', 'VGM\\s*DEADLINE[:]?'],
     ARRAY[], 9)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Bill of Lading Schema
INSERT INTO extraction_schemas (document_type, display_name, category) VALUES
('bill_of_lading', 'Bill of Lading', 'documentation')
ON CONFLICT (document_type) DO NOTHING;

DO $$
DECLARE
  schema_uuid UUID;
BEGIN
  SELECT id INTO schema_uuid FROM extraction_schemas WHERE document_type = 'bill_of_lading';

  IF schema_uuid IS NOT NULL THEN
    INSERT INTO entity_fields (schema_id, field_name, field_type, required, label_patterns, value_patterns, field_order) VALUES
    (schema_uuid, 'bl_number', 'string', true,
     ARRAY['B/L\\s*(?:NO|NUMBER)?[:]?', 'BILL\\s*OF\\s*LADING\\s*(?:NO|NUMBER)?[:]?'],
     ARRAY['[A-Z]{4}[A-Z0-9]{10,14}'], 1),
    (schema_uuid, 'shipper', 'party', false,
     ARRAY['SHIPPER[:]?', 'CONSIGNOR[:]?'],
     ARRAY[], 2),
    (schema_uuid, 'consignee', 'party', false,
     ARRAY['CONSIGNEE[:]?'],
     ARRAY[], 3),
    (schema_uuid, 'notify_party', 'party', false,
     ARRAY['NOTIFY\\s*(?:PARTY)?[:]?', 'ALSO\\s*NOTIFY[:]?'],
     ARRAY[], 4),
    (schema_uuid, 'vessel_name', 'string', false,
     ARRAY['VESSEL[:]?', 'OCEAN\\s*VESSEL[:]?'],
     ARRAY[], 5),
    (schema_uuid, 'voyage_number', 'string', false,
     ARRAY['VOYAGE[:]?'],
     ARRAY[], 6),
    (schema_uuid, 'port_of_loading', 'string', false,
     ARRAY['PORT\\s*OF\\s*LOADING[:]?', 'POL[:]?'],
     ARRAY[], 7),
    (schema_uuid, 'port_of_discharge', 'string', false,
     ARRAY['PORT\\s*OF\\s*DISCHARGE[:]?', 'POD[:]?'],
     ARRAY[], 8),
    (schema_uuid, 'container_number', 'container', false,
     ARRAY['CONTAINER\\s*(?:NO|NUMBER)?[:]?'],
     ARRAY['[A-Z]{4}[0-9]{7}'], 9),
    (schema_uuid, 'shipped_on_board_date', 'date', false,
     ARRAY['SHIPPED\\s*ON\\s*BOARD[:]?', 'ON\\s*BOARD\\s*DATE[:]?'],
     ARRAY[], 10)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Arrival Notice Schema
INSERT INTO extraction_schemas (document_type, display_name, category) VALUES
('arrival_notice', 'Arrival Notice', 'documentation')
ON CONFLICT (document_type) DO NOTHING;

DO $$
DECLARE
  schema_uuid UUID;
BEGIN
  SELECT id INTO schema_uuid FROM extraction_schemas WHERE document_type = 'arrival_notice';

  IF schema_uuid IS NOT NULL THEN
    INSERT INTO entity_fields (schema_id, field_name, field_type, required, label_patterns, value_patterns, field_order) VALUES
    (schema_uuid, 'bl_number', 'string', false,
     ARRAY['B/L\\s*(?:NO|NUMBER)?[:]?'],
     ARRAY['[A-Z]{4}[A-Z0-9]{10,14}'], 1),
    (schema_uuid, 'container_number', 'container', false,
     ARRAY['CONTAINER\\s*(?:NO|NUMBER)?[:]?'],
     ARRAY['[A-Z]{4}[0-9]{7}'], 2),
    (schema_uuid, 'vessel_name', 'string', false,
     ARRAY['VESSEL[:]?'],
     ARRAY[], 3),
    (schema_uuid, 'eta', 'date', false,
     ARRAY['ETA[:]?', 'ARRIVAL\\s*DATE[:]?'],
     ARRAY[], 4),
    (schema_uuid, 'port_of_discharge', 'string', false,
     ARRAY['PORT\\s*OF\\s*DISCHARGE[:]?', 'DISCHARGE\\s*PORT[:]?'],
     ARRAY[], 5),
    (schema_uuid, 'last_free_day', 'date', false,
     ARRAY['LAST\\s*FREE\\s*DAY[:]?', 'LFD[:]?', 'FREE\\s*TIME\\s*EXPIRES[:]?'],
     ARRAY[], 6),
    (schema_uuid, 'demurrage_start', 'date', false,
     ARRAY['DEMURRAGE\\s*(?:START|BEGINS)[:]?'],
     ARRAY[], 7)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Commercial Invoice Schema
INSERT INTO extraction_schemas (document_type, display_name, category) VALUES
('commercial_invoice', 'Commercial Invoice', 'financial')
ON CONFLICT (document_type) DO NOTHING;

DO $$
DECLARE
  schema_uuid UUID;
BEGIN
  SELECT id INTO schema_uuid FROM extraction_schemas WHERE document_type = 'commercial_invoice';

  IF schema_uuid IS NOT NULL THEN
    INSERT INTO entity_fields (schema_id, field_name, field_type, required, label_patterns, value_patterns, field_order) VALUES
    (schema_uuid, 'invoice_number', 'string', true,
     ARRAY['INVOICE\\s*(?:NO|NUMBER)?[:]?'],
     ARRAY['[A-Z0-9]{6,20}'], 1),
    (schema_uuid, 'invoice_date', 'date', false,
     ARRAY['INVOICE\\s*DATE[:]?', 'DATE[:]?'],
     ARRAY[], 2),
    (schema_uuid, 'total_amount', 'amount', false,
     ARRAY['TOTAL\\s*(?:AMOUNT)?[:]?', 'GRAND\\s*TOTAL[:]?', 'INVOICE\\s*TOTAL[:]?'],
     ARRAY['(?:USD|\\$)\\s*([\\d,]+\\.?\\d*)'], 3),
    (schema_uuid, 'currency', 'string', false,
     ARRAY['CURRENCY[:]?'],
     ARRAY['USD|EUR|INR|GBP'], 4),
    (schema_uuid, 'po_number', 'string', false,
     ARRAY['PO\\s*(?:NO|NUMBER)?[:]?', 'PURCHASE\\s*ORDER[:]?'],
     ARRAY[], 5)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

COMMENT ON TABLE sender_patterns IS 'Sender classification patterns for email processing';
COMMENT ON TABLE content_markers IS 'Content-based document classification markers';
COMMENT ON TABLE extraction_schemas IS 'Document extraction schema definitions';
COMMENT ON TABLE entity_fields IS 'Field extraction patterns for each schema';
