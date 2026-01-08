-- ============================================================================
-- Intelligence Tables Migration
-- Creates email_intelligence (facts per email) and shipment_intelligence (rollup)
-- ============================================================================

-- ============================================================================
-- PART 1: Email Intelligence (Raw Material)
-- ============================================================================

-- Sentiment enum
DO $$ BEGIN
  CREATE TYPE email_sentiment AS ENUM ('positive', 'negative', 'neutral', 'urgent', 'concerned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Urgency level enum
DO $$ BEGIN
  CREATE TYPE email_urgency AS ENUM ('critical', 'high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Event type enum
DO $$ BEGIN
  CREATE TYPE email_event_type AS ENUM (
    'booking_confirmed', 'booking_amended', 'si_submitted', 'si_amendment',
    'draft_bl_issued', 'bl_released', 'arrival_notice', 'invoice_received',
    'deadline_reminder', 'issue_reported', 'status_update', 'general_communication', 'unknown'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Sentiment trend enum (for shipment rollup)
DO $$ BEGIN
  CREATE TYPE sentiment_trend AS ENUM ('improving', 'stable', 'declining', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Email Intelligence Table
CREATE TABLE IF NOT EXISTS email_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES shipments(id) ON DELETE SET NULL,

  -- Sentiment & Urgency (structured facts)
  sentiment email_sentiment NOT NULL DEFAULT 'neutral',
  sentiment_confidence INTEGER DEFAULT 70 CHECK (sentiment_confidence >= 0 AND sentiment_confidence <= 100),
  urgency email_urgency NOT NULL DEFAULT 'medium',
  urgency_confidence INTEGER DEFAULT 70 CHECK (urgency_confidence >= 0 AND urgency_confidence <= 100),
  urgency_triggers TEXT[] DEFAULT '{}',

  -- Action tracking
  has_action BOOLEAN NOT NULL DEFAULT false,
  action_summary TEXT,  -- One line: "Submit SI by Dec 15"
  action_owner TEXT CHECK (action_owner IS NULL OR action_owner IN ('sender', 'recipient', 'unknown')),
  action_deadline DATE,
  action_priority TEXT CHECK (action_priority IS NULL OR action_priority IN ('high', 'medium', 'low')),

  -- Event classification
  event_type email_event_type NOT NULL DEFAULT 'unknown',
  event_description TEXT,  -- One line: "ETD changed from Jan 1 to Jan 5"

  -- Summary (one line, not paragraph)
  one_line_summary TEXT,  -- "Maersk confirms booking for 2x40HC to Rotterdam"

  -- Structured data
  key_dates JSONB DEFAULT '{}',  -- {"etd": "2025-01-15", "si_cutoff": "2025-01-10"}
  issues TEXT[] DEFAULT '{}',    -- ["Missing cargo weight", "Document pending"]
  key_facts JSONB DEFAULT '{}',  -- Other structured facts

  -- Processing metadata
  processing_time_ms INTEGER,
  extraction_method TEXT DEFAULT 'ai' CHECK (extraction_method IN ('ai', 'quick', 'manual')),
  model_used TEXT,  -- 'claude-3-5-haiku-20241022'

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_email_intelligence UNIQUE (email_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_intel_shipment ON email_intelligence(shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_intel_sentiment ON email_intelligence(sentiment);
CREATE INDEX IF NOT EXISTS idx_email_intel_urgency ON email_intelligence(urgency);
CREATE INDEX IF NOT EXISTS idx_email_intel_has_action ON email_intelligence(has_action) WHERE has_action = true;
CREATE INDEX IF NOT EXISTS idx_email_intel_event_type ON email_intelligence(event_type);
CREATE INDEX IF NOT EXISTS idx_email_intel_created ON email_intelligence(created_at DESC);

-- ============================================================================
-- PART 2: Shipment Intelligence (Aggregated Rollup)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Status summary (one line)
  status_summary TEXT,  -- "SI submitted, awaiting draft BL"

  -- Action rollup
  total_actions INTEGER DEFAULT 0,
  open_actions INTEGER DEFAULT 0,
  urgent_actions INTEGER DEFAULT 0,
  actions_detail JSONB DEFAULT '[]',  -- [{action, deadline, source_email_id, priority}]
  next_action TEXT,  -- Most urgent pending action
  next_deadline DATE,  -- Nearest deadline

  -- Sentiment rollup
  sentiment_trend sentiment_trend DEFAULT 'unknown',
  latest_sentiment email_sentiment DEFAULT 'neutral',
  sentiment_history JSONB DEFAULT '[]',  -- [{date, sentiment, email_id}]

  -- Urgency rollup
  critical_count INTEGER DEFAULT 0,
  high_urgency_count INTEGER DEFAULT 0,

  -- Issues rollup
  unresolved_issues TEXT[] DEFAULT '{}',
  issue_count INTEGER DEFAULT 0,

  -- Timeline/Events
  timeline JSONB DEFAULT '[]',  -- [{event_type, description, date, email_id}]
  last_event_type email_event_type DEFAULT 'unknown',
  last_event_description TEXT,

  -- Email stats
  total_emails INTEGER DEFAULT 0,
  last_email_at TIMESTAMPTZ,
  last_email_id UUID,

  -- Attention flag
  needs_attention BOOLEAN DEFAULT false,
  attention_reasons TEXT[] DEFAULT '{}',  -- ["Urgent action pending", "Issue reported"]

  -- Key dates aggregated
  key_dates JSONB DEFAULT '{}',  -- Aggregated from all emails

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_shipment_intelligence UNIQUE (shipment_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shipment_intel_needs_attention ON shipment_intelligence(needs_attention) WHERE needs_attention = true;
CREATE INDEX IF NOT EXISTS idx_shipment_intel_sentiment ON shipment_intelligence(sentiment_trend);
CREATE INDEX IF NOT EXISTS idx_shipment_intel_updated ON shipment_intelligence(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipment_intel_next_deadline ON shipment_intelligence(next_deadline) WHERE next_deadline IS NOT NULL;

-- ============================================================================
-- PART 3: Triggers for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_intelligence_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_intelligence_updated ON email_intelligence;
CREATE TRIGGER email_intelligence_updated
  BEFORE UPDATE ON email_intelligence
  FOR EACH ROW
  EXECUTE FUNCTION update_intelligence_timestamp();

DROP TRIGGER IF EXISTS shipment_intelligence_updated ON shipment_intelligence;
CREATE TRIGGER shipment_intelligence_updated
  BEFORE UPDATE ON shipment_intelligence
  FOR EACH ROW
  EXECUTE FUNCTION update_intelligence_timestamp();

-- ============================================================================
-- PART 4: Comments
-- ============================================================================

COMMENT ON TABLE email_intelligence IS 'Structured facts extracted from each email - raw material for shipment rollups';
COMMENT ON TABLE shipment_intelligence IS 'Aggregated intelligence per shipment - one row per shipment for dashboard view';

COMMENT ON COLUMN email_intelligence.sentiment IS 'Email tone: positive/negative/neutral/urgent/concerned';
COMMENT ON COLUMN email_intelligence.urgency IS 'Action priority: critical/high/medium/low';
COMMENT ON COLUMN email_intelligence.has_action IS 'Whether this email requires action';
COMMENT ON COLUMN email_intelligence.event_type IS 'What shipment event this email represents';
COMMENT ON COLUMN email_intelligence.one_line_summary IS 'Brief one-line summary of email content';

COMMENT ON COLUMN shipment_intelligence.status_summary IS 'Current shipment status in one line';
COMMENT ON COLUMN shipment_intelligence.sentiment_trend IS 'Overall sentiment direction: improving/stable/declining';
COMMENT ON COLUMN shipment_intelligence.needs_attention IS 'Flag for dashboard highlighting';
COMMENT ON COLUMN shipment_intelligence.next_action IS 'Most urgent pending action for quick view';
