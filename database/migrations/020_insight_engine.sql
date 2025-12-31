-- Migration 020: Insight Engine
-- Proactive intelligence system for discovering hidden patterns and risks

-- ============================================================================
-- Insight Pattern Definitions (Configurable)
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_code VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,  -- timeline, stakeholder, cross_shipment, document, financial
  name VARCHAR(200) NOT NULL,
  description TEXT,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  check_function TEXT,            -- For reference, actual logic in code
  priority_boost INTEGER DEFAULT 0,  -- Default boost when pattern matches
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- Generated Insights (Stored Results)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  task_id UUID REFERENCES action_tasks(id) ON DELETE SET NULL,

  -- Insight details
  insight_type VARCHAR(50) NOT NULL,  -- rule_detected, risk, pattern, prediction, recommendation
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  recommended_action TEXT,

  -- Metadata
  source VARCHAR(20) NOT NULL CHECK (source IN ('rules', 'ai', 'hybrid')),
  pattern_id UUID REFERENCES insight_patterns(id) ON DELETE SET NULL,
  confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  supporting_data JSONB DEFAULT '{}',

  -- Priority impact
  priority_boost INTEGER DEFAULT 0,
  boost_reason TEXT,

  -- Status
  status VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved', 'dismissed', 'expired')),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE  -- Some insights are time-sensitive
  -- Note: Duplicate prevention handled in application layer
);

-- ============================================================================
-- Insight Feedback (For ML Improvement)
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id UUID REFERENCES shipment_insights(id) ON DELETE CASCADE,
  feedback_type VARCHAR(30) NOT NULL CHECK (feedback_type IN (
    'helpful', 'not_helpful', 'false_positive', 'saved_money', 'saved_time', 'prevented_issue'
  )),
  feedback_value JSONB DEFAULT '{}',  -- { amount_saved: 500, time_saved_hours: 2, description: "..." }
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID
);

-- ============================================================================
-- Insight Generation Log (For Debugging & Analytics)
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,

  -- Generation details
  generation_type VARCHAR(30) NOT NULL,  -- scheduled, on_demand, task_view
  rules_patterns_checked INTEGER,
  rules_patterns_matched INTEGER,
  ai_analysis_ran BOOLEAN DEFAULT false,
  ai_insights_generated INTEGER DEFAULT 0,

  -- Timing
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  duration_ms INTEGER,

  -- Results
  total_insights_generated INTEGER DEFAULT 0,
  priority_boost_applied INTEGER DEFAULT 0,
  error_message TEXT
);

-- ============================================================================
-- Indexes
-- ============================================================================

-- Shipment insights
CREATE INDEX IF NOT EXISTS idx_insights_shipment ON shipment_insights(shipment_id);
CREATE INDEX IF NOT EXISTS idx_insights_task ON shipment_insights(task_id);
CREATE INDEX IF NOT EXISTS idx_insights_severity_status ON shipment_insights(severity, status);
CREATE INDEX IF NOT EXISTS idx_insights_active ON shipment_insights(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_insights_generated_at ON shipment_insights(generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_insights_source ON shipment_insights(source);

-- Insight patterns
CREATE INDEX IF NOT EXISTS idx_patterns_category ON insight_patterns(category);
CREATE INDEX IF NOT EXISTS idx_patterns_enabled ON insight_patterns(enabled) WHERE enabled = true;

-- Insight feedback
CREATE INDEX IF NOT EXISTS idx_feedback_insight ON insight_feedback(insight_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON insight_feedback(feedback_type);

-- Generation log
CREATE INDEX IF NOT EXISTS idx_generation_log_shipment ON insight_generation_log(shipment_id);
CREATE INDEX IF NOT EXISTS idx_generation_log_date ON insight_generation_log(started_at DESC);

-- ============================================================================
-- Seed Pattern Definitions
-- ============================================================================

INSERT INTO insight_patterns (pattern_code, category, name, description, severity, priority_boost) VALUES
-- Timeline Conflicts
('vgm_after_cargo_cutoff', 'timeline', 'VGM After Cargo Cutoff', 'VGM cutoff date is after cargo cutoff - impossible timeline', 'critical', 20),
('multiple_cutoffs_same_day', 'timeline', 'Multiple Cutoffs Same Day', '3+ cutoffs on the same day - high workload risk', 'high', 10),
('si_cutoff_passed_no_si', 'timeline', 'SI Cutoff Passed Without SI', 'SI cutoff has passed but no SI document submitted', 'critical', 25),
('cutoff_within_24h', 'timeline', 'Cutoff Within 24 Hours', 'A cutoff deadline is within 24 hours', 'critical', 15),
('etd_before_cutoffs', 'timeline', 'ETD Before Cutoffs', 'ETD is before one or more cutoff dates - impossible timeline', 'critical', 20),

-- Stakeholder Signals
('shipper_reliability_low', 'stakeholder', 'Low Shipper Reliability', 'Shipper reliability score below 60%', 'high', 12),
('shipper_no_response_3d', 'stakeholder', 'Shipper No Response', 'No response from shipper in 3+ days', 'medium', 8),
('carrier_high_rollover', 'stakeholder', 'High Carrier Rollover Rate', 'Carrier rolled over >25% of bookings on this route', 'high', 15),
('consignee_low_reliability', 'stakeholder', 'Low Consignee Reliability', 'Consignee reliability score below 60%', 'medium', 8),
('new_shipper_first_shipment', 'stakeholder', 'New Shipper First Shipment', 'First shipment with this shipper - extra attention needed', 'medium', 5),

-- Cross-Shipment Risks
('consignee_capacity_risk', 'cross_shipment', 'Consignee Capacity Risk', 'Multiple shipments arriving to same consignee within 3 days', 'high', 12),
('high_customer_exposure', 'cross_shipment', 'High Customer Exposure', 'Total exposure to customer exceeds $500K across active shipments', 'high', 10),
('route_congestion', 'cross_shipment', 'Route Congestion', '10+ shipments arriving at same port this week', 'medium', 5),
('shared_deadline_pressure', 'cross_shipment', 'Shared Deadline Pressure', 'Multiple shipments from same shipper with cutoffs on same day', 'high', 10),

-- Document Intelligence
('missing_critical_doc', 'document', 'Missing Critical Document', 'Critical document missing for workflow stage', 'critical', 20),
('high_amendment_frequency', 'document', 'High Amendment Frequency', '3+ amendments in last 7 days - unusual churn', 'medium', 8),
('document_quality_critical', 'document', 'Critical Document Quality Issues', 'Document has critical quality issues or missing required fields', 'high', 12),
('bl_not_released_near_eta', 'document', 'BL Not Released Near ETA', 'ETA within 3 days but BL not yet released', 'critical', 18),
('si_draft_pending_review', 'document', 'SI Draft Pending Review', 'SI draft received but not reviewed within 24 hours', 'high', 10),

-- Financial Signals
('payment_overdue_other', 'financial', 'Payment Overdue Other Shipment', 'Customer has overdue invoices on other shipments', 'high', 12),
('demurrage_risk', 'financial', 'Demurrage Risk', 'Container at port 3+ days without delivery order', 'critical', 20),
('detention_accruing', 'financial', 'Detention Accruing', 'Container held beyond free days', 'high', 15)

ON CONFLICT (pattern_code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  severity = EXCLUDED.severity,
  priority_boost = EXCLUDED.priority_boost,
  updated_at = NOW();

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE insight_patterns IS 'Configurable pattern definitions for rule-based insight detection';
COMMENT ON TABLE shipment_insights IS 'Generated insights for shipments - both rules-based and AI-generated';
COMMENT ON TABLE insight_feedback IS 'User feedback on insight helpfulness for ML improvement';
COMMENT ON TABLE insight_generation_log IS 'Log of insight generation runs for debugging and analytics';

COMMENT ON COLUMN shipment_insights.source IS 'rules = pattern detector, ai = Claude analysis, hybrid = both contributed';
COMMENT ON COLUMN shipment_insights.confidence IS 'Confidence score 0.00-1.00, rules are always 1.00';
COMMENT ON COLUMN shipment_insights.priority_boost IS 'Points added to task priority (0-50 max)';
