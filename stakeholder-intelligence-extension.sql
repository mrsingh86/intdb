-- ============================================================================
-- STAKEHOLDER INTELLIGENCE EXTENSION
-- ============================================================================
-- Extends freight intelligence schema with customer, shipper, and stakeholder data
-- Includes AI-powered relationship intelligence and performance tracking
-- ============================================================================

-- ============================================================================
-- MASTER DATA: Customers, Shippers, Vendors
-- ============================================================================

-- Customer master data
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Customer Identifiers
  customer_code VARCHAR(50) UNIQUE NOT NULL,        -- Your internal customer code
  customer_name VARCHAR(500) NOT NULL,
  customer_legal_name VARCHAR(500),

  -- Customer Type
  customer_type VARCHAR(50) NOT NULL,               -- direct, freight_forwarder, nvocc, shipper
  customer_segment VARCHAR(50),                     -- enterprise, sme, startup
  industry VARCHAR(200),                            -- electronics, automotive, pharma, etc.

  -- Contact Information
  primary_contact_name VARCHAR(500),
  primary_contact_email VARCHAR(500),
  primary_contact_phone VARCHAR(100),

  -- Company Details
  company_website VARCHAR(500),
  company_address TEXT,
  company_city VARCHAR(200),
  company_state VARCHAR(200),
  company_country VARCHAR(100),
  company_postal_code VARCHAR(20),

  -- Tax & Legal
  tax_id VARCHAR(100),                              -- GST, PAN, VAT
  iec_code VARCHAR(100),                            -- Import Export Code
  company_registration_number VARCHAR(100),

  -- Banking (for payments)
  bank_name VARCHAR(200),
  bank_account_number VARCHAR(100),
  bank_ifsc_code VARCHAR(20),

  -- Business Details
  credit_limit DECIMAL(12,2),
  credit_days INTEGER DEFAULT 30,
  payment_terms VARCHAR(100),
  preferred_currency VARCHAR(10) DEFAULT 'INR',

  -- Status
  status VARCHAR(50) DEFAULT 'active',              -- active, inactive, suspended, blacklisted
  risk_level VARCHAR(20) DEFAULT 'low',             -- low, medium, high

  -- Performance Metrics (updated by AI)
  total_shipments INTEGER DEFAULT 0,
  total_revenue DECIMAL(12,2) DEFAULT 0,
  average_shipment_value DECIMAL(12,2),
  on_time_payment_rate DECIMAL(5,2),                -- Percentage

  -- AI-Generated Insights
  customer_preferences JSONB,                       -- {"preferred_carriers": ["maersk"], "avg_lead_time": 7}
  communication_style JSONB,                        -- {"response_time_hours": 2, "preferred_channel": "email"}

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,

  -- Source tracking (if created from email)
  created_from_email_id UUID REFERENCES raw_emails(id)
);

CREATE INDEX idx_customers_code ON customers(customer_code);
CREATE INDEX idx_customers_name ON customers(customer_name);
CREATE INDEX idx_customers_status ON customers(status);
CREATE INDEX idx_customers_type ON customers(customer_type);
CREATE INDEX idx_customers_segment ON customers(customer_segment);
CREATE INDEX idx_customers_preferences ON customers USING GIN(customer_preferences);

COMMENT ON TABLE customers IS 'Customer master data with AI-powered intelligence and performance tracking.';


-- Shipper/Consignee/Notify Party master data
CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Party Identifiers
  party_code VARCHAR(50) UNIQUE,                    -- Auto-generated or manual
  party_name VARCHAR(500) NOT NULL,
  party_legal_name VARCHAR(500),

  -- Party Type
  party_type VARCHAR(50) NOT NULL,                  -- shipper, consignee, notify_party, both

  -- Contact Information
  contact_person VARCHAR(500),
  contact_email VARCHAR(500),
  contact_phone VARCHAR(100),
  contact_mobile VARCHAR(100),

  -- Address
  address_line1 TEXT,
  address_line2 TEXT,
  city VARCHAR(200),
  state VARCHAR(200),
  country VARCHAR(100),
  postal_code VARCHAR(20),

  -- Tax & Legal
  tax_id VARCHAR(100),
  iec_code VARCHAR(100),

  -- Linked Customer
  customer_id UUID REFERENCES customers(id),        -- Which customer does this party belong to?

  -- Status
  status VARCHAR(50) DEFAULT 'active',

  -- Usage Statistics (AI-updated)
  times_used_as_shipper INTEGER DEFAULT 0,
  times_used_as_consignee INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,

  -- AI-Generated Insights
  common_commodities TEXT[],                        -- ["electronics", "automotive parts"]
  average_shipment_size DECIMAL(12,2),              -- CBM
  typical_destinations TEXT[],                      -- ["USLAX", "DEHAM"]

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,

  -- Source tracking
  created_from_email_id UUID REFERENCES raw_emails(id)
);

CREATE INDEX idx_parties_code ON parties(party_code);
CREATE INDEX idx_parties_name ON parties(party_name);
CREATE INDEX idx_parties_type ON parties(party_type);
CREATE INDEX idx_parties_customer ON parties(customer_id);
CREATE INDEX idx_parties_status ON parties(status);

COMMENT ON TABLE parties IS 'Shipper, consignee, notify party master data with usage intelligence.';


-- Vendor master data (carriers, truckers, CHA, etc.)
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vendor Identifiers
  vendor_code VARCHAR(50) UNIQUE NOT NULL,
  vendor_name VARCHAR(500) NOT NULL,
  vendor_legal_name VARCHAR(500),

  -- Vendor Type
  vendor_type VARCHAR(50) NOT NULL,                 -- carrier, trucker, cha, warehouse, freight_forwarder
  vendor_category VARCHAR(50),                      -- ocean_freight, air_freight, road_transport, customs

  -- Contact Information
  primary_contact_name VARCHAR(500),
  primary_contact_email VARCHAR(500),
  primary_contact_phone VARCHAR(100),

  -- Address
  address TEXT,
  city VARCHAR(200),
  country VARCHAR(100),

  -- Tax & Legal
  tax_id VARCHAR(100),
  pan_number VARCHAR(20),

  -- Banking
  bank_name VARCHAR(200),
  bank_account_number VARCHAR(100),
  bank_ifsc_code VARCHAR(20),

  -- Payment Terms
  payment_terms VARCHAR(100),
  credit_days INTEGER DEFAULT 30,

  -- Status
  status VARCHAR(50) DEFAULT 'active',
  performance_rating DECIMAL(3,2),                  -- 1.00 to 5.00

  -- Performance Metrics (AI-updated)
  total_transactions INTEGER DEFAULT 0,
  total_amount_paid DECIMAL(12,2) DEFAULT 0,
  average_invoice_value DECIMAL(12,2),
  on_time_delivery_rate DECIMAL(5,2),               -- Percentage
  average_response_time_hours DECIMAL(5,2),

  -- AI-Generated Insights
  service_quality_score DECIMAL(5,2),               -- AI-calculated from communications
  common_issues TEXT[],                             -- ["detention charges", "delayed delivery"]
  preferred_for_services TEXT[],                    -- ["FCL to USA", "LCL to Europe"]

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_vendors_code ON vendors(vendor_code);
CREATE INDEX idx_vendors_name ON vendors(vendor_name);
CREATE INDEX idx_vendors_type ON vendors(vendor_type);
CREATE INDEX idx_vendors_status ON vendors(status);
CREATE INDEX idx_vendors_rating ON vendors(performance_rating DESC);

COMMENT ON TABLE vendors IS 'Vendor master data with performance tracking and quality scoring.';


-- ============================================================================
-- STAKEHOLDER INTELLIGENCE: Communication & Relationship Tracking
-- ============================================================================

-- Communication history per customer/party
CREATE TABLE stakeholder_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stakeholder Reference
  customer_id UUID REFERENCES customers(id),
  party_id UUID REFERENCES parties(id),
  vendor_id UUID REFERENCES vendors(id),

  -- Communication Details
  communication_type VARCHAR(50) NOT NULL,          -- email, phone, whatsapp, meeting, issue
  communication_direction VARCHAR(20) NOT NULL,     -- inbound, outbound

  -- Communication Content
  subject TEXT,
  summary TEXT,
  full_content TEXT,

  -- Sentiment Analysis (AI-powered)
  sentiment VARCHAR(20),                            -- positive, neutral, negative, urgent
  sentiment_score DECIMAL(5,2),                     -- -1.00 to 1.00
  urgency_level VARCHAR(20),                        -- low, medium, high, critical

  -- Classification (AI-powered)
  topic_category VARCHAR(100),                      -- quote_request, booking, issue, payment, documentation
  key_topics TEXT[],                                -- ["ETD delay", "rate negotiation"]
  action_items JSONB,                               -- [{"action": "Send rate quote", "due_date": "2025-01-15"}]

  -- Source Reference
  source_email_id UUID REFERENCES raw_emails(id),
  shipment_id UUID REFERENCES shipments(id),        -- Linked shipment if applicable

  -- Response Tracking
  requires_response BOOLEAN DEFAULT false,
  response_deadline TIMESTAMP,
  responded_at TIMESTAMP,
  response_time_hours DECIMAL(5,2),

  -- Metadata
  communication_timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,

  CHECK (customer_id IS NOT NULL OR party_id IS NOT NULL OR vendor_id IS NOT NULL)
);

CREATE INDEX idx_comm_customer ON stakeholder_communications(customer_id);
CREATE INDEX idx_comm_party ON stakeholder_communications(party_id);
CREATE INDEX idx_comm_vendor ON stakeholder_communications(vendor_id);
CREATE INDEX idx_comm_type ON stakeholder_communications(communication_type);
CREATE INDEX idx_comm_sentiment ON stakeholder_communications(sentiment);
CREATE INDEX idx_comm_timestamp ON stakeholder_communications(communication_timestamp DESC);
CREATE INDEX idx_comm_needs_response ON stakeholder_communications(requires_response) WHERE requires_response = true;

COMMENT ON TABLE stakeholder_communications IS 'Complete communication history with AI sentiment analysis and topic classification.';


-- Customer preferences and intelligence
CREATE TABLE customer_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Preference Type
  preference_category VARCHAR(100) NOT NULL,        -- carrier, routing, documentation, communication, pricing

  -- Preference Data
  preference_data JSONB NOT NULL,                   -- {"preferred_carriers": ["maersk", "msc"], "reasons": ["better rates", "reliable schedule"]}

  -- Confidence & Source
  confidence_score DECIMAL(5,2) NOT NULL,           -- How confident is AI about this preference?
  learned_from VARCHAR(50) NOT NULL,                -- email_analysis, manual_input, shipment_history
  evidence_count INTEGER DEFAULT 1,                 -- How many times observed?

  -- AI Model Info
  model_name VARCHAR(100),
  detected_at TIMESTAMP DEFAULT NOW(),

  -- Status
  is_active BOOLEAN DEFAULT true,
  verified_by_human BOOLEAN DEFAULT false,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cust_intel_customer ON customer_intelligence(customer_id);
CREATE INDEX idx_cust_intel_category ON customer_intelligence(preference_category);
CREATE INDEX idx_cust_intel_active ON customer_intelligence(is_active) WHERE is_active = true;

COMMENT ON TABLE customer_intelligence IS 'AI-learned customer preferences and intelligence.';


-- Vendor performance tracking
CREATE TABLE vendor_performance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  -- Performance Event
  event_type VARCHAR(100) NOT NULL,                 -- on_time_delivery, delayed_delivery, invoice_accuracy, issue_resolution
  event_category VARCHAR(50) NOT NULL,              -- service_quality, pricing, reliability, communication

  -- Performance Data
  performance_rating DECIMAL(3,2),                  -- 1.00 to 5.00
  expected_value TEXT,                              -- "2025-01-15 delivery"
  actual_value TEXT,                                -- "2025-01-18 delivery"
  variance_value TEXT,                              -- "3 days late"

  -- Context
  shipment_id UUID REFERENCES shipments(id),
  source_email_id UUID REFERENCES raw_emails(id),
  description TEXT,

  -- Financial Impact
  cost_impact DECIMAL(12,2),                        -- Detention charges, etc.

  -- Metadata
  event_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_vendor_perf_vendor ON vendor_performance_log(vendor_id);
CREATE INDEX idx_vendor_perf_type ON vendor_performance_log(event_type);
CREATE INDEX idx_vendor_perf_date ON vendor_performance_log(event_date DESC);
CREATE INDEX idx_vendor_perf_rating ON vendor_performance_log(performance_rating);

COMMENT ON TABLE vendor_performance_log IS 'Vendor performance tracking for quality scoring.';


-- ============================================================================
-- STAKEHOLDER RELATIONSHIPS & NETWORK INTELLIGENCE
-- ============================================================================

-- Track relationships between customers and parties
CREATE TABLE customer_party_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,

  -- Relationship Type
  relationship_type VARCHAR(50) NOT NULL,           -- regular_shipper, regular_consignee, occasional

  -- Usage Statistics
  times_used_together INTEGER DEFAULT 1,
  first_used_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW(),

  -- AI Insights
  typical_trade_lane VARCHAR(200),                  -- "India to USA"
  typical_commodity VARCHAR(200),
  average_shipment_frequency_days INTEGER,          -- Ships every X days

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (customer_id, party_id)
);

CREATE INDEX idx_rel_customer ON customer_party_relationships(customer_id);
CREATE INDEX idx_rel_party ON customer_party_relationships(party_id);
CREATE INDEX idx_rel_type ON customer_party_relationships(relationship_type);

COMMENT ON TABLE customer_party_relationships IS 'Track customer-party relationships and usage patterns.';


-- Contact persons per customer/vendor
CREATE TABLE contact_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linked Entity
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  party_id UUID REFERENCES parties(id) ON DELETE CASCADE,

  -- Contact Details
  full_name VARCHAR(500) NOT NULL,
  job_title VARCHAR(200),
  department VARCHAR(100),

  -- Contact Information
  email VARCHAR(500),
  phone VARCHAR(100),
  mobile VARCHAR(100),
  whatsapp VARCHAR(100),

  -- Communication Preferences
  preferred_channel VARCHAR(50),                    -- email, phone, whatsapp
  best_time_to_contact VARCHAR(100),                -- "9am-5pm IST"
  language_preference VARCHAR(50),

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Communication Stats (AI-updated)
  total_communications INTEGER DEFAULT 0,
  average_response_time_hours DECIMAL(5,2),
  last_contacted_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CHECK (customer_id IS NOT NULL OR vendor_id IS NOT NULL OR party_id IS NOT NULL)
);

CREATE INDEX idx_contact_customer ON contact_persons(customer_id);
CREATE INDEX idx_contact_vendor ON contact_persons(vendor_id);
CREATE INDEX idx_contact_party ON contact_persons(party_id);
CREATE INDEX idx_contact_email ON contact_persons(email);
CREATE INDEX idx_contact_primary ON contact_persons(is_primary) WHERE is_primary = true;

COMMENT ON TABLE contact_persons IS 'Contact persons for customers, vendors, and parties.';


-- ============================================================================
-- EXTEND EXISTING TABLES WITH STAKEHOLDER LINKS
-- ============================================================================

-- Add customer/vendor foreign keys to shipments table
ALTER TABLE shipments
  ADD COLUMN customer_id_fk UUID REFERENCES customers(id),
  ADD COLUMN primary_vendor_id UUID REFERENCES vendors(id);

CREATE INDEX idx_shipments_customer_fk ON shipments(customer_id_fk);
CREATE INDEX idx_shipments_vendor_fk ON shipments(primary_vendor_id);

COMMENT ON COLUMN shipments.customer_id_fk IS 'Foreign key to customers master table';
COMMENT ON COLUMN shipments.primary_vendor_id IS 'Primary carrier/vendor for this shipment';


-- Add vendor foreign key to shipment_financials
ALTER TABLE shipment_financials
  ADD COLUMN vendor_id UUID REFERENCES vendors(id);

CREATE INDEX idx_ship_fin_vendor_fk ON shipment_financials(vendor_id);


-- Update shipment_parties to use party master data
ALTER TABLE shipment_parties
  ADD COLUMN party_id_fk UUID REFERENCES parties(id);

CREATE INDEX idx_ship_parties_fk ON shipment_parties(party_id_fk);

COMMENT ON COLUMN shipment_parties.party_id_fk IS 'Foreign key to parties master table';


-- ============================================================================
-- AI INTELLIGENCE FUNCTIONS
-- ============================================================================

-- Function: Update customer performance metrics
CREATE OR REPLACE FUNCTION update_customer_metrics(p_customer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_total_shipments INTEGER;
  v_total_revenue DECIMAL(12,2);
  v_avg_shipment_value DECIMAL(12,2);
  v_on_time_payment_rate DECIMAL(5,2);
BEGIN
  -- Calculate total shipments
  SELECT COUNT(*) INTO v_total_shipments
  FROM shipments
  WHERE customer_id_fk = p_customer_id;

  -- Calculate total revenue
  SELECT COALESCE(SUM(total_revenue), 0) INTO v_total_revenue
  FROM shipments
  WHERE customer_id_fk = p_customer_id;

  -- Calculate average shipment value
  v_avg_shipment_value := CASE
    WHEN v_total_shipments > 0 THEN v_total_revenue / v_total_shipments
    ELSE 0
  END;

  -- Calculate on-time payment rate
  SELECT
    COALESCE(
      COUNT(*) FILTER (WHERE payment_status = 'paid' AND payment_date <= invoice_date + INTERVAL '30 days')::DECIMAL
      / NULLIF(COUNT(*) FILTER (WHERE payment_status = 'paid'), 0) * 100,
      0
    ) INTO v_on_time_payment_rate
  FROM shipment_financials sf
  JOIN shipments s ON s.id = sf.shipment_id
  WHERE s.customer_id_fk = p_customer_id
    AND sf.transaction_type = 'revenue';

  -- Update customer metrics
  UPDATE customers
  SET
    total_shipments = v_total_shipments,
    total_revenue = v_total_revenue,
    average_shipment_value = v_avg_shipment_value,
    on_time_payment_rate = v_on_time_payment_rate,
    updated_at = NOW()
  WHERE id = p_customer_id;

  -- Return summary
  v_result := jsonb_build_object(
    'customer_id', p_customer_id,
    'total_shipments', v_total_shipments,
    'total_revenue', v_total_revenue,
    'avg_shipment_value', v_avg_shipment_value,
    'on_time_payment_rate', v_on_time_payment_rate
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_customer_metrics IS 'Updates customer performance metrics based on shipment data.';


-- Function: Calculate vendor performance score
CREATE OR REPLACE FUNCTION calculate_vendor_performance(p_vendor_id UUID)
RETURNS DECIMAL(3,2) AS $$
DECLARE
  v_score DECIMAL(3,2);
  v_on_time_rate DECIMAL(5,2);
  v_avg_rating DECIMAL(3,2);
BEGIN
  -- Calculate on-time delivery rate
  SELECT
    COALESCE(
      COUNT(*) FILTER (WHERE event_type = 'on_time_delivery')::DECIMAL
      / NULLIF(COUNT(*), 0) * 100,
      0
    ) INTO v_on_time_rate
  FROM vendor_performance_log
  WHERE vendor_id = p_vendor_id
    AND event_date > NOW() - INTERVAL '6 months';

  -- Calculate average performance rating
  SELECT COALESCE(AVG(performance_rating), 3.0) INTO v_avg_rating
  FROM vendor_performance_log
  WHERE vendor_id = p_vendor_id
    AND performance_rating IS NOT NULL
    AND event_date > NOW() - INTERVAL '6 months';

  -- Weighted score: 60% rating + 40% on-time
  v_score := (v_avg_rating * 0.6) + ((v_on_time_rate / 100 * 5) * 0.4);

  -- Update vendor record
  UPDATE vendors
  SET
    performance_rating = v_score,
    on_time_delivery_rate = v_on_time_rate,
    updated_at = NOW()
  WHERE id = p_vendor_id;

  RETURN v_score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_vendor_performance IS 'Calculates vendor performance score from performance log.';


-- Function: Detect customer preferences from shipment history
CREATE OR REPLACE FUNCTION detect_customer_preferences(p_customer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_preferences JSONB;
  v_preferred_carriers TEXT[];
  v_preferred_routes TEXT[];
  v_avg_lead_time INTEGER;
BEGIN
  -- Detect preferred carriers (top 3 most used)
  SELECT ARRAY_AGG(carrier_id ORDER BY cnt DESC)
  INTO v_preferred_carriers
  FROM (
    SELECT carrier_id, COUNT(*) as cnt
    FROM shipments
    WHERE customer_id_fk = p_customer_id
      AND carrier_id IS NOT NULL
    GROUP BY carrier_id
    ORDER BY cnt DESC
    LIMIT 3
  ) t;

  -- Detect preferred routes
  SELECT ARRAY_AGG(DISTINCT port_of_loading_code || '-' || port_of_discharge_code)
  INTO v_preferred_routes
  FROM shipments
  WHERE customer_id_fk = p_customer_id
    AND port_of_loading_code IS NOT NULL
    AND port_of_discharge_code IS NOT NULL;

  -- Calculate average lead time (booking to ETD)
  SELECT COALESCE(AVG(EXTRACT(DAY FROM (etd - created_at::date))), 7)::INTEGER
  INTO v_avg_lead_time
  FROM shipments
  WHERE customer_id_fk = p_customer_id
    AND etd IS NOT NULL;

  -- Build preferences JSON
  v_preferences := jsonb_build_object(
    'preferred_carriers', v_preferred_carriers,
    'preferred_routes', v_preferred_routes,
    'avg_lead_time_days', v_avg_lead_time,
    'total_shipments', (SELECT COUNT(*) FROM shipments WHERE customer_id_fk = p_customer_id)
  );

  -- Update customer record
  UPDATE customers
  SET customer_preferences = v_preferences,
      updated_at = NOW()
  WHERE id = p_customer_id;

  RETURN v_preferences;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION detect_customer_preferences IS 'AI-powered detection of customer preferences from shipment history.';


-- ============================================================================
-- VIEWS FOR STAKEHOLDER INTELLIGENCE
-- ============================================================================

-- View: Customer 360 (complete customer profile)
CREATE OR REPLACE VIEW customer_360 AS
SELECT
  c.id,
  c.customer_code,
  c.customer_name,
  c.customer_type,
  c.status,
  c.total_shipments,
  c.total_revenue,
  c.average_shipment_value,
  c.on_time_payment_rate,
  c.customer_preferences,

  -- Recent activity
  (SELECT MAX(created_at) FROM shipments WHERE customer_id_fk = c.id) as last_shipment_date,
  (SELECT COUNT(*) FROM shipments WHERE customer_id_fk = c.id AND created_at > NOW() - INTERVAL '30 days') as shipments_last_30_days,

  -- Communication stats
  (SELECT COUNT(*) FROM stakeholder_communications WHERE customer_id = c.id) as total_communications,
  (SELECT AVG(response_time_hours) FROM stakeholder_communications WHERE customer_id = c.id AND response_time_hours IS NOT NULL) as avg_response_time_hours,
  (SELECT COUNT(*) FROM stakeholder_communications WHERE customer_id = c.id AND sentiment = 'negative') as negative_interactions,

  -- Active shipments
  (SELECT COUNT(*) FROM shipments WHERE customer_id_fk = c.id AND lifecycle_stage = 'active') as active_shipments,

  -- Outstanding payments
  (SELECT COUNT(*) FROM shipment_financials sf JOIN shipments s ON s.id = sf.shipment_id WHERE s.customer_id_fk = c.id AND sf.payment_status = 'pending') as pending_invoices
FROM customers c;

COMMENT ON VIEW customer_360 IS 'Complete 360-degree customer profile with intelligence.';


-- View: Vendor scorecard
CREATE OR REPLACE VIEW vendor_scorecard AS
SELECT
  v.id,
  v.vendor_code,
  v.vendor_name,
  v.vendor_type,
  v.performance_rating,
  v.on_time_delivery_rate,
  v.total_transactions,
  v.total_amount_paid,
  v.average_invoice_value,

  -- Recent performance
  (SELECT COUNT(*) FROM vendor_performance_log WHERE vendor_id = v.id AND event_date > NOW() - INTERVAL '30 days') as events_last_30_days,
  (SELECT AVG(performance_rating) FROM vendor_performance_log WHERE vendor_id = v.id AND event_date > NOW() - INTERVAL '90 days') as rating_last_90_days,
  (SELECT COUNT(*) FROM vendor_performance_log WHERE vendor_id = v.id AND event_type = 'delayed_delivery' AND event_date > NOW() - INTERVAL '90 days') as delays_last_90_days,

  -- Financial
  (SELECT SUM(amount) FROM shipment_financials WHERE vendor_id = v.id AND payment_status = 'pending') as outstanding_amount,
  (SELECT COUNT(*) FROM shipment_financials WHERE vendor_id = v.id AND payment_status = 'overdue') as overdue_invoices
FROM vendors v;

COMMENT ON VIEW vendor_scorecard IS 'Vendor performance scorecard with recent metrics.';


-- ============================================================================
-- SEED DATA FOR STAKEHOLDERS
-- ============================================================================

-- Seed: Sample customers
INSERT INTO customers (customer_code, customer_name, customer_type, customer_segment, industry, status)
VALUES
  ('CUST001', 'ABC Electronics Pvt Ltd', 'direct', 'enterprise', 'electronics', 'active'),
  ('CUST002', 'XYZ Automotive Inc', 'direct', 'sme', 'automotive', 'active'),
  ('CUST003', 'Global Freight Services', 'freight_forwarder', 'enterprise', 'logistics', 'active');


-- Seed: Sample vendors
INSERT INTO vendors (vendor_code, vendor_name, vendor_type, vendor_category, status, performance_rating)
VALUES
  ('VEN-MAERSK', 'Maersk Line', 'carrier', 'ocean_freight', 'active', 4.50),
  ('VEN-HAPAG', 'Hapag-Lloyd', 'carrier', 'ocean_freight', 'active', 4.20),
  ('VEN-ABC-TRUCK', 'ABC Trucking Services', 'trucker', 'road_transport', 'active', 3.80),
  ('VEN-QUICK-CHA', 'Quick Customs House Agent', 'cha', 'customs', 'active', 4.00);


-- ============================================================================
-- COMPLETION
-- ============================================================================

COMMENT ON SCHEMA public IS 'Freight Intelligence with Stakeholder Intelligence v1.1.0';

SELECT 'Stakeholder Intelligence Extension deployed! 🎯' as status,
       'Added 9 new tables, 3 AI functions, 2 views, seed data' as summary;
