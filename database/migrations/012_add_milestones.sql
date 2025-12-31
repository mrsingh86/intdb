-- ============================================================================
-- MIGRATION 012: ADD SHIPMENT MILESTONES
-- ============================================================================
-- Purpose: Track operational notifications and milestones
-- Examples: VGM Confirmation, Empty Pickup, Container Discharged, Rollover
-- ============================================================================

-- Milestone Definitions Table
CREATE TABLE IF NOT EXISTS milestone_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_code VARCHAR(100) NOT NULL UNIQUE,
  milestone_name VARCHAR(200) NOT NULL,
  milestone_phase VARCHAR(50) NOT NULL,  -- pre_departure, in_transit, arrival, delivery
  milestone_order INTEGER NOT NULL,
  document_types TEXT[],  -- Document types that can trigger this milestone
  is_critical BOOLEAN DEFAULT false,
  expected_days_before_etd INTEGER,  -- For pre-departure milestones
  expected_days_after_eta INTEGER,   -- For arrival/delivery milestones
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_milestone_def_phase ON milestone_definitions(milestone_phase);
CREATE INDEX IF NOT EXISTS idx_milestone_def_order ON milestone_definitions(milestone_order);

-- Comments
COMMENT ON TABLE milestone_definitions IS 'Defines all possible milestones in shipment lifecycle';
COMMENT ON COLUMN milestone_definitions.document_types IS 'Document types that can trigger this milestone';
COMMENT ON COLUMN milestone_definitions.is_critical IS 'Whether this milestone is critical for shipment progress';

-- ============================================================================
-- SEED DATA: Milestone Definitions
-- ============================================================================

INSERT INTO milestone_definitions (milestone_code, milestone_name, milestone_phase, milestone_order, document_types, is_critical, expected_days_before_etd, expected_days_after_eta, description) VALUES

-- PRE-DEPARTURE MILESTONES
('booking_confirmed', 'Booking Confirmed', 'pre_departure', 10,
 ARRAY['booking_confirmation'],
 true, 14, NULL,
 'Booking confirmed by shipping line'),

('empty_container_released', 'Empty Container Released', 'pre_departure', 20,
 ARRAY['container_release', 'empty_release'],
 true, 7, NULL,
 'Empty container released for pickup'),

('container_picked_up', 'Container Picked Up', 'pre_departure', 30,
 ARRAY['pickup_confirmation'],
 false, 5, NULL,
 'Empty container picked up from yard'),

('container_stuffed', 'Container Stuffed', 'pre_departure', 40,
 ARRAY['stuffing_confirmation'],
 false, 4, NULL,
 'Container stuffed with cargo'),

('vgm_submitted', 'VGM Submitted', 'pre_departure', 50,
 ARRAY['vgm_confirmation'],
 true, 3, NULL,
 'Verified Gross Mass submitted to shipping line'),

('si_submitted', 'SI Submitted', 'pre_departure', 60,
 ARRAY['si_confirmation'],
 true, 3, NULL,
 'Shipping Instructions submitted to line'),

('container_gated_in', 'Container Gated In', 'pre_departure', 70,
 ARRAY['gate_in_confirmation'],
 true, 2, NULL,
 'Container gated into port terminal'),

('docs_on_board', 'Documents On Board', 'pre_departure', 80,
 ARRAY['docs_on_board'],
 false, 1, NULL,
 'Shipping documents confirmed on board'),

('vessel_departed', 'Vessel Departed', 'pre_departure', 90,
 ARRAY['departure_notice', 'sailing_confirmation'],
 true, 0, NULL,
 'Vessel departed from port of loading'),

-- IN-TRANSIT MILESTONES
('transhipment_arrival', 'Transhipment Arrival', 'in_transit', 100,
 ARRAY['transhipment_notice'],
 false, NULL, NULL,
 'Container arrived at transhipment port'),

('transhipment_loaded', 'Transhipment Loaded', 'in_transit', 110,
 ARRAY['transhipment_confirmation'],
 false, NULL, NULL,
 'Container loaded on connecting vessel'),

('hbl_released', 'HBL Released', 'in_transit', 120,
 ARRAY['house_bl'],
 true, NULL, NULL,
 'House Bill of Lading released'),

-- ARRIVAL MILESTONES
('vessel_arrived', 'Vessel Arrived', 'arrival', 130,
 ARRAY['arrival_notice'],
 true, NULL, 0,
 'Vessel arrived at destination port'),

('container_discharged', 'Container Discharged', 'arrival', 140,
 ARRAY['discharge_notice'],
 true, NULL, 1,
 'Container discharged from vessel'),

('customs_filed', 'Customs Entry Filed', 'arrival', 150,
 ARRAY['entry_summary'],
 true, NULL, 2,
 'Customs entry filed with authorities'),

('customs_exam', 'Customs Exam', 'arrival', 155,
 ARRAY['exam_notice'],
 false, NULL, 3,
 'Container selected for customs examination'),

('customs_cleared', 'Customs Cleared', 'arrival', 160,
 ARRAY['customs_release', 'clearance_notice'],
 true, NULL, 4,
 'Container cleared by customs'),

('do_released', 'D/O Released', 'arrival', 170,
 ARRAY['delivery_order'],
 true, NULL, 5,
 'Delivery Order released'),

-- DELIVERY MILESTONES
('out_for_delivery', 'Out for Delivery', 'delivery', 180,
 ARRAY['dispatch_notice'],
 false, NULL, 6,
 'Container dispatched for delivery'),

('delivered', 'Delivered', 'delivery', 190,
 ARRAY['pod', 'delivery_confirmation'],
 true, NULL, 7,
 'Container delivered to consignee'),

('empty_returned', 'Empty Returned', 'delivery', 200,
 ARRAY['empty_return_confirmation'],
 false, NULL, 10,
 'Empty container returned to depot')

ON CONFLICT (milestone_code) DO UPDATE SET
  milestone_name = EXCLUDED.milestone_name,
  milestone_phase = EXCLUDED.milestone_phase,
  milestone_order = EXCLUDED.milestone_order,
  document_types = EXCLUDED.document_types,
  is_critical = EXCLUDED.is_critical,
  expected_days_before_etd = EXCLUDED.expected_days_before_etd,
  expected_days_after_eta = EXCLUDED.expected_days_after_eta,
  description = EXCLUDED.description;

-- ============================================================================
-- Shipment Milestones Tracking Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS shipment_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  milestone_code VARCHAR(100) NOT NULL,

  -- Status
  milestone_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  -- Values: pending, expected, achieved, missed, skipped, not_applicable

  -- Timing
  expected_date TIMESTAMP WITH TIME ZONE,
  achieved_date TIMESTAMP WITH TIME ZONE,
  missed_since TIMESTAMP WITH TIME ZONE,

  -- Source
  triggered_by_email_id UUID REFERENCES raw_emails(id),
  triggered_by_user_id UUID,

  -- Details
  metadata JSONB DEFAULT '{}',
  notes TEXT,

  -- Audit
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  UNIQUE(shipment_id, milestone_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ship_milestone_shipment ON shipment_milestones(shipment_id);
CREATE INDEX IF NOT EXISTS idx_ship_milestone_code ON shipment_milestones(milestone_code);
CREATE INDEX IF NOT EXISTS idx_ship_milestone_status ON shipment_milestones(milestone_status);
CREATE INDEX IF NOT EXISTS idx_ship_milestone_expected ON shipment_milestones(expected_date);
CREATE INDEX IF NOT EXISTS idx_ship_milestone_achieved ON shipment_milestones(achieved_date);

-- Comments
COMMENT ON TABLE shipment_milestones IS 'Tracks milestone status for each shipment';
COMMENT ON COLUMN shipment_milestones.milestone_status IS 'Status: pending, expected, achieved, missed, skipped';
COMMENT ON COLUMN shipment_milestones.expected_date IS 'When milestone is expected (calculated from ETD/ETA)';
COMMENT ON COLUMN shipment_milestones.achieved_date IS 'When milestone was actually achieved';

-- ============================================================================
-- Milestone Alerts Table (for missed/approaching)
-- ============================================================================
CREATE TABLE IF NOT EXISTS milestone_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES shipment_milestones(id) ON DELETE CASCADE,

  alert_type VARCHAR(50) NOT NULL,  -- approaching, missed, overdue
  alert_severity VARCHAR(20) NOT NULL DEFAULT 'warning',  -- critical, warning, info
  alert_message TEXT NOT NULL,

  is_acknowledged BOOLEAN DEFAULT false,
  acknowledged_by UUID,
  acknowledged_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_milestone_alert_shipment ON milestone_alerts(shipment_id);
CREATE INDEX IF NOT EXISTS idx_milestone_alert_type ON milestone_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_milestone_alert_ack ON milestone_alerts(is_acknowledged);

-- Comments
COMMENT ON TABLE milestone_alerts IS 'Alerts for approaching or missed milestones';

-- ============================================================================
-- Add milestone summary to shipments
-- ============================================================================
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS milestones_total INTEGER DEFAULT 0;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS milestones_achieved INTEGER DEFAULT 0;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS milestones_missed INTEGER DEFAULT 0;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS next_milestone VARCHAR(100);

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS next_milestone_date TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN shipments.milestones_total IS 'Total applicable milestones for this shipment';
COMMENT ON COLUMN shipments.milestones_achieved IS 'Number of milestones achieved';
COMMENT ON COLUMN shipments.milestones_missed IS 'Number of milestones missed';
COMMENT ON COLUMN shipments.next_milestone IS 'Next expected milestone code';

-- ============================================================================
-- END MIGRATION 012
-- ============================================================================
