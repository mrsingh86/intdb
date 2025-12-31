-- ============================================================================
-- MIGRATION 005: ADD TYPE CONFIGURATIONS (Layer 2 Configuration)
-- ============================================================================
-- Purpose: Move entity types and document types from code to database
-- Principle: Configuration Over Code (CLAUDE.md #5)
-- Author: AI Intelligence System
-- Date: 2025-12-25
-- Dependencies: Migrations 001, 002, 003, 004 must be applied first
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE 1: entity_type_config
-- Configuration for entity types that can be extracted from emails
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_type_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_name VARCHAR(100) UNIQUE NOT NULL, -- 'booking_number', 'vessel_name', etc.
  display_name VARCHAR(200) NOT NULL, -- 'Booking Number', 'Vessel Name'
  description TEXT, -- What this entity type represents
  example_values TEXT[], -- ['MAEU123456', 'ABC789012'] for booking_number
  extraction_hints TEXT, -- Hints for AI extraction (regex patterns, context clues)
  validation_regex VARCHAR(500), -- Optional regex for validation
  is_required BOOLEAN DEFAULT FALSE, -- Is this a critical entity for shipment creation?
  is_active BOOLEAN DEFAULT TRUE, -- Can be disabled without deleting
  icon_name VARCHAR(50), -- Icon identifier for UI ('Package', 'Ship', etc.)
  category VARCHAR(50), -- 'identifier', 'location', 'date', 'cargo', 'commercial'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_entity_type_config_name ON entity_type_config(type_name);
CREATE INDEX idx_entity_type_config_active ON entity_type_config(is_active);
CREATE INDEX idx_entity_type_config_category ON entity_type_config(category);

COMMENT ON TABLE entity_type_config IS 'Configuration for entity types extracted by Layer 2 AI';
COMMENT ON COLUMN entity_type_config.example_values IS 'Example values shown to AI for extraction training';
COMMENT ON COLUMN entity_type_config.extraction_hints IS 'Context or pattern hints for AI extraction';

-- ----------------------------------------------------------------------------
-- TABLE 2: document_type_config
-- Configuration for document/classification types for emails
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_type_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_name VARCHAR(100) UNIQUE NOT NULL, -- 'booking_confirmation', 'arrival_notice', etc.
  display_name VARCHAR(200) NOT NULL, -- 'Booking Confirmation', 'Arrival Notice'
  description TEXT, -- What this document type represents
  classification_keywords TEXT[], -- Keywords that indicate this type
  subject_patterns TEXT[], -- Subject line patterns for matching
  required_entities VARCHAR(100)[], -- Entity types that must be present
  is_active BOOLEAN DEFAULT TRUE,
  icon_name VARCHAR(50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_document_type_config_name ON document_type_config(type_name);
CREATE INDEX idx_document_type_config_active ON document_type_config(is_active);

COMMENT ON TABLE document_type_config IS 'Configuration for email document types classified by Layer 2 AI';
COMMENT ON COLUMN document_type_config.classification_keywords IS 'Keywords used for AI classification';
COMMENT ON COLUMN document_type_config.required_entities IS 'Entity types that should be extracted for this document type';

-- ----------------------------------------------------------------------------
-- SEED DATA: Entity Types (from types/email-intelligence.ts)
-- ----------------------------------------------------------------------------
INSERT INTO entity_type_config (type_name, display_name, description, example_values, category, icon_name, is_required) VALUES
('booking_number', 'Booking Number', 'Unique booking reference from carrier', ARRAY['MAEU123456789', '262775119', 'CMAU7654321'], 'identifier', 'Package', TRUE),
('bl_number', 'Bill of Lading Number', 'B/L number for the shipment', ARRAY['MAEU123456789', 'HLCUHAM123456', 'BL-2025-001'], 'identifier', 'FileText', TRUE),
('vessel_name', 'Vessel Name', 'Name of the ship/vessel', ARRAY['MAERSK ESSEX', 'MSC GRACE', 'CMA CGM VASCO DE GAMA'], 'transport', 'Ship', FALSE),
('voyage_number', 'Voyage Number', 'Voyage identifier', ARRAY['450W', '2025W', 'V123'], 'transport', 'Ship', FALSE),
('port_of_loading', 'Port of Loading', 'Loading port name', ARRAY['Ningbo', 'Shanghai', 'Yantian', 'Qingdao'], 'location', 'MapPin', FALSE),
('port_of_discharge', 'Port of Discharge', 'Discharge port name', ARRAY['Hamburg', 'Rotterdam', 'Long Beach', 'Singapore'], 'location', 'MapPin', FALSE),
('etd', 'ETD (Estimated Time of Departure)', 'Estimated departure date', ARRAY['2025-12-20', 'JAN. 3, 2026', '20TH DECEMBER, 2025'], 'date', 'Calendar', FALSE),
('eta', 'ETA (Estimated Time of Arrival)', 'Estimated arrival date', ARRAY['2026-01-15', 'FEB 5, 2026', '15th January'], 'date', 'Calendar', FALSE),
('container_number', 'Container Number', 'Container identifier', ARRAY['MAEU1234567', 'TEMU4567890', 'CMAU9876543'], 'identifier', 'Package', FALSE),
('carrier', 'Carrier Name', 'Shipping line/carrier', ARRAY['Maersk', 'Hapag-Lloyd', 'CMA CGM', 'MSC'], 'party', 'Ship', FALSE),
('shipper', 'Shipper', 'Shipper/exporter name', ARRAY['ABC Trading Co.', 'XYZ Exports Ltd'], 'party', 'User', FALSE),
('consignee', 'Consignee', 'Consignee/importer name', ARRAY['DEF Logistics', 'GHI Imports Inc'], 'party', 'User', FALSE),
('commodity', 'Commodity', 'Cargo description', ARRAY['Electronics', 'Furniture', 'Auto Parts'], 'cargo', 'Package', FALSE),
('weight', 'Weight', 'Total weight of cargo', ARRAY['15000', '2500.5', '10000'], 'cargo', 'Package', FALSE),
('volume', 'Volume', 'Total volume of cargo', ARRAY['45.5', '100', '28.3'], 'cargo', 'Package', FALSE),
('incoterms', 'Incoterms', 'Delivery terms', ARRAY['FOB', 'CIF', 'EXW', 'FCA'], 'commercial', 'FileText', FALSE),
('payment_terms', 'Payment Terms', 'Payment conditions', ARRAY['Prepaid', 'Collect', 'Net 30'], 'commercial', 'DollarSign', FALSE),
('amount', 'Amount', 'Monetary amount', ARRAY['5000', '12500.50', '999.99'], 'commercial', 'DollarSign', FALSE),
('currency', 'Currency', 'Currency code', ARRAY['USD', 'EUR', 'CNY', 'GBP'], 'commercial', 'DollarSign', FALSE),
('reference_number', 'Reference Number', 'General reference/invoice number', ARRAY['REF-2025-001', 'INV-12345'], 'identifier', 'FileText', FALSE),
('seal_number', 'Seal Number', 'Container seal number', ARRAY['SEAL123456', 'SL789012'], 'identifier', 'Package', FALSE);

-- ----------------------------------------------------------------------------
-- SEED DATA: Document Types (from types/email-intelligence.ts)
-- ----------------------------------------------------------------------------
INSERT INTO document_type_config (type_name, display_name, description, classification_keywords, subject_patterns, required_entities) VALUES
('booking_confirmation', 'Booking Confirmation', 'Initial booking confirmation from carrier', ARRAY['booking confirmation', 'booking details', 'booking received'], ARRAY['booking confirmation', 'booking number'], ARRAY['booking_number']),
('booking_amendment', 'Booking Amendment', 'Changes to existing booking', ARRAY['amendment', 'revised', 'updated booking'], ARRAY['amendment', 'revised', 'update'], ARRAY['booking_number']),
('arrival_notice', 'Arrival Notice', 'Notice of cargo arrival', ARRAY['arrival notice', 'cargo arrival', 'container arrived'], ARRAY['arrival notice', 'arrived'], ARRAY['bl_number', 'container_number']),
('bill_of_lading', 'Bill of Lading', 'Original or telex release B/L', ARRAY['bill of lading', 'b/l', 'bl original'], ARRAY['bill of lading', 'b/l'], ARRAY['bl_number']),
('shipping_instruction', 'Shipping Instruction', 'Instructions for shipping', ARRAY['shipping instruction', 'si cutoff', 'vgm'], ARRAY['shipping instruction'], ARRAY['booking_number']),
('invoice', 'Invoice', 'Freight or other invoice', ARRAY['invoice', 'payment due', 'amount'], ARRAY['invoice', 'payment'], ARRAY['amount', 'currency']),
('delivery_order', 'Delivery Order', 'Order for cargo delivery', ARRAY['delivery order', 'do release'], ARRAY['delivery order'], ARRAY['bl_number']),
('cargo_manifest', 'Cargo Manifest', 'List of cargo details', ARRAY['manifest', 'cargo list'], ARRAY['manifest'], ARRAY['container_number']),
('customs_document', 'Customs Document', 'Customs-related paperwork', ARRAY['customs', 'declaration', 'duty'], ARRAY['customs'], NULL),
('rate_confirmation', 'Rate Confirmation', 'Freight rate confirmation', ARRAY['rate confirmation', 'freight rate'], ARRAY['rate'], ARRAY['amount', 'currency']),
('vessel_schedule', 'Vessel Schedule', 'Sailing schedule information', ARRAY['vessel schedule', 'sailing schedule', 'departure'], ARRAY['schedule', 'sailing'], ARRAY['vessel_name', 'etd']),
('container_release', 'Container Release', 'Container release notification', ARRAY['container release', 'equipment release'], ARRAY['release'], ARRAY['container_number']),
('freight_invoice', 'Freight Invoice', 'Invoice for freight charges', ARRAY['freight invoice', 'freight charges'], ARRAY['freight invoice'], ARRAY['amount', 'currency', 'booking_number']),
('unknown', 'Unknown', 'Document type could not be determined', ARRAY[], ARRAY[], NULL),
('not_shipping', 'Not Shipping Related', 'Email is not related to shipping', ARRAY[], ARRAY[], NULL);

-- ----------------------------------------------------------------------------
-- Update timestamp trigger function (if not exists)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_entity_type_config_updated_at
    BEFORE UPDATE ON entity_type_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_document_type_config_updated_at
    BEFORE UPDATE ON document_type_config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- END MIGRATION 005
-- ============================================================================
