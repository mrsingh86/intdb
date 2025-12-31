-- ============================================================================
-- MIGRATION 009: ADD DOCUMENT AUTHORITY RULES
-- ============================================================================
-- Purpose: Define which document types are authoritative for specific entities
-- This enables document-hierarchy based entity extraction
-- ============================================================================

-- Document Authority Rules Table
CREATE TABLE IF NOT EXISTS document_authority_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  authority_level INTEGER NOT NULL DEFAULT 1,  -- 1=primary, 2=secondary, 3=fallback
  can_override_from TEXT[],  -- Array of doc types this can override
  extraction_prompt_key VARCHAR(100),  -- Maps to prompt templates
  validation_rules JSONB,  -- Validation patterns/rules
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(document_type, entity_type)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_authority_doc_type ON document_authority_rules(document_type);
CREATE INDEX IF NOT EXISTS idx_authority_entity_type ON document_authority_rules(entity_type);
CREATE INDEX IF NOT EXISTS idx_authority_level ON document_authority_rules(authority_level);

-- Comments
COMMENT ON TABLE document_authority_rules IS 'Defines which document type is authoritative for each entity type';
COMMENT ON COLUMN document_authority_rules.authority_level IS '1=primary source, 2=secondary, 3=fallback only';
COMMENT ON COLUMN document_authority_rules.can_override_from IS 'List of document types this authority can override';
COMMENT ON COLUMN document_authority_rules.extraction_prompt_key IS 'Key to lookup specific extraction prompt';

-- ============================================================================
-- SEED DATA: Document Authority Rules
-- ============================================================================

-- Booking Confirmation Authorities (Primary source for routing/schedule)
INSERT INTO document_authority_rules (document_type, entity_type, authority_level, extraction_prompt_key) VALUES
('booking_confirmation', 'booking_number', 1, 'booking_number'),
('booking_confirmation', 'port_of_loading', 1, 'booking_pol'),
('booking_confirmation', 'port_of_loading_code', 1, 'booking_pol_code'),
('booking_confirmation', 'port_of_discharge', 1, 'booking_pod'),
('booking_confirmation', 'port_of_discharge_code', 1, 'booking_pod_code'),
('booking_confirmation', 'final_destination', 1, 'booking_fpod'),
('booking_confirmation', 'terminal', 1, 'booking_terminal'),
('booking_confirmation', 'vessel_name', 1, 'booking_vessel'),
('booking_confirmation', 'voyage_number', 1, 'booking_voyage'),
('booking_confirmation', 'etd', 1, 'booking_etd'),
('booking_confirmation', 'eta', 1, 'booking_eta'),
('booking_confirmation', 'si_cutoff', 1, 'booking_si_cutoff'),
('booking_confirmation', 'vgm_cutoff', 1, 'booking_vgm_cutoff'),
('booking_confirmation', 'cargo_cutoff', 1, 'booking_cargo_cutoff'),
('booking_confirmation', 'gate_cutoff', 1, 'booking_gate_cutoff')
ON CONFLICT (document_type, entity_type) DO NOTHING;

-- Commercial Invoice Authorities
INSERT INTO document_authority_rules (document_type, entity_type, authority_level, extraction_prompt_key) VALUES
('commercial_invoice', 'product_details', 1, 'invoice_products'),
('commercial_invoice', 'invoice_value', 1, 'invoice_value'),
('commercial_invoice', 'invoice_currency', 1, 'invoice_currency'),
('commercial_invoice', 'hs_code_shipper', 1, 'invoice_hs_code'),
('commercial_invoice', 'invoice_number', 1, 'invoice_number'),
('commercial_invoice', 'invoice_date', 1, 'invoice_date')
ON CONFLICT (document_type, entity_type) DO NOTHING;

-- Packing List Authorities
INSERT INTO document_authority_rules (document_type, entity_type, authority_level, extraction_prompt_key) VALUES
('packing_list', 'total_packages', 1, 'packing_packages'),
('packing_list', 'package_type', 1, 'packing_package_type'),
('packing_list', 'gross_weight', 1, 'packing_weight'),
('packing_list', 'net_weight', 1, 'packing_net_weight'),
('packing_list', 'total_volume', 1, 'packing_volume'),
('packing_list', 'dimensions', 1, 'packing_dimensions')
ON CONFLICT (document_type, entity_type) DO NOTHING;

-- SI Draft Authorities (MASTER SOURCE for cargo/party details)
INSERT INTO document_authority_rules (document_type, entity_type, authority_level, extraction_prompt_key) VALUES
('si_draft', 'shipper_name', 1, 'si_shipper_name'),
('si_draft', 'shipper_address', 1, 'si_shipper_address'),
('si_draft', 'consignee_name', 1, 'si_consignee_name'),
('si_draft', 'consignee_address', 1, 'si_consignee_address'),
('si_draft', 'notify_party_name', 1, 'si_notify_name'),
('si_draft', 'notify_party_address', 1, 'si_notify_address'),
('si_draft', 'cargo_description', 1, 'si_cargo_desc'),
('si_draft', 'hs_code', 1, 'si_hs_code'),
('si_draft', 'marks_numbers', 1, 'si_marks'),
('si_draft', 'container_numbers', 1, 'si_containers'),
('si_draft', 'seal_numbers', 1, 'si_seals'),
('si_draft', 'total_weight', 1, 'si_weight'),
('si_draft', 'weight_unit', 1, 'si_weight_unit')
ON CONFLICT (document_type, entity_type) DO NOTHING;

-- SI Confirmation (status update only - no entity extraction)
-- No entries - SI confirmation from line is just acknowledgment

-- House BL Authorities
INSERT INTO document_authority_rules (document_type, entity_type, authority_level, extraction_prompt_key) VALUES
('house_bl', 'bl_number', 1, 'hbl_number'),
('house_bl', 'delivery_address', 1, 'hbl_delivery_address'),
('house_bl', 'shipper_name', 2, 'hbl_shipper'),  -- Secondary to SI Draft
('house_bl', 'consignee_name', 2, 'hbl_consignee'),  -- Secondary to SI Draft
('house_bl', 'notify_party_name', 2, 'hbl_notify'),  -- Secondary to SI Draft
('house_bl', 'place_of_delivery', 1, 'hbl_place_delivery'),
('house_bl', 'freight_terms', 1, 'hbl_freight_terms')
ON CONFLICT (document_type, entity_type) DO NOTHING;

-- Arrival Notice Authorities
INSERT INTO document_authority_rules (document_type, entity_type, authority_level, extraction_prompt_key) VALUES
('arrival_notice', 'eta', 2, 'an_eta'),  -- Secondary to booking (final ETA update)
('arrival_notice', 'it_number', 1, 'an_it_number'),
('arrival_notice', 'arrival_date', 1, 'an_arrival_date'),
('arrival_notice', 'discharge_terminal', 1, 'an_terminal'),
('arrival_notice', 'free_time_expires', 1, 'an_free_time')
ON CONFLICT (document_type, entity_type) DO NOTHING;

-- Duty Summary Authorities
INSERT INTO document_authority_rules (document_type, entity_type, authority_level, extraction_prompt_key) VALUES
('duty_summary', 'duty_amount', 1, 'duty_amount'),
('duty_summary', 'duty_currency', 1, 'duty_currency'),
('duty_summary', 'hs_code_customs', 1, 'duty_hs_code'),  -- Customs-confirmed HS code
('duty_summary', 'entry_number', 1, 'duty_entry_number'),
('duty_summary', 'entry_date', 1, 'duty_entry_date')
ON CONFLICT (document_type, entity_type) DO NOTHING;

-- Operational Notification Authorities (Milestones/Updates)
INSERT INTO document_authority_rules (document_type, entity_type, authority_level, extraction_prompt_key) VALUES
('deadline_advisory', 'si_cutoff', 2, 'advisory_si_cutoff'),
('deadline_advisory', 'vgm_cutoff', 2, 'advisory_vgm_cutoff'),
('deadline_advisory', 'cargo_cutoff', 2, 'advisory_cargo_cutoff'),
('vgm_confirmation', 'vgm_status', 1, 'vgm_status'),
('rollover_notice', 'vessel_name', 2, 'rollover_vessel'),
('rollover_notice', 'etd', 2, 'rollover_etd'),
('container_release', 'pickup_location', 1, 'release_location'),
('container_release', 'pickup_date', 1, 'release_date')
ON CONFLICT (document_type, entity_type) DO NOTHING;

-- ============================================================================
-- Add entity_source tracking to entity_extractions
-- ============================================================================
ALTER TABLE entity_extractions
ADD COLUMN IF NOT EXISTS source_document_type VARCHAR(100);

ALTER TABLE entity_extractions
ADD COLUMN IF NOT EXISTS authority_level INTEGER;

COMMENT ON COLUMN entity_extractions.source_document_type IS 'Document type this entity was extracted from';
COMMENT ON COLUMN entity_extractions.authority_level IS 'Authority level of the source document for this entity';

-- ============================================================================
-- END MIGRATION 009
-- ============================================================================
