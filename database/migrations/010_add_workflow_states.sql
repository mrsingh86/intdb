-- ============================================================================
-- MIGRATION 010: ADD SHIPMENT WORKFLOW STATES
-- ============================================================================
-- Purpose: Granular workflow state tracking for shipments
-- Enables tracking of 16 distinct states across 4 phases
-- ============================================================================

-- Workflow States Definition Table
CREATE TABLE IF NOT EXISTS shipment_workflow_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase VARCHAR(50) NOT NULL,  -- pre_departure, in_transit, arrival, delivery
  state_code VARCHAR(100) NOT NULL UNIQUE,
  state_name VARCHAR(200) NOT NULL,
  state_order INTEGER NOT NULL,
  requires_document_types TEXT[],  -- Documents that can trigger this state
  next_states TEXT[],  -- Valid transitions from this state
  is_optional BOOLEAN DEFAULT false,  -- Can be skipped
  is_milestone BOOLEAN DEFAULT false,  -- Important milestone
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workflow_phase ON shipment_workflow_states(phase);
CREATE INDEX IF NOT EXISTS idx_workflow_order ON shipment_workflow_states(state_order);

-- Comments
COMMENT ON TABLE shipment_workflow_states IS 'Defines all possible workflow states for shipments';
COMMENT ON COLUMN shipment_workflow_states.phase IS 'Phase: pre_departure, in_transit, arrival, delivery';
COMMENT ON COLUMN shipment_workflow_states.state_order IS 'Numeric order for state progression';
COMMENT ON COLUMN shipment_workflow_states.requires_document_types IS 'Document types that can trigger transition to this state';
COMMENT ON COLUMN shipment_workflow_states.next_states IS 'Valid next states from this state';

-- ============================================================================
-- SEED DATA: Workflow States
-- ============================================================================

-- PRE-DEPARTURE PHASE
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, next_states, is_optional, is_milestone, description) VALUES
('pre_departure', 'booking_confirmation_received', 'Booking Confirmation Received', 10,
 ARRAY['booking_confirmation'],
 ARRAY['booking_confirmation_shared'],
 false, true,
 'Initial booking confirmation received from shipping line'),

('pre_departure', 'booking_confirmation_shared', 'Booking Confirmation Shared', 20,
 NULL,
 ARRAY['commercial_invoice_received', 'packing_list_received', 'si_draft_received'],
 false, false,
 'Booking confirmation shared with customer'),

('pre_departure', 'commercial_invoice_received', 'Commercial Invoice Received', 30,
 ARRAY['commercial_invoice'],
 ARRAY['packing_list_received', 'si_draft_received'],
 true, false,
 'Commercial invoice received from shipper'),

('pre_departure', 'packing_list_received', 'Packing List Received', 40,
 ARRAY['packing_list'],
 ARRAY['si_draft_received'],
 true, false,
 'Packing list received from shipper'),

('pre_departure', 'si_draft_received', 'SI Draft Received', 50,
 ARRAY['si_draft'],
 ARRAY['checklist_approved', 'si_confirmed'],
 false, true,
 'Shipping Instructions draft received from shipper'),

('pre_departure', 'checklist_approved', 'Checklist Approved', 55,
 ARRAY['checklist'],
 ARRAY['si_confirmed'],
 true, false,
 'Customer checklist approved for SI submission'),

('pre_departure', 'si_confirmed', 'SI Confirmed', 60,
 ARRAY['si_confirmation'],
 ARRAY['hbl_draft_sent'],
 false, true,
 'Shipping Instructions confirmed by shipping line'),

-- IN-TRANSIT PHASE
('in_transit', 'hbl_draft_sent', 'HBL Draft Sent', 70,
 ARRAY['house_bl'],
 ARRAY['invoice_sent'],
 false, true,
 'House Bill of Lading draft sent to customer'),

('in_transit', 'invoice_sent', 'Invoice Sent', 80,
 ARRAY['freight_invoice'],
 ARRAY['hbl_released'],
 false, false,
 'Freight invoice sent to customer'),

('in_transit', 'hbl_released', 'HBL Released', 90,
 NULL,
 ARRAY['arrival_notice_received'],
 false, true,
 'House Bill of Lading released to customer'),

-- ARRIVAL PHASE
('arrival', 'arrival_notice_received', 'Arrival Notice Received', 100,
 ARRAY['arrival_notice'],
 ARRAY['arrival_notice_shared'],
 false, true,
 'Arrival notice received from shipping line'),

('arrival', 'arrival_notice_shared', 'Arrival Notice Shared', 110,
 NULL,
 ARRAY['entry_summary_approved'],
 false, false,
 'Arrival notice shared with consignee/partner'),

('arrival', 'entry_summary_approved', 'Entry Summary Approved', 120,
 ARRAY['entry_summary'],
 ARRAY['customs_invoice_received'],
 false, true,
 'Customs entry summary approved by customer'),

('arrival', 'customs_invoice_received', 'Customs Invoice Received', 130,
 ARRAY['customs_document', 'customs_invoice'],
 ARRAY['duty_summary_shared'],
 false, false,
 'Customs invoice received from customs broker'),

('arrival', 'duty_summary_shared', 'Duty Summary Shared', 140,
 ARRAY['duty_summary'],
 ARRAY['pod_received'],
 false, false,
 'Duty summary shared with customer'),

-- DELIVERY PHASE
('delivery', 'pod_received', 'POD Received', 150,
 ARRAY['pod', 'delivery_confirmation'],
 NULL,
 false, true,
 'Proof of Delivery received - shipment complete')

ON CONFLICT (state_code) DO UPDATE SET
  state_name = EXCLUDED.state_name,
  requires_document_types = EXCLUDED.requires_document_types,
  next_states = EXCLUDED.next_states,
  is_optional = EXCLUDED.is_optional,
  is_milestone = EXCLUDED.is_milestone,
  description = EXCLUDED.description;

-- ============================================================================
-- Shipment Workflow History Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS shipment_workflow_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  from_state VARCHAR(100),
  to_state VARCHAR(100) NOT NULL,
  triggered_by_document_type VARCHAR(100),
  triggered_by_email_id UUID REFERENCES raw_emails(id),
  triggered_by_user_id UUID,
  transition_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workflow_history_shipment ON shipment_workflow_history(shipment_id);
CREATE INDEX IF NOT EXISTS idx_workflow_history_state ON shipment_workflow_history(to_state);
CREATE INDEX IF NOT EXISTS idx_workflow_history_created ON shipment_workflow_history(created_at DESC);

COMMENT ON TABLE shipment_workflow_history IS 'Audit trail of all workflow state transitions';

-- ============================================================================
-- Add workflow columns to shipments table
-- ============================================================================
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS workflow_state VARCHAR(100);

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS workflow_phase VARCHAR(50);

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS workflow_state_updated_at TIMESTAMP WITH TIME ZONE;

-- Index for workflow queries
CREATE INDEX IF NOT EXISTS idx_shipments_workflow_state ON shipments(workflow_state);
CREATE INDEX IF NOT EXISTS idx_shipments_workflow_phase ON shipments(workflow_phase);

COMMENT ON COLUMN shipments.workflow_state IS 'Current workflow state code';
COMMENT ON COLUMN shipments.workflow_phase IS 'Current workflow phase';
COMMENT ON COLUMN shipments.workflow_state_updated_at IS 'When workflow state last changed';

-- ============================================================================
-- END MIGRATION 010
-- ============================================================================
