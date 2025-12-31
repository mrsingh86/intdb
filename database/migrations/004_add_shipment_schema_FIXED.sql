-- ============================================================================
-- MIGRATION 004: ADD SHIPMENT SCHEMA (Layer 3 - Decision Support)
-- ============================================================================
-- Clean installation - drops and recreates all Layer 3 tables
-- ============================================================================

-- Drop function first (triggers will be dropped with CASCADE on tables)
DROP FUNCTION IF EXISTS update_shipment_updated_at() CASCADE;

-- Drop tables in reverse dependency order (CASCADE drops all triggers/indexes)
DROP TABLE IF EXISTS shipment_audit_log CASCADE;
DROP TABLE IF EXISTS shipment_link_candidates CASCADE;
DROP TABLE IF EXISTS shipment_financials CASCADE;
DROP TABLE IF EXISTS shipment_events CASCADE;
DROP TABLE IF EXISTS shipment_containers CASCADE;
DROP TABLE IF EXISTS shipment_documents CASCADE;
DROP TABLE IF EXISTS shipments CASCADE;
DROP TABLE IF EXISTS parties CASCADE;
DROP TABLE IF EXISTS carriers CASCADE;

-- ============================================================================
-- CREATE TABLES
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE 1: carriers
-- ----------------------------------------------------------------------------
CREATE TABLE carriers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_name VARCHAR(200) NOT NULL,
  carrier_code VARCHAR(50) UNIQUE NOT NULL,
  email_domains TEXT[],
  website_url VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_carriers_code ON carriers(carrier_code);

-- ----------------------------------------------------------------------------
-- TABLE 2: parties
-- ----------------------------------------------------------------------------
CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_name VARCHAR(500) NOT NULL,
  party_type VARCHAR(50) NOT NULL CHECK (party_type IN ('shipper', 'consignee', 'notify_party', 'freight_forwarder', 'customs_broker')),
  address TEXT,
  city VARCHAR(200),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  tax_id VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_parties_name ON parties(party_name);
CREATE INDEX idx_parties_type ON parties(party_type);
CREATE INDEX idx_parties_email ON parties(contact_email);

-- ----------------------------------------------------------------------------
-- TABLE 3: shipments
-- ----------------------------------------------------------------------------
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_number VARCHAR(100) UNIQUE,
  bl_number VARCHAR(100) UNIQUE,
  container_number_primary VARCHAR(100),

  shipper_id UUID REFERENCES parties(id),
  consignee_id UUID REFERENCES parties(id),
  notify_party_id UUID REFERENCES parties(id),
  carrier_id UUID REFERENCES carriers(id),

  vessel_name VARCHAR(200),
  voyage_number VARCHAR(100),

  port_of_loading VARCHAR(200),
  port_of_loading_code VARCHAR(10),
  port_of_discharge VARCHAR(200),
  port_of_discharge_code VARCHAR(10),
  place_of_receipt VARCHAR(200),
  place_of_delivery VARCHAR(200),

  etd DATE,
  eta DATE,
  atd DATE,
  ata DATE,
  cargo_ready_date DATE,

  commodity_description TEXT,
  total_weight NUMERIC(12,2),
  total_volume NUMERIC(12,2),
  weight_unit VARCHAR(10) CHECK (weight_unit IN ('KG', 'LB', 'MT')),
  volume_unit VARCHAR(10) CHECK (volume_unit IN ('CBM', 'CFT')),

  incoterms VARCHAR(10),
  freight_terms VARCHAR(50),

  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'booked', 'in_transit', 'arrived', 'delivered', 'cancelled')),
  status_updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_from_email_id UUID REFERENCES raw_emails(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT shipments_require_identifier
    CHECK (booking_number IS NOT NULL OR bl_number IS NOT NULL OR container_number_primary IS NOT NULL)
);

CREATE INDEX idx_shipments_booking ON shipments(booking_number) WHERE booking_number IS NOT NULL;
CREATE INDEX idx_shipments_bl ON shipments(bl_number) WHERE bl_number IS NOT NULL;
CREATE INDEX idx_shipments_container ON shipments(container_number_primary) WHERE container_number_primary IS NOT NULL;
CREATE INDEX idx_shipments_shipper ON shipments(shipper_id);
CREATE INDEX idx_shipments_consignee ON shipments(consignee_id);
CREATE INDEX idx_shipments_carrier ON shipments(carrier_id);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_shipments_etd ON shipments(etd);
CREATE INDEX idx_shipments_eta ON shipments(eta);

-- ----------------------------------------------------------------------------
-- TABLE 4: shipment_documents
-- ----------------------------------------------------------------------------
CREATE TABLE shipment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  email_id UUID NOT NULL REFERENCES raw_emails(id),
  classification_id UUID REFERENCES document_classifications(id),

  document_type VARCHAR(100) NOT NULL,
  document_date DATE,
  document_number VARCHAR(200),

  is_primary BOOLEAN DEFAULT false,
  link_confidence_score INTEGER CHECK (link_confidence_score >= 0 AND link_confidence_score <= 100),
  link_method VARCHAR(50) DEFAULT 'ai' CHECK (link_method IN ('ai', 'manual', 'regex')),
  linked_by UUID,
  linked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_shipment_docs_primary ON shipment_documents(shipment_id, document_type)
  WHERE is_primary = true;
CREATE INDEX idx_shipment_docs_shipment ON shipment_documents(shipment_id);
CREATE INDEX idx_shipment_docs_email ON shipment_documents(email_id);
CREATE INDEX idx_shipment_docs_type ON shipment_documents(document_type);

-- ----------------------------------------------------------------------------
-- TABLE 5: shipment_containers
-- ----------------------------------------------------------------------------
CREATE TABLE shipment_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  container_number VARCHAR(100) NOT NULL,
  container_type VARCHAR(50),
  iso_type_code VARCHAR(10),

  seal_number VARCHAR(100),
  seal_type VARCHAR(50),

  tare_weight NUMERIC(12,2),
  gross_weight NUMERIC(12,2),
  net_weight NUMERIC(12,2),
  weight_unit VARCHAR(10) CHECK (weight_unit IN ('KG', 'LB', 'MT')),

  length NUMERIC(8,2),
  width NUMERIC(8,2),
  height NUMERIC(8,2),
  dimension_unit VARCHAR(10) CHECK (dimension_unit IN ('M', 'FT')),

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

-- ----------------------------------------------------------------------------
-- TABLE 6: shipment_events
-- ----------------------------------------------------------------------------
CREATE TABLE shipment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  event_type VARCHAR(100) NOT NULL,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  location VARCHAR(200),
  location_code VARCHAR(10),
  description TEXT,

  source_type VARCHAR(50) DEFAULT 'email' CHECK (source_type IN ('email', 'api', 'manual', 'carrier_update')),
  source_email_id UUID REFERENCES raw_emails(id),
  source_user_id UUID,

  is_milestone BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shipment_events_shipment ON shipment_events(shipment_id);
CREATE INDEX idx_shipment_events_date ON shipment_events(event_date);
CREATE INDEX idx_shipment_events_type ON shipment_events(event_type);
CREATE INDEX idx_shipment_events_milestone ON shipment_events(is_milestone) WHERE is_milestone = true;

-- ----------------------------------------------------------------------------
-- TABLE 7: shipment_financials
-- ----------------------------------------------------------------------------
CREATE TABLE shipment_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  invoice_id UUID REFERENCES raw_emails(id),
  invoice_number VARCHAR(100),
  invoice_date DATE,
  invoice_type VARCHAR(50) CHECK (invoice_type IN ('freight', 'customs', 'detention', 'demurrage', 'storage', 'other')),

  amount NUMERIC(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,

  payment_terms VARCHAR(100),
  payment_due_date DATE,
  payment_status VARCHAR(50) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue', 'disputed', 'cancelled')),
  paid_date DATE,
  paid_amount NUMERIC(12,2),

  description TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shipment_financials_shipment ON shipment_financials(shipment_id);
CREATE INDEX idx_shipment_financials_invoice ON shipment_financials(invoice_number);
CREATE INDEX idx_shipment_financials_status ON shipment_financials(payment_status);
CREATE INDEX idx_shipment_financials_due_date ON shipment_financials(payment_due_date);

-- ----------------------------------------------------------------------------
-- TABLE 8: shipment_link_candidates
-- ----------------------------------------------------------------------------
CREATE TABLE shipment_link_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES raw_emails(id),
  shipment_id UUID REFERENCES shipments(id),

  link_type VARCHAR(50) NOT NULL,
  matched_value TEXT NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  match_reasoning TEXT,

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

-- ----------------------------------------------------------------------------
-- TABLE 9: shipment_audit_log
-- ----------------------------------------------------------------------------
CREATE TABLE shipment_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  action VARCHAR(50) NOT NULL CHECK (action IN ('created', 'updated', 'status_changed', 'document_linked', 'document_unlinked', 'deleted')),
  changed_fields JSONB,
  change_summary TEXT,

  source VARCHAR(50) NOT NULL CHECK (source IN ('email', 'manual', 'api', 'ai_linking', 'carrier_update')),
  source_email_id UUID REFERENCES raw_emails(id),
  source_user_id UUID,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_shipment_audit_shipment ON shipment_audit_log(shipment_id);
CREATE INDEX idx_shipment_audit_created ON shipment_audit_log(created_at DESC);
CREATE INDEX idx_shipment_audit_action ON shipment_audit_log(action);

-- ============================================================================
-- TRIGGERS & FUNCTIONS
-- ============================================================================

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

-- ============================================================================
-- SEED DATA
-- ============================================================================

INSERT INTO carriers (carrier_name, carrier_code, email_domains, website_url) VALUES
  ('Maersk Line', 'MAERSK', ARRAY['maersk.com', 'maerskline.com'], 'https://www.maersk.com'),
  ('Hapag-Lloyd', 'HAPAG', ARRAY['hlag.com', 'hapag-lloyd.com'], 'https://www.hapag-lloyd.com'),
  ('CMA CGM', 'CMACGM', ARRAY['cma-cgm.com'], 'https://www.cma-cgm.com'),
  ('MSC', 'MSC', ARRAY['msc.com'], 'https://www.msc.com'),
  ('COSCO Shipping', 'COSCO', ARRAY['coscon.com', 'cosco-shipping.com'], 'https://www.cosco-shipping.com');

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- ============================================================================
-- MIGRATION COMPLETE ✅
-- ============================================================================
-- Tables created: 9
-- Indexes created: 30+
-- Triggers created: 5
-- Seed records: 5 carriers
-- ============================================================================
