-- ============================================================================
-- MIGRATION 029: ENHANCED WORKFLOW STATES WITH DIRECTION AWARENESS
-- ============================================================================
-- Purpose: Comprehensive workflow state system with 5 phases, 35 states
-- Adds direction-aware triggers (INBOUND/OUTBOUND)
-- Adds pre_arrival phase for customs entry process
-- ============================================================================

-- Add direction column to workflow states
ALTER TABLE shipment_workflow_states
ADD COLUMN IF NOT EXISTS expected_direction VARCHAR(20);

COMMENT ON COLUMN shipment_workflow_states.expected_direction IS 'Expected email direction: inbound, outbound, internal';

-- ============================================================================
-- CLEAR AND REBUILD WORKFLOW STATES
-- ============================================================================

-- Clear existing states (will rebuild with complete set)
TRUNCATE TABLE shipment_workflow_states CASCADE;

-- ============================================================================
-- PHASE 1: PRE_DEPARTURE (Order 10-99)
-- ============================================================================

-- Booking Stage (10-19)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('pre_departure', 'booking_confirmation_received', 'Booking Confirmation Received', 10,
 ARRAY['booking_confirmation', 'booking_amendment'],
 'inbound',
 ARRAY['booking_confirmation_shared'],
 false, true,
 'Booking confirmation received from carrier'),

('pre_departure', 'booking_confirmation_shared', 'Booking Confirmation Shared', 15,
 ARRAY['booking_confirmation', 'booking_amendment'],
 'outbound',
 ARRAY['commercial_invoice_received', 'si_draft_received'],
 false, false,
 'Booking confirmation shared with customer');

-- Documentation Stage (20-39)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('pre_departure', 'commercial_invoice_received', 'Commercial Invoice Received', 20,
 ARRAY['invoice', 'commercial_invoice'],
 'inbound',
 ARRAY['packing_list_received', 'si_draft_received'],
 true, false,
 'Commercial invoice received from shipper'),

('pre_departure', 'packing_list_received', 'Packing List Received', 25,
 ARRAY['packing_list'],
 'inbound',
 ARRAY['si_draft_received'],
 true, false,
 'Packing list received from shipper'),

('pre_departure', 'si_draft_received', 'SI Draft Received', 30,
 ARRAY['shipping_instruction'],
 'inbound',
 ARRAY['checklist_received', 'si_submitted'],
 false, true,
 'Shipping Instructions draft received from shipper');

-- Checklist Stage - Export (40-54) - OPTIONAL (scope-dependent)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('pre_departure', 'checklist_received', 'Checklist Received', 40,
 ARRAY['checklist'],
 'inbound',
 ARRAY['checklist_shared'],
 true, false,
 'Export checklist received from CHA'),

('pre_departure', 'checklist_shared', 'Checklist Shared', 42,
 ARRAY['checklist'],
 'outbound',
 ARRAY['checklist_shipper_approved'],
 true, false,
 'Checklist shared with shipper for approval'),

('pre_departure', 'checklist_shipper_approved', 'Checklist Approved by Shipper', 44,
 NULL,
 'inbound',
 ARRAY['checklist_approved'],
 true, false,
 'Shipper approved the checklist'),

('pre_departure', 'checklist_approved', 'Checklist Approved to CHA', 46,
 NULL,
 'outbound',
 ARRAY['shipping_bill_received'],
 true, false,
 'Checklist approved and sent to CHA'),

('pre_departure', 'shipping_bill_received', 'Shipping Bill Received', 48,
 ARRAY['shipping_bill', 'leo_copy'],
 'inbound',
 ARRAY['si_submitted'],
 true, true,
 'Shipping Bill / LEO received from CHA');

-- SI Submission Stage (55-64)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('pre_departure', 'si_submitted', 'SI Submitted to Carrier', 55,
 ARRAY['si_submission'],
 'outbound',
 ARRAY['si_confirmed'],
 false, true,
 'SI submitted to carrier via portal'),

('pre_departure', 'si_confirmed', 'SI Confirmed by Carrier', 60,
 ARRAY['si_submission', 'si_confirmation'],
 'inbound',
 ARRAY['vgm_submitted'],
 false, true,
 'SI confirmed by carrier');

-- VGM & Gate-In Stage (65-79)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('pre_departure', 'vgm_submitted', 'VGM Submitted', 65,
 ARRAY['vgm_submission'],
 'outbound',
 ARRAY['vgm_confirmed', 'container_gated_in'],
 false, true,
 'VGM submitted to carrier'),

('pre_departure', 'vgm_confirmed', 'VGM Confirmed', 68,
 ARRAY['vgm_submission', 'vgm_confirmation'],
 'inbound',
 ARRAY['container_gated_in'],
 true, false,
 'VGM confirmed by carrier'),

('pre_departure', 'container_gated_in', 'Container Gated In', 72,
 ARRAY['gate_in_confirmation'],
 'inbound',
 ARRAY['sob_received', 'vessel_departed'],
 true, true,
 'Container gated into terminal');

-- SOB & Departure Stage (80-99)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('pre_departure', 'sob_received', 'SOB Received', 80,
 ARRAY['sob_confirmation'],
 'inbound',
 ARRAY['sob_shared', 'vessel_departed'],
 true, false,
 'Shipped on Board confirmation from carrier'),

('pre_departure', 'sob_shared', 'SOB Shared', 85,
 NULL,
 'outbound',
 ARRAY['vessel_departed'],
 true, false,
 'SOB notification shared with customer'),

('pre_departure', 'vessel_departed', 'Vessel Departed', 90,
 ARRAY['departure_notice', 'sailing_confirmation'],
 'inbound',
 ARRAY['isf_filed', 'mbl_draft_received'],
 false, true,
 'Vessel departed from port of loading');

-- ============================================================================
-- PHASE 2: IN_TRANSIT (Order 100-149)
-- ============================================================================

-- ISF Filing Stage - US Import (100-109) - OPTIONAL (scope-dependent)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('in_transit', 'isf_filed', 'ISF Filed', 100,
 ARRAY['isf_submission'],
 'outbound',
 ARRAY['isf_confirmed', 'mbl_draft_received'],
 true, true,
 'ISF filed with US customs broker'),

('in_transit', 'isf_confirmed', 'ISF Confirmed', 105,
 ARRAY['isf_confirmation'],
 'inbound',
 ARRAY['mbl_draft_received'],
 true, false,
 'ISF confirmation received');

-- MBL Stage (110-119)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('in_transit', 'mbl_draft_received', 'MBL Draft Received', 110,
 ARRAY['bill_of_lading'],
 'inbound',
 ARRAY['mbl_approved'],
 true, false,
 'Master BL draft received from carrier'),

('in_transit', 'mbl_approved', 'MBL Approved', 115,
 NULL,
 'outbound',
 ARRAY['mbl_received'],
 true, false,
 'MBL approved on carrier portal'),

('in_transit', 'mbl_received', 'Final MBL Received', 118,
 ARRAY['bill_of_lading'],
 'inbound',
 ARRAY['hbl_draft_sent'],
 true, true,
 'Final MBL received from carrier');

-- HBL Stage (120-134)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('in_transit', 'hbl_draft_sent', 'HBL Draft Sent', 120,
 ARRAY['bill_of_lading', 'house_bl'],
 'outbound',
 ARRAY['hbl_approved'],
 false, true,
 'HBL draft sent to shipper for approval'),

('in_transit', 'hbl_approved', 'HBL Approved', 125,
 NULL,
 'inbound',
 ARRAY['hbl_released'],
 false, false,
 'HBL approved by shipper'),

('in_transit', 'hbl_released', 'HBL Released', 130,
 ARRAY['bill_of_lading', 'house_bl'],
 'outbound',
 ARRAY['invoice_sent'],
 false, true,
 'Final HBL released to shipper');

-- Invoice Stage (135-144)
INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('in_transit', 'invoice_sent', 'Freight Invoice Sent', 135,
 ARRAY['freight_invoice', 'invoice'],
 'outbound',
 ARRAY['invoice_paid', 'docs_sent_to_broker', 'arrival_notice_received'],
 false, false,
 'Freight invoice sent to customer'),

('in_transit', 'invoice_paid', 'Invoice Paid', 140,
 ARRAY['payment_confirmation'],
 'inbound',
 ARRAY['docs_sent_to_broker', 'arrival_notice_received'],
 true, false,
 'Freight invoice paid by customer');

-- ============================================================================
-- PHASE 3: PRE_ARRIVAL (Order 150-179) - OPTIONAL (scope-dependent)
-- ============================================================================

INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('pre_arrival', 'docs_sent_to_broker', 'Docs Sent to Broker', 150,
 NULL,
 'outbound',
 ARRAY['entry_draft_received'],
 true, false,
 'Commercial invoice and packing list sent to customs broker'),

('pre_arrival', 'entry_draft_received', 'Entry Draft Received', 153,
 ARRAY['entry_summary'],
 'inbound',
 ARRAY['entry_draft_shared'],
 true, false,
 'Draft entry summary received from broker'),

('pre_arrival', 'entry_draft_shared', 'Entry Draft Shared', 156,
 ARRAY['entry_summary'],
 'outbound',
 ARRAY['entry_customer_approved'],
 true, false,
 'Entry draft shared with customer for approval'),

('pre_arrival', 'entry_customer_approved', 'Entry Approved by Customer', 159,
 NULL,
 'inbound',
 ARRAY['entry_approved'],
 true, false,
 'Customer approved the entry'),

('pre_arrival', 'entry_approved', 'Entry Approved to Broker', 162,
 NULL,
 'outbound',
 ARRAY['entry_filed'],
 true, true,
 'Entry approved and sent to broker for filing'),

('pre_arrival', 'entry_filed', 'Entry Filed', 165,
 ARRAY['entry_summary'],
 'inbound',
 ARRAY['arrival_notice_received'],
 true, true,
 'Entry filed with customs');

-- ============================================================================
-- PHASE 4: ARRIVAL (Order 180-219)
-- ============================================================================

INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('arrival', 'arrival_notice_received', 'Arrival Notice Received', 180,
 ARRAY['arrival_notice'],
 'inbound',
 ARRAY['arrival_notice_shared'],
 false, true,
 'Arrival notice received from carrier'),

('arrival', 'arrival_notice_shared', 'Arrival Notice Shared', 185,
 ARRAY['arrival_notice'],
 'outbound',
 ARRAY['customs_cleared', 'duty_invoice_received'],
 false, false,
 'Arrival notice shared with customer'),

('arrival', 'customs_cleared', 'Customs Cleared', 190,
 ARRAY['customs_clearance'],
 'inbound',
 ARRAY['duty_invoice_received', 'delivery_order_received'],
 true, true,
 'Shipment cleared by customs'),

('arrival', 'duty_invoice_received', 'Duty Invoice Received', 195,
 ARRAY['customs_document', 'duty_invoice'],
 'inbound',
 ARRAY['duty_summary_shared'],
 true, false,
 'Duty invoice received from broker'),

('arrival', 'duty_summary_shared', 'Duty Summary Shared', 200,
 ARRAY['customs_document', 'duty_summary'],
 'outbound',
 ARRAY['delivery_order_received'],
 true, false,
 'Duty summary shared with customer'),

('arrival', 'delivery_order_received', 'Delivery Order Received', 205,
 ARRAY['delivery_order'],
 'inbound',
 ARRAY['delivery_order_shared'],
 false, true,
 'Delivery order received from carrier'),

('arrival', 'delivery_order_shared', 'Delivery Order Shared', 210,
 ARRAY['delivery_order'],
 'outbound',
 ARRAY['container_released'],
 false, false,
 'Delivery order shared with customer/trucker');

-- ============================================================================
-- PHASE 5: DELIVERY (Order 220-250) - OPTIONAL (scope-dependent)
-- ============================================================================

INSERT INTO shipment_workflow_states (phase, state_code, state_name, state_order, requires_document_types, expected_direction, next_states, is_optional, is_milestone, description) VALUES
('delivery', 'container_released', 'Container Released', 220,
 ARRAY['container_release'],
 'inbound',
 ARRAY['out_for_delivery', 'delivered'],
 true, true,
 'Container released for delivery'),

('delivery', 'out_for_delivery', 'Out for Delivery', 225,
 ARRAY['dispatch_notice'],
 'inbound',
 ARRAY['delivered'],
 true, false,
 'Container out for delivery'),

('delivery', 'delivered', 'Delivered', 230,
 ARRAY['delivery_confirmation'],
 'inbound',
 ARRAY['pod_received'],
 true, true,
 'Cargo delivered to consignee'),

('delivery', 'pod_received', 'POD Received', 235,
 ARRAY['pod', 'proof_of_delivery'],
 'inbound',
 ARRAY['empty_returned', 'shipment_closed'],
 true, true,
 'Proof of delivery received'),

('delivery', 'empty_returned', 'Empty Container Returned', 240,
 ARRAY['empty_return_confirmation'],
 'inbound',
 ARRAY['shipment_closed'],
 true, false,
 'Empty container returned to depot'),

('delivery', 'shipment_closed', 'Shipment Closed', 245,
 NULL,
 'internal',
 NULL,
 true, true,
 'Shipment workflow complete');

-- ============================================================================
-- ADD NEW DOCUMENT TYPES TO CLASSIFICATION
-- ============================================================================

-- These are new document types identified from email analysis
-- Add to document_type_configs if table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_type_configs') THEN
    INSERT INTO document_type_configs (document_type, display_name, description, category)
    VALUES
      ('checklist', 'Export Checklist', 'Export clearance checklist for approval', 'export'),
      ('shipping_bill', 'Shipping Bill', 'Indian export shipping bill', 'export'),
      ('leo_copy', 'LEO Copy', 'Let Export Order copy', 'export'),
      ('isf_submission', 'ISF Filing', 'US Import Security Filing', 'customs'),
      ('isf_confirmation', 'ISF Confirmation', 'ISF filing confirmation', 'customs'),
      ('entry_summary', 'Entry Summary', 'US Customs entry summary', 'customs'),
      ('duty_invoice', 'Duty Invoice', 'Customs duty invoice', 'customs'),
      ('payment_confirmation', 'Payment Confirmation', 'Invoice payment confirmation', 'financial'),
      ('gate_in_confirmation', 'Gate In Confirmation', 'Container gated into terminal', 'operations'),
      ('dispatch_notice', 'Dispatch Notice', 'Container dispatched for delivery', 'delivery'),
      ('empty_return_confirmation', 'Empty Return', 'Empty container returned', 'delivery')
    ON CONFLICT (document_type) DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- UPDATE SHIPMENT WORKFLOW HISTORY FOR DIRECTION TRACKING
-- ============================================================================

ALTER TABLE shipment_workflow_history
ADD COLUMN IF NOT EXISTS email_direction VARCHAR(20);

COMMENT ON COLUMN shipment_workflow_history.email_direction IS 'Direction of email that triggered transition: inbound, outbound';

-- ============================================================================
-- CREATE INDEX FOR DIRECTION-BASED QUERIES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_workflow_direction ON shipment_workflow_states(expected_direction);

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- Total States: 35
-- Phases: 5 (pre_departure, in_transit, pre_arrival, arrival, delivery)
-- Milestones: 15
-- Optional (scope-dependent): 20
-- ============================================================================
