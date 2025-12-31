-- ============================================================================
-- MIGRATION 016: STAKEHOLDER INTELLIGENCE
-- ============================================================================
-- Purpose: Enhance parties table with customer/revenue tracking and add
--          behavior analytics, sentiment analysis, and extraction queue
-- Author: AI Intelligence System
-- Date: 2025-12-26
-- Dependencies: Migration 004 (parties table) must be applied first
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENHANCE PARTIES TABLE: Add customer relationship and analytics columns
-- ----------------------------------------------------------------------------

-- Customer relationship tracking
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS is_customer BOOLEAN DEFAULT false;

ALTER TABLE parties
ADD COLUMN IF NOT EXISTS customer_relationship VARCHAR(50);
-- Values: 'paying_customer', 'shipper_customer', 'consignee_customer'

-- Reliability and behavior metrics
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS reliability_score DECIMAL(5,2);
-- Score 0-100, calculated from on-time rates, response times, etc.

ALTER TABLE parties
ADD COLUMN IF NOT EXISTS response_time_avg_hours DECIMAL(5,2);
-- Average hours to respond to communications

ALTER TABLE parties
ADD COLUMN IF NOT EXISTS documentation_quality_score DECIMAL(5,2);
-- Score 0-100 based on document completeness, accuracy

-- Volume and financial metrics
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS total_shipments INTEGER DEFAULT 0;

ALTER TABLE parties
ADD COLUMN IF NOT EXISTS total_revenue DECIMAL(14,2) DEFAULT 0;
-- Revenue from this stakeholder (if customer)

ALTER TABLE parties
ADD COLUMN IF NOT EXISTS total_cost DECIMAL(14,2) DEFAULT 0;
-- Cost paid to this stakeholder (shipping lines, truckers, etc.)

-- Route intelligence
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS common_routes JSONB DEFAULT '[]';
-- Structure: [{"origin": "CNNBO", "destination": "USLAX", "count": 15}, ...]

-- Email domain matching
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS email_domains TEXT[];
-- For matching incoming emails to stakeholders

-- Comments for new columns
COMMENT ON COLUMN parties.is_customer IS 'True if this party is a paying customer';
COMMENT ON COLUMN parties.customer_relationship IS 'Type of customer relationship';
COMMENT ON COLUMN parties.reliability_score IS 'Calculated reliability score 0-100';
COMMENT ON COLUMN parties.response_time_avg_hours IS 'Average response time in hours';
COMMENT ON COLUMN parties.documentation_quality_score IS 'Document quality score 0-100';
COMMENT ON COLUMN parties.total_shipments IS 'Total shipment count with this party';
COMMENT ON COLUMN parties.total_revenue IS 'Total revenue from this party';
COMMENT ON COLUMN parties.total_cost IS 'Total cost paid to this party';
COMMENT ON COLUMN parties.common_routes IS 'Most common trade routes for this party';
COMMENT ON COLUMN parties.email_domains IS 'Email domains for matching';

-- Index for customer lookups
CREATE INDEX IF NOT EXISTS idx_parties_customer ON parties(is_customer) WHERE is_customer = true;
CREATE INDEX IF NOT EXISTS idx_parties_reliability ON parties(reliability_score DESC NULLS LAST);

-- ----------------------------------------------------------------------------
-- TABLE: stakeholder_behavior_metrics
-- Periodic snapshots of stakeholder performance
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stakeholder_behavior_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,

  -- Period definition
  metric_period VARCHAR(20) NOT NULL CHECK (metric_period IN ('monthly', 'quarterly', 'yearly')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Volume metrics
  shipment_count INTEGER DEFAULT 0,
  container_count INTEGER DEFAULT 0,

  -- Performance metrics
  on_time_rate DECIMAL(5,2),  -- Percentage 0-100
  amendment_count INTEGER DEFAULT 0,
  avg_response_time_hours DECIMAL(5,2),

  -- Financial metrics
  revenue DECIMAL(14,2) DEFAULT 0,
  cost DECIMAL(14,2) DEFAULT 0,

  -- Communication metrics
  email_count INTEGER DEFAULT 0,
  avg_sentiment_score DECIMAL(3,2),  -- Score from -1 to 1

  -- Metadata
  calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique constraint per period
  UNIQUE(party_id, metric_period, period_start)
);

CREATE INDEX IF NOT EXISTS idx_behavior_metrics_party ON stakeholder_behavior_metrics(party_id);
CREATE INDEX IF NOT EXISTS idx_behavior_metrics_period ON stakeholder_behavior_metrics(period_start DESC);

COMMENT ON TABLE stakeholder_behavior_metrics IS 'Periodic performance snapshots for stakeholder analytics';
COMMENT ON COLUMN stakeholder_behavior_metrics.on_time_rate IS 'Percentage of shipments on time (0-100)';
COMMENT ON COLUMN stakeholder_behavior_metrics.avg_sentiment_score IS 'Average sentiment from emails (-1 to 1)';

-- ----------------------------------------------------------------------------
-- TABLE: stakeholder_sentiment_log
-- AI-analyzed sentiment from email communications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stakeholder_sentiment_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  source_email_id UUID REFERENCES raw_emails(id),

  -- Sentiment analysis results
  sentiment VARCHAR(20) NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative', 'urgent')),
  sentiment_score DECIMAL(3,2) NOT NULL,  -- -1 to 1
  confidence DECIMAL(3,2),  -- 0 to 1

  -- Topic analysis
  topic_category VARCHAR(100),  -- 'booking', 'documentation', 'payment', 'complaint'
  key_topics TEXT[],

  -- Context
  email_snippet TEXT,  -- Relevant text snippet

  -- Metadata
  analyzed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sentiment_party ON stakeholder_sentiment_log(party_id);
CREATE INDEX IF NOT EXISTS idx_sentiment_email ON stakeholder_sentiment_log(source_email_id);
CREATE INDEX IF NOT EXISTS idx_sentiment_analyzed ON stakeholder_sentiment_log(analyzed_at DESC);

COMMENT ON TABLE stakeholder_sentiment_log IS 'AI-analyzed sentiment from stakeholder communications';
COMMENT ON COLUMN stakeholder_sentiment_log.sentiment_score IS 'Sentiment score from -1 (very negative) to 1 (very positive)';

-- ----------------------------------------------------------------------------
-- TABLE: stakeholder_extraction_queue
-- Queue for AI extraction of stakeholder data from emails
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stakeholder_extraction_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES raw_emails(id),

  -- Processing status
  extraction_status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),

  -- Extracted data
  extracted_parties JSONB DEFAULT '[]',
  -- Structure: [{"name": "ABC Corp", "type": "shipper", "email": "...", "confidence": 0.9}, ...]

  -- Matching results
  matched_party_ids UUID[],  -- Existing parties that were matched
  created_party_ids UUID[],  -- New parties that were created

  -- Error handling
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,

  -- Metadata
  queued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_queue_status ON stakeholder_extraction_queue(extraction_status);
CREATE INDEX IF NOT EXISTS idx_extraction_queue_pending ON stakeholder_extraction_queue(queued_at)
  WHERE extraction_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_extraction_queue_email ON stakeholder_extraction_queue(email_id);

COMMENT ON TABLE stakeholder_extraction_queue IS 'Queue for AI extraction of stakeholder data from emails';
COMMENT ON COLUMN stakeholder_extraction_queue.extracted_parties IS 'AI-extracted party data with confidence scores';

-- ----------------------------------------------------------------------------
-- TABLE: stakeholder_relationships
-- Track relationships between stakeholders (e.g., shipper-consignee pairs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stakeholder_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_a_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  party_b_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,

  -- Relationship type
  relationship_type VARCHAR(50) NOT NULL,
  -- Values: 'shipper_consignee', 'customer_agent', 'regular_trading_partner'

  -- Metrics
  shipment_count INTEGER DEFAULT 0,
  first_shipment_date DATE,
  last_shipment_date DATE,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  UNIQUE(party_a_id, party_b_id, relationship_type),
  CHECK(party_a_id != party_b_id)
);

CREATE INDEX IF NOT EXISTS idx_relationships_party_a ON stakeholder_relationships(party_a_id);
CREATE INDEX IF NOT EXISTS idx_relationships_party_b ON stakeholder_relationships(party_b_id);

COMMENT ON TABLE stakeholder_relationships IS 'Relationships between stakeholders';
COMMENT ON COLUMN stakeholder_relationships.relationship_type IS 'Type of relationship between parties';

-- ----------------------------------------------------------------------------
-- Add customer_id to shipments for financial tracking
-- ----------------------------------------------------------------------------
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES parties(id);

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS priority_tier VARCHAR(20);
-- Values: 'platinum', 'gold', 'silver', 'bronze'

COMMENT ON COLUMN shipments.customer_id IS 'The paying customer for this shipment';
COMMENT ON COLUMN shipments.priority_tier IS 'Customer priority tier for prioritization';

CREATE INDEX IF NOT EXISTS idx_shipments_customer ON shipments(customer_id);

-- ----------------------------------------------------------------------------
-- Update parties party_type CHECK constraint to include new types
-- ----------------------------------------------------------------------------
-- First, drop the old constraint
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_party_type_check;

-- Add new constraint with additional types
ALTER TABLE parties ADD CONSTRAINT parties_party_type_check
  CHECK (party_type IN (
    'shipper',
    'consignee',
    'notify_party',
    'freight_forwarder',
    'customs_broker',
    'cha',           -- Customs House Agent
    'trucker',       -- Transport/trucking company
    'shipping_line', -- Carrier
    'warehouse',     -- Storage facility
    'agent'          -- General agent
  ));

-- ----------------------------------------------------------------------------
-- GRANT PERMISSIONS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON stakeholder_behavior_metrics TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON stakeholder_sentiment_log TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON stakeholder_extraction_queue TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON stakeholder_relationships TO anon, authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION 016
-- ============================================================================
