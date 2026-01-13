-- Migration 046: Narrative Chain System
-- Transforms disconnected email data into coherent cause-effect chains
-- Enables "Chain of Thought" reasoning for actionable insights

-- ============================================================================
-- 1. SHIPMENT NARRATIVE CHAINS
-- Links trigger events (issues, requests) to their effects (actions, responses)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_narrative_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Chain identification
  chain_type VARCHAR(50) NOT NULL CHECK (chain_type IN (
    'issue_to_action',       -- Issue reported → Action required
    'action_to_resolution',  -- Action taken → Resolution achieved
    'communication_chain',   -- Message sent → Awaiting response
    'escalation_chain',      -- Issue severity increased over time
    'delay_chain',           -- Delay reported → Schedule impacts
    'document_chain'         -- Document request → Document received
  )),
  chain_status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (chain_status IN (
    'active',      -- Needs attention
    'resolved',    -- Chain completed successfully
    'stale',       -- No activity for extended period
    'superseded'   -- Replaced by newer chain
  )),

  -- The trigger event (what started this chain)
  trigger_chronicle_id UUID REFERENCES chronicle(id) ON DELETE SET NULL,
  trigger_event_type VARCHAR(100) NOT NULL,
  trigger_summary TEXT NOT NULL,
  trigger_occurred_at TIMESTAMPTZ NOT NULL,
  trigger_party VARCHAR(100),

  -- The chain of effects (ordered list of linked events)
  chain_events JSONB NOT NULL DEFAULT '[]',
  -- Structure: [
  --   {
  --     "chronicle_id": "uuid",
  --     "event_type": "action_required",
  --     "summary": "Submit SI by deadline",
  --     "occurred_at": "2024-01-10T10:00:00Z",
  --     "party": "operations",
  --     "relation": "caused_by",  -- caused_by | resolved_by | followed_by
  --     "days_from_trigger": 0
  --   }
  -- ]

  -- Current state of the chain
  current_state VARCHAR(200),           -- "Awaiting carrier confirmation"
  current_state_party VARCHAR(100),     -- Who needs to act: "Hapag-Lloyd"
  days_in_current_state INTEGER,

  -- Narrative summaries (AI-generated or templated)
  narrative_summary TEXT,               -- Short: "Delay reported, awaiting new schedule"
  narrative_headline TEXT,              -- Even shorter: "Vessel Rollover"
  full_narrative TEXT,                  -- Full story for detail view

  -- Impact assessment
  financial_impact_usd DECIMAL(12,2),
  delay_impact_days INTEGER,
  affected_parties TEXT[],              -- ["shipper", "consignee"]

  -- Resolution tracking
  resolution_required BOOLEAN DEFAULT true,
  resolution_deadline TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_chronicle_id UUID REFERENCES chronicle(id) ON DELETE SET NULL,
  resolution_summary TEXT,

  -- Chain behavior
  stale_after_days INTEGER DEFAULT 7,   -- Mark stale if no activity
  auto_detected BOOLEAN DEFAULT true,   -- Was this chain auto-detected?
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_narrative_chains_shipment ON shipment_narrative_chains(shipment_id);
CREATE INDEX IF NOT EXISTS idx_narrative_chains_status ON shipment_narrative_chains(chain_status, shipment_id);
CREATE INDEX IF NOT EXISTS idx_narrative_chains_type ON shipment_narrative_chains(chain_type);
CREATE INDEX IF NOT EXISTS idx_narrative_chains_active ON shipment_narrative_chains(shipment_id, updated_at DESC)
  WHERE chain_status = 'active';
CREATE INDEX IF NOT EXISTS idx_narrative_chains_trigger ON shipment_narrative_chains(trigger_chronicle_id);

-- ============================================================================
-- 2. STAKEHOLDER INTERACTION SUMMARY
-- Pre-computed party behavior for instant access (no real-time aggregation)
-- ============================================================================

CREATE TABLE IF NOT EXISTS stakeholder_interaction_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Party identification
  party_type VARCHAR(50) NOT NULL,      -- ocean_carrier, customs_broker, trucker, etc.
  party_identifier VARCHAR(255),         -- Email domain or carrier name
  party_display_name VARCHAR(255),       -- "Hapag-Lloyd", "Portside Customs"

  -- Communication statistics
  total_emails INTEGER DEFAULT 0,
  inbound_count INTEGER DEFAULT 0,
  outbound_count INTEGER DEFAULT 0,
  first_contact TIMESTAMPTZ,
  last_contact TIMESTAMPTZ,
  days_since_last_contact INTEGER,

  -- Response behavior (based on thread analysis)
  avg_response_time_hours DECIMAL(10,2),
  fastest_response_hours DECIMAL(10,2),
  slowest_response_hours DECIMAL(10,2),
  unanswered_count INTEGER DEFAULT 0,   -- Messages we sent with no reply

  -- Sentiment tracking
  positive_count INTEGER DEFAULT 0,
  neutral_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  urgent_count INTEGER DEFAULT 0,
  overall_sentiment VARCHAR(20) CHECK (overall_sentiment IN (
    'positive', 'neutral', 'negative', 'mixed'
  )),

  -- Issue involvement
  issues_raised INTEGER DEFAULT 0,       -- Issues they reported
  issues_resolved INTEGER DEFAULT 0,     -- Issues resolved by their communication
  issue_types TEXT[],                    -- Types of issues involving this party

  -- Action involvement
  actions_requested INTEGER DEFAULT 0,   -- Actions they requested from us
  actions_completed INTEGER DEFAULT 0,   -- Actions we completed for them

  -- Recent communications (cached for quick display)
  recent_communications JSONB DEFAULT '[]',
  -- Structure: [
  --   {
  --     "date": "2024-01-10T10:00:00Z",
  --     "direction": "inbound",
  --     "type": "issue_reported",
  --     "summary": "Vessel rollover notification",
  --     "sentiment": "neutral",
  --     "chronicle_id": "uuid",
  --     "has_pending_action": true
  --   }
  -- ]

  -- Behavior pattern (derived from above metrics)
  behavior_pattern VARCHAR(30) CHECK (behavior_pattern IN (
    'excellent',     -- Fast responses, proactive, few issues
    'responsive',    -- Timely responses, cooperative
    'standard',      -- Normal response times
    'slow',          -- Delayed responses
    'problematic',   -- Many issues, slow/no responses
    'unknown'        -- Not enough data
  )),
  behavior_notes TEXT,

  -- Computation metadata
  last_computed TIMESTAMPTZ DEFAULT NOW(),
  computation_version INTEGER DEFAULT 1,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(shipment_id, party_type, party_identifier)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stakeholder_summary_shipment ON stakeholder_interaction_summary(shipment_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_summary_party ON stakeholder_interaction_summary(party_type);
CREATE INDEX IF NOT EXISTS idx_stakeholder_summary_identifier ON stakeholder_interaction_summary(party_identifier);
CREATE INDEX IF NOT EXISTS idx_stakeholder_summary_behavior ON stakeholder_interaction_summary(behavior_pattern);

-- ============================================================================
-- 3. SHIPMENT STORY EVENTS
-- Unified timeline with narrative context and importance markers
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_story_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Source tracking
  source_type VARCHAR(30) NOT NULL CHECK (source_type IN (
    'chronicle',     -- From email intelligence
    'milestone',     -- From shipment milestones
    'blocker',       -- From shipment blockers
    'insight',       -- From AI insights
    'system',        -- System-generated event
    'manual'         -- Manually added
  )),
  source_id UUID,    -- Reference to source table (chronicle.id, milestone.id, etc.)

  -- Event classification
  event_category VARCHAR(50) NOT NULL CHECK (event_category IN (
    'communication', -- Email sent/received
    'document',      -- Document received/sent/approved
    'issue',         -- Issue reported/escalated/resolved
    'action',        -- Action required/completed
    'milestone',     -- Journey milestone achieved
    'status'         -- Status change
  )),
  event_type VARCHAR(100) NOT NULL,     -- Specific type: "delay_reported", "si_submitted", etc.

  -- Display content
  event_headline TEXT NOT NULL,          -- Short: "Shipping Line reported delay"
  event_detail TEXT,                     -- Full: "Hapag-Lloyd notified vessel rollover..."

  -- Parties involved
  from_party VARCHAR(100),               -- Who initiated: "ocean_carrier"
  to_party VARCHAR(100),                 -- Who received: "operations"
  party_display_name VARCHAR(255),       -- Human-readable: "Hapag-Lloyd"

  -- Narrative importance (determines visibility and emphasis)
  importance VARCHAR(20) DEFAULT 'normal' CHECK (importance IN (
    'critical',      -- Must see - active issues, overdue actions
    'high',          -- Should see - upcoming deadlines, new issues
    'normal',        -- Standard events
    'low',           -- Minor updates
    'context'        -- Background info
  )),
  is_key_moment BOOLEAN DEFAULT false,   -- Should appear in "key moments" summary

  -- Chain linking (connects to narrative chains)
  narrative_chain_id UUID REFERENCES shipment_narrative_chains(id) ON DELETE SET NULL,
  chain_position INTEGER,                -- Order in chain (1, 2, 3...)
  chain_role VARCHAR(30) CHECK (chain_role IN (
    'trigger',       -- Started the chain
    'effect',        -- Caused by trigger
    'resolution'     -- Resolved the chain
  )),

  -- Related entities
  related_issue_type VARCHAR(100),       -- If this event involves an issue
  related_action_id UUID,                -- If this event is about an action

  -- Timing
  occurred_at TIMESTAMPTZ NOT NULL,
  days_ago INTEGER,                      -- Cached for quick filtering

  -- Response tracking (for communication events)
  requires_response BOOLEAN DEFAULT false,
  response_received BOOLEAN DEFAULT false,
  response_deadline TIMESTAMPTZ,
  response_event_id UUID REFERENCES shipment_story_events(id),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_story_events_shipment ON shipment_story_events(shipment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_events_chain ON shipment_story_events(narrative_chain_id);
CREATE INDEX IF NOT EXISTS idx_story_events_key ON shipment_story_events(shipment_id)
  WHERE is_key_moment = true;
CREATE INDEX IF NOT EXISTS idx_story_events_importance ON shipment_story_events(importance, shipment_id);
CREATE INDEX IF NOT EXISTS idx_story_events_pending_response ON shipment_story_events(shipment_id, response_deadline)
  WHERE requires_response = true AND response_received = false;
CREATE INDEX IF NOT EXISTS idx_story_events_source ON shipment_story_events(source_type, source_id);

-- ============================================================================
-- 4. HELPER FUNCTIONS
-- ============================================================================

-- Function: Update days_since_last_contact for all stakeholders
CREATE OR REPLACE FUNCTION update_stakeholder_days_since_contact()
RETURNS void AS $$
BEGIN
  UPDATE stakeholder_interaction_summary
  SET
    days_since_last_contact = EXTRACT(DAY FROM (NOW() - last_contact))::INTEGER,
    updated_at = NOW()
  WHERE last_contact IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Function: Update days_ago for story events
CREATE OR REPLACE FUNCTION update_story_events_days_ago()
RETURNS void AS $$
BEGIN
  UPDATE shipment_story_events
  SET days_ago = EXTRACT(DAY FROM (NOW() - occurred_at))::INTEGER
  WHERE occurred_at IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- Function: Mark stale chains
CREATE OR REPLACE FUNCTION mark_stale_narrative_chains()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE shipment_narrative_chains
  SET
    chain_status = 'stale',
    updated_at = NOW()
  WHERE chain_status = 'active'
    AND updated_at < NOW() - (stale_after_days || ' days')::INTERVAL;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Update chain days_in_current_state
CREATE OR REPLACE FUNCTION update_chain_days_in_state()
RETURNS void AS $$
BEGIN
  UPDATE shipment_narrative_chains
  SET
    days_in_current_state = EXTRACT(DAY FROM (NOW() - updated_at))::INTEGER
  WHERE chain_status = 'active';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 5. TRIGGERS
-- ============================================================================

-- Trigger: Auto-update updated_at on narrative chains
CREATE OR REPLACE FUNCTION update_narrative_chain_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_narrative_chain_timestamp ON shipment_narrative_chains;
CREATE TRIGGER trigger_narrative_chain_timestamp
  BEFORE UPDATE ON shipment_narrative_chains
  FOR EACH ROW
  EXECUTE FUNCTION update_narrative_chain_timestamp();

-- Trigger: Auto-update updated_at on stakeholder summaries
DROP TRIGGER IF EXISTS trigger_stakeholder_summary_timestamp ON stakeholder_interaction_summary;
CREATE TRIGGER trigger_stakeholder_summary_timestamp
  BEFORE UPDATE ON stakeholder_interaction_summary
  FOR EACH ROW
  EXECUTE FUNCTION update_narrative_chain_timestamp();

-- ============================================================================
-- 6. VIEWS
-- ============================================================================

-- View: Active chains requiring attention
CREATE OR REPLACE VIEW v_active_narrative_chains AS
SELECT
  nc.id,
  nc.shipment_id,
  s.booking_number,
  nc.chain_type,
  nc.narrative_headline,
  nc.narrative_summary,
  nc.current_state,
  nc.current_state_party,
  nc.days_in_current_state,
  nc.trigger_summary,
  nc.trigger_occurred_at,
  nc.trigger_party,
  nc.delay_impact_days,
  nc.affected_parties,
  nc.resolution_deadline,
  nc.created_at,
  nc.updated_at
FROM shipment_narrative_chains nc
JOIN shipments s ON s.id = nc.shipment_id
WHERE nc.chain_status = 'active'
ORDER BY
  CASE
    WHEN nc.resolution_deadline IS NOT NULL AND nc.resolution_deadline < NOW() THEN 1
    WHEN nc.days_in_current_state > 3 THEN 2
    ELSE 3
  END,
  nc.updated_at DESC;

-- View: Stakeholders needing follow-up
CREATE OR REPLACE VIEW v_stakeholders_needing_followup AS
SELECT
  sis.id,
  sis.shipment_id,
  s.booking_number,
  sis.party_type,
  sis.party_display_name,
  sis.days_since_last_contact,
  sis.unanswered_count,
  sis.behavior_pattern,
  sis.overall_sentiment,
  sis.last_contact
FROM stakeholder_interaction_summary sis
JOIN shipments s ON s.id = sis.shipment_id
WHERE
  (sis.unanswered_count > 0 OR sis.days_since_last_contact > 3)
  AND s.status NOT IN ('completed', 'cancelled')
ORDER BY
  sis.unanswered_count DESC,
  sis.days_since_last_contact DESC;

-- View: Key shipment moments
CREATE OR REPLACE VIEW v_shipment_key_moments AS
SELECT
  sse.id,
  sse.shipment_id,
  s.booking_number,
  sse.event_category,
  sse.event_type,
  sse.event_headline,
  sse.party_display_name,
  sse.importance,
  sse.narrative_chain_id,
  sse.chain_role,
  sse.occurred_at,
  sse.days_ago
FROM shipment_story_events sse
JOIN shipments s ON s.id = sse.shipment_id
WHERE sse.is_key_moment = true
ORDER BY sse.occurred_at DESC;

-- ============================================================================
-- 7. COMMENTS
-- ============================================================================

COMMENT ON TABLE shipment_narrative_chains IS 'Links trigger events to their effects, enabling chain-of-thought reasoning';
COMMENT ON COLUMN shipment_narrative_chains.chain_type IS 'Type of causal relationship: issue_to_action, communication_chain, delay_chain, etc.';
COMMENT ON COLUMN shipment_narrative_chains.chain_events IS 'JSON array of linked events with chronicle_id, summary, relation, and timing';
COMMENT ON COLUMN shipment_narrative_chains.current_state_party IS 'Who needs to act next to progress this chain';

COMMENT ON TABLE stakeholder_interaction_summary IS 'Pre-computed party behavior metrics for instant access';
COMMENT ON COLUMN stakeholder_interaction_summary.behavior_pattern IS 'Derived rating: excellent, responsive, standard, slow, problematic';
COMMENT ON COLUMN stakeholder_interaction_summary.recent_communications IS 'Cached last 5 communications for quick display';

COMMENT ON TABLE shipment_story_events IS 'Unified timeline with narrative importance and chain linking';
COMMENT ON COLUMN shipment_story_events.is_key_moment IS 'Should appear in condensed "key moments" summary';
COMMENT ON COLUMN shipment_story_events.chain_role IS 'Role in narrative chain: trigger (started), effect (caused by), resolution (ended)';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
