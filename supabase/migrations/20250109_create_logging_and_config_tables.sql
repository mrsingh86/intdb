-- Migration: Create Logging and Configuration Tables
-- Date: 2025-01-09
-- Purpose: Add processing_logs, detection_patterns, and extraction_schemas tables

-- ============================================================================
-- Table 1: processing_logs
-- Centralized logging for the email processing pipeline
-- ============================================================================

CREATE TABLE IF NOT EXISTS processing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context
  section VARCHAR(100) NOT NULL,        -- 'email_fetch', 'classification', 'extraction', 'linking'
  action VARCHAR(100) NOT NULL,         -- 'start', 'complete', 'error', 'skip', 'retry'
  thread_id VARCHAR(200),               -- Gmail thread_id or correlation ID
  email_id UUID,                        -- Reference to raw_emails
  shipment_id UUID,                     -- Reference to shipments

  -- Log Details
  level VARCHAR(20) NOT NULL,           -- 'debug', 'info', 'warn', 'error', 'critical'
  message TEXT NOT NULL,
  metadata JSONB,                       -- Additional structured data

  -- Error Details (when level = 'error' or 'critical')
  error_code VARCHAR(50),
  error_stack TEXT,

  -- Timing
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_processing_logs_section ON processing_logs(section);
CREATE INDEX IF NOT EXISTS idx_processing_logs_level ON processing_logs(level);
CREATE INDEX IF NOT EXISTS idx_processing_logs_email_id ON processing_logs(email_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_thread_id ON processing_logs(thread_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_created_at ON processing_logs(created_at DESC);

-- Enable RLS
ALTER TABLE processing_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for service role
CREATE POLICY "Allow all for service role" ON processing_logs
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Table 2: detection_patterns
-- Database-driven carrier detection patterns (replaces hardcoded config)
-- ============================================================================

CREATE TABLE IF NOT EXISTS detection_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pattern Identity
  carrier_id VARCHAR(50) NOT NULL,      -- 'maersk', 'hapag', 'cma_cgm', etc.
  pattern_type VARCHAR(50) NOT NULL,    -- 'subject', 'sender', 'attachment', 'body'
  document_type VARCHAR(50) NOT NULL,   -- 'booking_confirmation', 'arrival_notice', etc.

  -- Pattern Definition
  pattern TEXT NOT NULL,                -- Regex pattern
  pattern_flags VARCHAR(10) DEFAULT 'i', -- 'i', 'gi', etc.
  priority INTEGER DEFAULT 50,          -- Higher = matched first

  -- Metadata
  description TEXT,
  example_matches TEXT[],

  -- Status
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_detection_patterns_carrier ON detection_patterns(carrier_id);
CREATE INDEX IF NOT EXISTS idx_detection_patterns_type ON detection_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_detection_patterns_enabled ON detection_patterns(enabled);
CREATE INDEX IF NOT EXISTS idx_detection_patterns_doc_type ON detection_patterns(document_type);

-- Enable RLS
ALTER TABLE detection_patterns ENABLE ROW LEVEL SECURITY;

-- Policy
CREATE POLICY "Allow all for service role" ON detection_patterns
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Table 3: extraction_schemas
-- Database-driven document extraction schemas (replaces hardcoded schemas)
-- ============================================================================

CREATE TABLE IF NOT EXISTS extraction_schemas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Schema Identity
  document_type VARCHAR(50) NOT NULL,   -- 'booking_confirmation', 'bill_of_lading', etc.
  carrier_id VARCHAR(50),               -- NULL = generic, or carrier-specific
  version INTEGER DEFAULT 1,

  -- Schema Definition (JSONB for flexibility)
  fields JSONB NOT NULL,                -- Array of field definitions
  sections JSONB,                       -- Optional section definitions
  tables_config JSONB,                  -- Optional table extraction rules

  -- Status
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint per document type/carrier/version
  UNIQUE(document_type, carrier_id, version)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_extraction_schemas_doc_type ON extraction_schemas(document_type);
CREATE INDEX IF NOT EXISTS idx_extraction_schemas_carrier ON extraction_schemas(carrier_id);
CREATE INDEX IF NOT EXISTS idx_extraction_schemas_enabled ON extraction_schemas(enabled);

-- Enable RLS
ALTER TABLE extraction_schemas ENABLE ROW LEVEL SECURITY;

-- Policy
CREATE POLICY "Allow all for service role" ON extraction_schemas
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- Seed Data: Detection Patterns (from existing shipping-line-patterns.ts)
-- ============================================================================

INSERT INTO detection_patterns (carrier_id, pattern_type, document_type, pattern, pattern_flags, priority, description, example_matches, enabled)
VALUES
  -- Maersk Patterns
  ('maersk', 'sender', 'general', '@maersk\\.com$', 'i', 90, 'Maersk sender domain', ARRAY['booking@maersk.com', 'export@maersk.com'], true),
  ('maersk', 'subject', 'booking_confirmation', 'booking\\s*(confirmation|confirmed)', 'i', 85, 'Maersk booking confirmation subject', ARRAY['Booking Confirmation for MAEU12345'], true),
  ('maersk', 'subject', 'shipping_instructions', 'shipping\\s*instruction', 'i', 85, 'Maersk SI subject', ARRAY['Shipping Instructions Required'], true),
  ('maersk', 'subject', 'arrival_notice', 'arrival\\s*notice|cargo\\s*arrival', 'i', 85, 'Maersk arrival notice', ARRAY['Arrival Notice - MAEU12345'], true),
  ('maersk', 'attachment', 'booking_confirmation', 'booking.*\\.pdf$', 'i', 80, 'Maersk booking PDF', ARRAY['Booking_Confirmation.pdf'], true),

  -- Hapag-Lloyd Patterns
  ('hapag', 'sender', 'general', '@hapag-lloyd\\.com$', 'i', 90, 'Hapag-Lloyd sender domain', ARRAY['noreply@hapag-lloyd.com'], true),
  ('hapag', 'subject', 'booking_confirmation', 'booking\\s*(confirmation|confirmed)|HLCU\\d+', 'i', 85, 'Hapag booking confirmation', ARRAY['Booking Confirmation HLCU1234567'], true),
  ('hapag', 'subject', 'arrival_notice', 'arrival\\s*notice|cargo\\s*arrival', 'i', 85, 'Hapag arrival notice', ARRAY['Arrival Notice'], true),

  -- CMA CGM Patterns
  ('cma_cgm', 'sender', 'general', '@cma-cgm\\.com$', 'i', 90, 'CMA CGM sender domain', ARRAY['export@cma-cgm.com'], true),
  ('cma_cgm', 'subject', 'booking_confirmation', 'booking\\s*(confirmation|confirmed)', 'i', 85, 'CMA CGM booking confirmation', ARRAY['Booking Confirmation'], true),
  ('cma_cgm', 'subject', 'arrival_notice', 'arrival\\s*notice', 'i', 85, 'CMA CGM arrival notice', ARRAY['Arrival Notice'], true),

  -- MSC Patterns
  ('msc', 'sender', 'general', '@msc\\.com$', 'i', 90, 'MSC sender domain', ARRAY['booking@msc.com'], true),
  ('msc', 'subject', 'booking_confirmation', 'booking\\s*(confirmation|confirmed)|MSCU\\d+', 'i', 85, 'MSC booking confirmation', ARRAY['Booking Confirmation MSCU1234567'], true),
  ('msc', 'subject', 'arrival_notice', 'arrival\\s*notice', 'i', 85, 'MSC arrival notice', ARRAY['Arrival Notice'], true),

  -- Evergreen Patterns
  ('evergreen', 'sender', 'general', '@evergreen-line\\.com$', 'i', 90, 'Evergreen sender domain', ARRAY['export@evergreen-line.com'], true),
  ('evergreen', 'subject', 'booking_confirmation', 'booking\\s*(confirmation|confirmed)', 'i', 85, 'Evergreen booking confirmation', ARRAY['Booking Confirmation'], true),

  -- COSCO Patterns
  ('cosco', 'sender', 'general', '@cosco\\.com$|@coscon\\.com$', 'i', 90, 'COSCO sender domain', ARRAY['booking@cosco.com'], true),
  ('cosco', 'subject', 'booking_confirmation', 'booking\\s*(confirmation|confirmed)', 'i', 85, 'COSCO booking confirmation', ARRAY['Booking Confirmation'], true),

  -- ONE (Ocean Network Express) Patterns
  ('one', 'sender', 'general', '@one-line\\.com$', 'i', 90, 'ONE sender domain', ARRAY['noreply@one-line.com'], true),
  ('one', 'subject', 'booking_confirmation', 'booking\\s*(confirmation|confirmed)', 'i', 85, 'ONE booking confirmation', ARRAY['Booking Confirmation'], true),

  -- Yang Ming Patterns
  ('yang_ming', 'sender', 'general', '@yangming\\.com$', 'i', 90, 'Yang Ming sender domain', ARRAY['export@yangming.com'], true),
  ('yang_ming', 'subject', 'booking_confirmation', 'booking\\s*(confirmation|confirmed)', 'i', 85, 'Yang Ming booking confirmation', ARRAY['Booking Confirmation'], true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Seed Data: Extraction Schemas
-- ============================================================================

INSERT INTO extraction_schemas (document_type, carrier_id, version, fields, sections, enabled)
VALUES
  -- Generic Booking Confirmation Schema
  ('booking_confirmation', NULL, 1,
   '[
     {"name": "booking_number", "type": "string", "required": true, "labelPatterns": ["Booking No", "Booking #", "Booking Number", "Booking Ref"], "valuePatterns": ["[A-Z0-9]{8,14}"], "description": "Primary booking reference"},
     {"name": "shipper_name", "type": "party", "required": true, "labelPatterns": ["Shipper", "Shipper Name", "Exporter"], "description": "Shipper/Exporter name"},
     {"name": "consignee_name", "type": "party", "required": false, "labelPatterns": ["Consignee", "Consignee Name", "Importer"], "description": "Consignee/Importer name"},
     {"name": "port_of_loading", "type": "port", "required": true, "labelPatterns": ["POL", "Port of Loading", "Loading Port", "Origin"], "description": "Port of Loading"},
     {"name": "port_of_discharge", "type": "port", "required": true, "labelPatterns": ["POD", "Port of Discharge", "Discharge Port", "Destination"], "description": "Port of Discharge"},
     {"name": "vessel_name", "type": "vessel", "required": false, "labelPatterns": ["Vessel", "Vessel Name", "Ship", "M/V"], "description": "Vessel name"},
     {"name": "voyage_number", "type": "string", "required": false, "labelPatterns": ["Voyage", "Voyage No", "Voy"], "description": "Voyage number"},
     {"name": "etd", "type": "date", "required": false, "labelPatterns": ["ETD", "Estimated Departure", "Departure Date"], "description": "Estimated Time of Departure"},
     {"name": "eta", "type": "date", "required": false, "labelPatterns": ["ETA", "Estimated Arrival", "Arrival Date"], "description": "Estimated Time of Arrival"},
     {"name": "container_type", "type": "string", "required": false, "labelPatterns": ["Container Type", "Equipment", "Size/Type"], "description": "Container type (20GP, 40HC, etc.)"},
     {"name": "container_count", "type": "number", "required": false, "labelPatterns": ["Quantity", "No. of Containers", "Units"], "description": "Number of containers"}
   ]'::jsonb,
   '[
     {"name": "header", "startMarkers": ["BOOKING CONFIRMATION"], "endMarkers": ["Shipper"], "fields": ["booking_number"]},
     {"name": "parties", "startMarkers": ["Shipper"], "endMarkers": ["Port of Loading", "POL"], "fields": ["shipper_name", "consignee_name"]},
     {"name": "routing", "startMarkers": ["Port of Loading", "POL"], "endMarkers": ["Container", "Equipment"], "fields": ["port_of_loading", "port_of_discharge", "vessel_name", "voyage_number", "etd", "eta"]}
   ]'::jsonb,
   true),

  -- Generic Bill of Lading Schema
  ('bill_of_lading', NULL, 1,
   '[
     {"name": "bl_number", "type": "string", "required": true, "labelPatterns": ["B/L No", "BL Number", "Bill of Lading No"], "valuePatterns": ["[A-Z]{4}[0-9]{8,12}"], "description": "Bill of Lading number"},
     {"name": "booking_number", "type": "string", "required": false, "labelPatterns": ["Booking No", "Booking Ref"], "description": "Related booking reference"},
     {"name": "shipper_name", "type": "party", "required": true, "labelPatterns": ["Shipper", "Exporter"], "description": "Shipper name"},
     {"name": "consignee_name", "type": "party", "required": true, "labelPatterns": ["Consignee", "Importer"], "description": "Consignee name"},
     {"name": "notify_party", "type": "party", "required": false, "labelPatterns": ["Notify Party", "Notify"], "description": "Notify party"},
     {"name": "port_of_loading", "type": "port", "required": true, "labelPatterns": ["POL", "Port of Loading"], "description": "Port of Loading"},
     {"name": "port_of_discharge", "type": "port", "required": true, "labelPatterns": ["POD", "Port of Discharge"], "description": "Port of Discharge"},
     {"name": "vessel_name", "type": "vessel", "required": false, "labelPatterns": ["Vessel", "Ocean Vessel"], "description": "Vessel name"},
     {"name": "container_numbers", "type": "container", "required": false, "labelPatterns": ["Container No", "Container"], "description": "Container numbers"},
     {"name": "gross_weight", "type": "weight", "required": false, "labelPatterns": ["Gross Weight", "Weight"], "description": "Total gross weight"},
     {"name": "description_of_goods", "type": "string", "required": false, "labelPatterns": ["Description", "Goods Description"], "description": "Cargo description"}
   ]'::jsonb,
   NULL,
   true),

  -- Generic Arrival Notice Schema
  ('arrival_notice', NULL, 1,
   '[
     {"name": "bl_number", "type": "string", "required": true, "labelPatterns": ["B/L No", "BL Number"], "description": "Bill of Lading number"},
     {"name": "vessel_name", "type": "vessel", "required": false, "labelPatterns": ["Vessel", "M/V"], "description": "Vessel name"},
     {"name": "voyage_number", "type": "string", "required": false, "labelPatterns": ["Voyage", "Voy"], "description": "Voyage number"},
     {"name": "eta", "type": "date", "required": true, "labelPatterns": ["ETA", "Arrival Date", "Expected Arrival"], "description": "Estimated arrival date"},
     {"name": "port_of_discharge", "type": "port", "required": true, "labelPatterns": ["POD", "Port of Discharge", "Destination"], "description": "Arrival port"},
     {"name": "container_numbers", "type": "container", "required": false, "labelPatterns": ["Container", "Container No"], "description": "Container numbers"},
     {"name": "consignee_name", "type": "party", "required": false, "labelPatterns": ["Consignee", "Notify"], "description": "Consignee name"},
     {"name": "free_time_expiry", "type": "date", "required": false, "labelPatterns": ["Free Time", "Demurrage Start", "Last Free Day"], "description": "Free time expiry date"},
     {"name": "delivery_order_required", "type": "string", "required": false, "labelPatterns": ["DO Required", "Delivery Order"], "description": "Delivery order requirement"}
   ]'::jsonb,
   NULL,
   true),

  -- Maersk-specific Booking Confirmation Schema (carrier override)
  ('booking_confirmation', 'maersk', 1,
   '[
     {"name": "booking_number", "type": "string", "required": true, "labelPatterns": ["Booking Number", "Maersk Booking"], "valuePatterns": ["[0-9]{9,10}"], "description": "Maersk booking number (numeric)"},
     {"name": "shipper_name", "type": "party", "required": true, "labelPatterns": ["Shipper", "Booked By"], "description": "Shipper name"},
     {"name": "consignee_name", "type": "party", "required": false, "labelPatterns": ["Consignee"], "description": "Consignee name"},
     {"name": "port_of_loading", "type": "port", "required": true, "labelPatterns": ["Origin", "POL", "From"], "description": "Port of Loading"},
     {"name": "port_of_discharge", "type": "port", "required": true, "labelPatterns": ["Destination", "POD", "To"], "description": "Port of Discharge"},
     {"name": "vessel_name", "type": "vessel", "required": false, "labelPatterns": ["Vessel", "1st Vessel"], "description": "Vessel name"},
     {"name": "voyage_number", "type": "string", "required": false, "labelPatterns": ["Voyage"], "description": "Voyage number"},
     {"name": "etd", "type": "date", "required": false, "labelPatterns": ["ETD", "Departure"], "description": "ETD"},
     {"name": "eta", "type": "date", "required": false, "labelPatterns": ["ETA", "Arrival"], "description": "ETA"},
     {"name": "container_type", "type": "string", "required": false, "labelPatterns": ["Equipment", "Container Type"], "description": "Container type"},
     {"name": "si_cutoff", "type": "date", "required": false, "labelPatterns": ["SI Cut-off", "Documentation Cutoff"], "description": "SI cutoff date"},
     {"name": "vgm_cutoff", "type": "date", "required": false, "labelPatterns": ["VGM Cut-off", "VGM Deadline"], "description": "VGM cutoff date"}
   ]'::jsonb,
   NULL,
   true)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE processing_logs IS 'Centralized logging for email processing pipeline with section/action tracking';
COMMENT ON TABLE detection_patterns IS 'Database-driven carrier detection patterns (replaces hardcoded config)';
COMMENT ON TABLE extraction_schemas IS 'Database-driven document extraction schemas with field definitions';
