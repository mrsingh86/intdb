-- Migration 028: Add Insight Engine Tables
-- Enables proactive intelligence system with rules + AI hybrid approach

-- ============================================================================
-- INSIGHT PATTERNS (Configurable Rules)
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_code VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL CHECK (category IN ('timeline', 'stakeholder', 'cross_shipment', 'document', 'financial', 'blocker')),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  priority_boost INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- SHIPMENT INSIGHTS (Generated Results)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  task_id UUID REFERENCES action_tasks(id) ON DELETE SET NULL,

  -- Core details
  insight_type VARCHAR(50) NOT NULL CHECK (insight_type IN ('rule_detected', 'risk', 'pattern', 'prediction', 'recommendation')),
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title VARCHAR(500) NOT NULL,
  description TEXT NOT NULL,
  recommended_action TEXT,

  -- Metadata
  source VARCHAR(20) NOT NULL CHECK (source IN ('rules', 'ai', 'hybrid')),
  pattern_id UUID REFERENCES insight_patterns(id) ON DELETE SET NULL,
  confidence NUMERIC(5,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  supporting_data JSONB DEFAULT '{}',

  -- Priority impact
  priority_boost INTEGER DEFAULT 0,
  boost_reason TEXT,

  -- Status tracking
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved', 'dismissed', 'expired')),
  acknowledged_at TIMESTAMP,
  acknowledged_by UUID,
  resolved_at TIMESTAMP,

  -- Timestamps
  generated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_shipment_insights_shipment ON shipment_insights(shipment_id);
CREATE INDEX idx_shipment_insights_status ON shipment_insights(status);
CREATE INDEX idx_shipment_insights_severity ON shipment_insights(severity);
CREATE INDEX idx_shipment_insights_generated ON shipment_insights(generated_at DESC);

-- Note: Deduplication handled in application code to avoid timezone issues

-- ============================================================================
-- INSIGHT FEEDBACK (For ML Improvement)
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id UUID NOT NULL REFERENCES shipment_insights(id) ON DELETE CASCADE,
  feedback_type VARCHAR(50) NOT NULL CHECK (feedback_type IN ('helpful', 'not_helpful', 'false_positive', 'saved_money', 'saved_time', 'prevented_issue')),
  feedback_value JSONB DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_insight_feedback_insight ON insight_feedback(insight_id);

-- ============================================================================
-- INSIGHT GENERATION LOG (For Debugging)
-- ============================================================================

CREATE TABLE IF NOT EXISTS insight_generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  generation_type VARCHAR(30) NOT NULL CHECK (generation_type IN ('scheduled', 'on_demand', 'task_view')),

  -- Statistics
  rules_patterns_checked INTEGER DEFAULT 0,
  rules_patterns_matched INTEGER DEFAULT 0,
  ai_analysis_ran BOOLEAN DEFAULT false,
  ai_insights_generated INTEGER DEFAULT 0,
  total_insights_generated INTEGER DEFAULT 0,
  priority_boost_applied INTEGER DEFAULT 0,
  duration_ms INTEGER,

  -- Error tracking
  error_message TEXT,

  -- Timestamps
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX idx_insight_gen_log_shipment ON insight_generation_log(shipment_id);
CREATE INDEX idx_insight_gen_log_started ON insight_generation_log(started_at DESC);

-- ============================================================================
-- SEED INSIGHT PATTERNS
-- ============================================================================

INSERT INTO insight_patterns (pattern_code, category, name, description, severity, priority_boost, enabled) VALUES
-- Timeline patterns
('si_cutoff_approaching', 'timeline', 'SI Cutoff Approaching', 'SI cutoff is within 48 hours and SI not yet submitted', 'high', 30, true),
('vgm_cutoff_approaching', 'timeline', 'VGM Cutoff Approaching', 'VGM cutoff is within 48 hours and VGM not yet submitted', 'high', 25, true),
('cargo_cutoff_approaching', 'timeline', 'Cargo Cutoff Approaching', 'Cargo cutoff is within 48 hours', 'high', 25, true),
('multiple_cutoffs_same_day', 'timeline', 'Multiple Cutoffs Same Day', 'Multiple cutoffs falling on the same day increases risk', 'medium', 15, true),
('etd_passed_no_departure', 'timeline', 'ETD Passed Without Departure', 'ETD has passed but no actual departure recorded', 'critical', 40, true),
('tight_transit_window', 'timeline', 'Tight Transit Window', 'Less than 3 days between cutoff and ETD', 'medium', 10, true),

-- Document patterns
('bl_not_released', 'document', 'BL Not Released', 'Bill of Lading not released within 7 days of ETD', 'high', 25, true),
('missing_commercial_invoice', 'document', 'Missing Commercial Invoice', 'Commercial invoice not received for shipment', 'medium', 15, true),
('missing_packing_list', 'document', 'Missing Packing List', 'Packing list not received for shipment', 'medium', 10, true),
('document_amendment_required', 'document', 'Document Amendment Required', 'Document has quality issues requiring amendment', 'medium', 15, true),
('draft_bl_pending_approval', 'document', 'Draft BL Pending Approval', 'Draft BL received but not yet approved', 'high', 20, true),

-- Stakeholder patterns
('shipper_slow_response', 'stakeholder', 'Shipper Slow Response', 'Shipper typically slow to respond - allow extra time', 'low', 5, true),
('carrier_high_rollover_rate', 'stakeholder', 'Carrier High Rollover Rate', 'Carrier has >10% rollover rate in last 30 days', 'medium', 15, true),
('consignee_rejection_history', 'stakeholder', 'Consignee Rejection History', 'Consignee has history of cargo rejections', 'medium', 10, true),
('vip_customer_shipment', 'stakeholder', 'VIP Customer Shipment', 'Shipment for priority/VIP customer tier', 'medium', 20, true),

-- Financial patterns
('demurrage_risk', 'financial', 'Demurrage Risk', 'Container at port approaching free time limit', 'high', 30, true),
('detention_risk', 'financial', 'Detention Risk', 'Container detention period approaching limit', 'high', 30, true),
('high_value_shipment', 'financial', 'High Value Shipment', 'Shipment value exceeds threshold - extra attention required', 'medium', 15, true),
('payment_overdue', 'financial', 'Payment Overdue', 'Invoice payment is overdue', 'medium', 20, true),

-- Cross-shipment patterns
('multiple_shipments_same_vessel', 'cross_shipment', 'Multiple Shipments Same Vessel', 'Multiple active shipments on same vessel', 'low', 5, true),
('port_congestion_impact', 'cross_shipment', 'Port Congestion Impact', 'Destination port experiencing congestion', 'medium', 15, true),
('carrier_schedule_change', 'cross_shipment', 'Carrier Schedule Change', 'Carrier has announced schedule changes affecting route', 'medium', 15, true),

-- Blocker patterns
('customs_hold_active', 'blocker', 'Customs Hold Active', 'Shipment has active customs hold', 'critical', 50, true),
('missing_document_blocking', 'blocker', 'Missing Document Blocking', 'Missing document is blocking shipment progress', 'high', 35, true),
('awaiting_stakeholder_response', 'blocker', 'Awaiting Stakeholder Response', 'Waiting on response from stakeholder for >48 hours', 'medium', 20, true),
('task_overdue', 'blocker', 'Overdue Task', 'Task is overdue and blocking progress', 'high', 25, true)

ON CONFLICT (pattern_code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  severity = EXCLUDED.severity,
  priority_boost = EXCLUDED.priority_boost,
  updated_at = NOW();
