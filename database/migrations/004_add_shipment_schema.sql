-- ============================================================================
-- MIGRATION 004: ADD SHIPMENT SCHEMA (Layer 3 - Decision Support)
-- ============================================================================
-- Purpose: Create shipment-centric schema to link emails and track shipments
-- Author: AI Intelligence System
-- Date: 2025-12-25
-- Dependencies: Migrations 001, 002, 003 must be applied first
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE 1: carriers
-- Master table for shipping carriers (Maersk, Hapag Lloyd, etc.)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_name VARCHAR(200) NOT NULL,
  carrier_code VARCHAR(50) UNIQUE NOT NULL, -- 'MAERSK', 'HAPAG', 'CMA'
  email_domains TEXT[], -- {'maersk.com', 'maerskline.com'}
  website_url VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_carriers_code ON carriers(carrier_code);

COMMENT ON TABLE carriers IS 'Master list of shipping carriers';
COMMENT ON COLUMN carriers.email_domains IS 'Email domains used by carrier for automated matching';

-- ----------------------------------------------------------------------------
-- TABLE 2: parties
-- Shippers, consignees, notify parties, freight forwarders
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_name VARCHAR(500) NOT NULL,
  party_type VARCHAR(50) NOT NULL CHECK (party_type IN ('shipper', 'consignee', 'notify_party', 'freight_forwarder', 'customs_broker')),
  address TEXT,
  city VARCHAR(200),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  tax_id VARCHAR(100), -- For customs/compliance
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_parties_name ON parties(party_name);
CREATE INDEX idx_parties_type ON parties(party_type);
CREATE INDEX idx_parties_email ON parties(contact_email);

COMMENT ON TABLE parties IS 'Business parties involved in shipments';
COMMENT ON COLUMN parties.party_type IS 'Role of party in shipment';

-- ----------------------------------------------------------------------------
-- TABLE 3: shipments
-- Master shipment records tracking cargo from origin to destination
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifiers (at least one required)
  booking_number VARCHAR(100) UNIQUE,
  bl_number VARCHAR(100) UNIQUE,
  container_number_primary VARCHAR(100), -- Primary container if multi-container

  -- Parties
  shipper_id UUID REFERENCES parties(id),
  consignee_id UUID REFERENCES parties(id),
  notify_party_id UUID REFERENCES parties(id),
  carrier_id UUID REFERENCES carriers(id),

  -- Voyage information
  vessel_name VARCHAR(200),
  voyage_number VARCHAR(100),

  -- Locations
  port_of_loading VARCHAR(200),
  port_of_loading_code VARCHAR(10), -- UNLOC code
  port_of_discharge VARCHAR(200),
  port_of_discharge_code VARCHAR(10),
  place_of_receipt VARCHAR(200),
  place_of_delivery VARCHAR(200),

  -- Dates
  etd DATE, -- Estimated Time of Departure
  eta DATE, -- Estimated Time of Arrival
  atd DATE, -- Actual Time of Departure
  ata DATE, -- Actual Time of Arrival
  cargo_ready_date DATE,

  -- Cargo details
  commodity_description TEXT,
  total_weight NUMERIC(12,2),
  total_volume NUMERIC(12,2),
  weight_unit VARCHAR(10) CHECK (weight_unit IN ('KG', 'LB', 'MT')),
  volume_unit VARCHAR(10) CHECK (volume_unit IN ('CBM', 'CFT')),

  -- Commercial terms
  incoterms VARCHAR(10), -- FOB, CIF, EXW, etc.
  freight_terms VARCHAR(50), -- Prepaid, Collect

  -- Status tracking
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'booked', 'in_transit', 'arrived', 'delivered', 'cancelled')),
  status_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Metadata
  created_from_email_id UUID REFERENCES raw_emails(id), -- First email that created this shipment
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Constraints: At least one identifier must be present
ALTER TABLE shipments ADD CONSTRAINT shipments_require_identifier
  CHECK (booking_number IS NOT NULL OR bl_number IS NOT NULL OR container_number_primary IS NOT NULL);

-- Indexes for fast lookups
CREATE INDEX idx_shipments_booking ON shipments(booking_number) WHERE booking_number IS NOT NULL;
CREATE INDEX idx_shipments_bl ON shipments(bl_number) WHERE bl_number IS NOT NULL;
CREATE INDEX idx_shipments_container ON shipments(container_number_primary) WHERE container_number_primary IS NOT NULL;
CREATE INDEX idx_shipments_shipper ON shipments(shipper_id);
CREATE INDEX idx_shipments_consignee ON shipments(consignee_id);
CREATE INDEX idx_shipments_carrier ON shipments(carrier_id);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_shipments_etd ON shipments(etd);
CREATE INDEX idx_shipments_eta ON shipments(eta);

COMMENT ON TABLE shipments IS 'Master shipment records tracking cargo from booking to delivery';
COMMENT ON COLUMN shipments.status IS 'Current shipment lifecycle status';

-- ----------------------------------------------------------------------------
-- TABLE 4: shipment_documents
-- Links emails and documents to shipments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  email_id UUID NOT NULL REFERENCES raw_emails(id),
  classification_id UUID REFERENCES document_classifications(id),

  -- Document metadata
  document_type VARCHAR(100) NOT NULL, -- booking_confirmation, bl, invoice, etc.
  document_date DATE,
  document_number VARCHAR(200), -- Invoice #, BL #, etc.

  -- Linking metadata
  is_primary BOOLEAN DEFAULT false, -- Is this the definitive document for this type?
  link_confidence_score INTEGER CHECK (link_confidence_score >= 0 AND link_confidence_score <= 100),
  link_method VARCHAR(50) DEFAULT 'ai' CHECK (link_method IN ('ai', 'manual', 'regex')),
  linked_by UUID, -- User ID if manual link
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Only one primary document per type per shipment
CREATE UNIQUE INDEX idx_shipment_docs_primary ON shipment_documents(shipment_id, document_type)
  WHERE is_primary = true;

CREATE INDEX idx_shipment_docs_shipment ON shipment_documents(shipment_id);
CREATE INDEX idx_shipment_docs_email ON shipment_documents(email_id);
CREATE INDEX idx_shipment_docs_type ON shipment_documents(document_type);

COMMENT ON TABLE shipment_documents IS 'Links emails/documents to shipments with confidence scoring';
COMMENT ON COLUMN shipment_documents.is_primary IS 'Only one primary document per type allowed per shipment';

-- ----------------------------------------------------------------------------
-- TABLE 5: shipment_containers
-- Container-level tracking for shipments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Container identification
  container_number VARCHAR(100) NOT NULL,
  container_type VARCHAR(50), -- '20GP', '40HC', '45HC', 'REEFER'
  iso_type_code VARCHAR(10), -- ISO 6346 code

  -- Seals
  seal_number VARCHAR(100),
  seal_type VARCHAR(50),

  -- Weights
  tare_weight NUMERIC(12,2), -- Empty container weight
  gross_weight NUMERIC(12,2), -- Total weight
  net_weight NUMERIC(12,2), -- Cargo weight
  weight_unit VARCHAR(10) CHECK (weight_unit IN ('KG', 'LB', 'MT')),

  -- Dimensions (for special cargo)
  length NUMERIC(8,2),
  width NUMERIC(8,2),
  height NUMERIC(8,2),
  dimension_unit VARCHAR(10) CHECK (dimension_unit IN ('M', 'FT')),

  -- Special requirements
  is_reefer BOOLEAN DEFAULT false,
  temperature_setting NUMERIC(5,2),
  temperature_unit VARCHAR(1) CHECK (temperature_unit IN ('C', 'F')),
  is_hazmat BOOLEAN DEFAULT false,
  hazmat_un_number VARCHAR(10),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shipment_containers_shipment ON shipment_containers(shipment_id);
CREATE INDEX idx_shipment_containers_number ON shipment_containers(container_number);

COMMENT ON TABLE shipment_containers IS 'Container-level details for multi-container shipments';

-- ----------------------------------------------------------------------------
-- TABLE 6: shipment_events
-- Timeline of events for shipment tracking
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Event details
  event_type VARCHAR(100) NOT NULL, -- 'booking_created', 'departure', 'arrival', 'customs_clearance', 'delivered'
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  location VARCHAR(200),
  location_code VARCHAR(10), -- UNLOC code
  description TEXT,

  -- Source tracking
  source_type VARCHAR(50) DEFAULT 'email' CHECK (source_type IN ('email', 'api', 'manual', 'carrier_update')),
  source_email_id UUID REFERENCES raw_emails(id),
  source_user_id UUID, -- If manually entered

  -- Metadata
  is_milestone BOOLEAN DEFAULT false, -- Major events vs minor updates
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shipment_events_shipment ON shipment_events(shipment_id);
CREATE INDEX idx_shipment_events_date ON shipment_events(event_date);
CREATE INDEX idx_shipment_events_type ON shipment_events(event_type);
CREATE INDEX idx_shipment_events_milestone ON shipment_events(is_milestone) WHERE is_milestone = true;

COMMENT ON TABLE shipment_events IS 'Timeline of shipment lifecycle events';
COMMENT ON COLUMN shipment_events.is_milestone IS 'Flags major events for timeline visualization';

-- ----------------------------------------------------------------------------
-- TABLE 7: shipment_financials
-- Financial records associated with shipments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Invoice details
  invoice_id UUID REFERENCES raw_emails(id), -- Email containing invoice
  invoice_number VARCHAR(100),
  invoice_date DATE,
  invoice_type VARCHAR(50) CHECK (invoice_type IN ('freight', 'customs', 'detention', 'demurrage', 'storage', 'other')),

  -- Amount
  amount NUMERIC(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL, -- ISO 4217: USD, EUR, CNY

  -- Payment tracking
  payment_terms VARCHAR(100), -- 'NET 30', 'Due on receipt'
  payment_due_date DATE,
  payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue', 'disputed', 'cancelled')),
  paid_date DATE,
  paid_amount NUMERIC(12,2),

  -- Notes
  description TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shipment_financials_shipment ON shipment_financials(shipment_id);
CREATE INDEX idx_shipment_financials_invoice ON shipment_financials(invoice_number);
CREATE INDEX idx_shipment_financials_status ON shipment_financials(payment_status);
CREATE INDEX idx_shipment_financials_due_date ON shipment_financials(payment_due_date);

COMMENT ON TABLE shipment_financials IS 'Financial records and invoices for shipments';

-- ----------------------------------------------------------------------------
-- TABLE 8: shipment_link_candidates
-- AI-generated linking suggestions for manual review
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_link_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES raw_emails(id),
  shipment_id UUID REFERENCES shipments(id),

  -- Linking metadata
  link_type VARCHAR(50) NOT NULL, -- 'booking_number', 'bl_number', 'container_number', 'entity_match'
  matched_value TEXT NOT NULL, -- The value that matched
  confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  match_reasoning TEXT, -- Why AI thinks this is a match

  -- Review status
  is_confirmed BOOLEAN DEFAULT false,
  is_rejected BOOLEAN DEFAULT false,
  confirmed_by UUID,
  confirmed_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_link_candidates_email ON shipment_link_candidates(email_id);
CREATE INDEX idx_link_candidates_shipment ON shipment_link_candidates(shipment_id);
CREATE INDEX idx_link_candidates_pending ON shipment_link_candidates(is_confirmed, is_rejected)
  WHERE is_confirmed = false AND is_rejected = false;
CREATE INDEX idx_link_candidates_confidence ON shipment_link_candidates(confidence_score DESC);

COMMENT ON TABLE shipment_link_candidates IS 'AI linking suggestions requiring manual review';
COMMENT ON COLUMN shipment_link_candidates.confidence_score IS 'AI confidence in match (0-100), <85 requires review';

-- ----------------------------------------------------------------------------
-- TABLE 9: shipment_audit_log
-- Comprehensive audit trail for all shipment changes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shipment_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- What changed
  action VARCHAR(50) NOT NULL CHECK (action IN ('created', 'updated', 'status_changed', 'document_linked', 'document_unlinked', 'deleted')),
  changed_fields JSONB, -- Field-level change tracking: {"etd": {"old": "2025-01-01", "new": "2025-01-05"}}
  change_summary TEXT,

  -- Why it changed
  source VARCHAR(50) NOT NULL CHECK (source IN ('email', 'manual', 'api', 'ai_linking', 'carrier_update')),
  source_email_id UUID REFERENCES raw_emails(id),
  source_user_id UUID,

  -- When it changed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shipment_audit_shipment ON shipment_audit_log(shipment_id);
CREATE INDEX idx_shipment_audit_created ON shipment_audit_log(created_at DESC);
CREATE INDEX idx_shipment_audit_action ON shipment_audit_log(action);

COMMENT ON TABLE shipment_audit_log IS 'Complete audit trail for shipment changes (compliance & debugging)';
COMMENT ON COLUMN shipment_audit_log.changed_fields IS 'JSON object tracking old vs new values for each field';

-- ----------------------------------------------------------------------------
-- FUNCTIONS: Auto-update timestamps
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_shipment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_shipments_updated_at
  BEFORE UPDATE ON shipments
  FOR EACH ROW
  EXECUTE FUNCTION update_shipment_updated_at();

CREATE TRIGGER trigger_carriers_updated_at
  BEFORE UPDATE ON carriers
  FOR EACH ROW
  EXECUTE FUNCTION update_shipment_updated_at();

CREATE TRIGGER trigger_parties_updated_at
  BEFORE UPDATE ON parties
  FOR EACH ROW
  EXECUTE FUNCTION update_shipment_updated_at();

CREATE TRIGGER trigger_shipment_containers_updated_at
  BEFORE UPDATE ON shipment_containers
  FOR EACH ROW
  EXECUTE FUNCTION update_shipment_updated_at();

CREATE TRIGGER trigger_shipment_financials_updated_at
  BEFORE UPDATE ON shipment_financials
  FOR EACH ROW
  EXECUTE FUNCTION update_shipment_updated_at();

-- ----------------------------------------------------------------------------
-- SEED DATA: Insert common carriers
-- ----------------------------------------------------------------------------
INSERT INTO carriers (carrier_name, carrier_code, email_domains, website_url) VALUES
  ('Maersk Line', 'MAERSK', ARRAY['maersk.com', 'maerskline.com'], 'https://www.maersk.com'),
  ('Hapag-Lloyd', 'HAPAG', ARRAY['hlag.com', 'hapag-lloyd.com'], 'https://www.hapag-lloyd.com'),
  ('CMA CGM', 'CMACGM', ARRAY['cma-cgm.com'], 'https://www.cma-cgm.com'),
  ('MSC', 'MSC', ARRAY['msc.com'], 'https://www.msc.com'),
  ('COSCO Shipping', 'COSCO', ARRAY['coscon.com', 'cosco-shipping.com'], 'https://www.cosco-shipping.com')
ON CONFLICT (carrier_code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- GRANT PERMISSIONS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION 004
-- ============================================================================
-- Next steps:
-- 1. Create shipment linking service (lib/services/shipment-linking-service.ts)
-- 2. Create shipment API routes (app/api/shipments/*)
-- 3. Build shipment UI pages (app/shipments/*)
-- ============================================================================
