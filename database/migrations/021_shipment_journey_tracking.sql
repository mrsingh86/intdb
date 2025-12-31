-- Migration 021: Shipment Journey Tracking
-- Adds comprehensive journey tracking: response detection, acknowledgment workflow,
-- communication timeline, and shipment blockers

-- ============================================================================
-- 1. RESPONSE TRACKING - Link inbound responses to outbound emails
-- ============================================================================

-- Add response tracking fields to raw_emails
ALTER TABLE raw_emails
ADD COLUMN IF NOT EXISTS in_reply_to_message_id VARCHAR(200),
ADD COLUMN IF NOT EXISTS is_response BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS responds_to_email_id UUID REFERENCES raw_emails(id),
ADD COLUMN IF NOT EXISTS response_time_hours DECIMAL(10,2);

CREATE INDEX IF NOT EXISTS idx_raw_emails_in_reply_to ON raw_emails(in_reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_raw_emails_responds_to ON raw_emails(responds_to_email_id);

-- Function to auto-detect and link responses
CREATE OR REPLACE FUNCTION detect_email_response()
RETURNS TRIGGER AS $$
DECLARE
  original_email_id UUID;
  original_received_at TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Skip if no reply-to reference
  IF NEW.in_reply_to_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the original email
  SELECT id, received_at INTO original_email_id, original_received_at
  FROM raw_emails
  WHERE gmail_message_id = NEW.in_reply_to_message_id
  LIMIT 1;

  IF original_email_id IS NOT NULL THEN
    NEW.is_response := true;
    NEW.responds_to_email_id := original_email_id;
    NEW.response_time_hours := EXTRACT(EPOCH FROM (NEW.received_at - original_received_at)) / 3600.0;

    -- Update communication_log if this is response to Action Center email
    UPDATE communication_log
    SET response_received = true,
        response_email_id = NEW.id,
        response_received_at = NEW.received_at
    WHERE gmail_message_id = NEW.in_reply_to_message_id
      AND response_received = false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_detect_email_response ON raw_emails;
CREATE TRIGGER trigger_detect_email_response
  BEFORE INSERT ON raw_emails
  FOR EACH ROW
  EXECUTE FUNCTION detect_email_response();

-- ============================================================================
-- 2. DOCUMENT ACKNOWLEDGMENT WORKFLOW
-- ============================================================================

-- Add acknowledgment tracking to document_lifecycle
ALTER TABLE document_lifecycle
ADD COLUMN IF NOT EXISTS acknowledgment_required BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS acknowledgment_due_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS acknowledged_by_party_id UUID REFERENCES parties(id),
ADD COLUMN IF NOT EXISTS acknowledgment_email_id UUID REFERENCES raw_emails(id),
ADD COLUMN IF NOT EXISTS acknowledgment_method VARCHAR(50),
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Acknowledgment pattern detection rules
CREATE TABLE IF NOT EXISTS document_acknowledgment_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(100) NOT NULL,
  acknowledgment_keywords TEXT[] NOT NULL,
  rejection_keywords TEXT[],
  expected_responder_party_type VARCHAR(50),
  default_due_hours INTEGER DEFAULT 48,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default acknowledgment patterns
INSERT INTO document_acknowledgment_patterns (document_type, acknowledgment_keywords, rejection_keywords, expected_responder_party_type, default_due_hours) VALUES
('si_draft', ARRAY['approved', 'confirmed', 'SI approved', 'looks good', 'proceed', 'ok to release'], ARRAY['reject', 'changes needed', 'correction required', 'incorrect'], 'shipper', 24),
('hbl_draft', ARRAY['approved', 'confirmed', 'HBL approved', 'release ok'], ARRAY['reject', 'amendment', 'correction'], 'shipper', 48),
('checklist', ARRAY['approved', 'confirmed', 'checklist ok'], ARRAY['discrepancy', 'mismatch', 'incorrect'], 'shipper', 24),
('commercial_invoice', ARRAY['received', 'acknowledged'], NULL, 'consignee', 72),
('arrival_notice', ARRAY['received', 'acknowledged', 'noted'], NULL, 'consignee', 24)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 3. STAKEHOLDER COMMUNICATION TIMELINE
-- ============================================================================

CREATE TABLE IF NOT EXISTS stakeholder_communication_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linked entities
  party_id UUID REFERENCES parties(id),
  shipment_id UUID REFERENCES shipments(id),

  -- Communication details
  direction VARCHAR(20) NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  communication_type VARCHAR(50) NOT NULL CHECK (communication_type IN ('email', 'task', 'notification', 'milestone')),

  -- Source references
  email_id UUID REFERENCES raw_emails(id),
  communication_log_id UUID REFERENCES communication_log(id),
  task_id UUID REFERENCES action_tasks(id),
  notification_id UUID REFERENCES notifications(id),
  document_lifecycle_id UUID REFERENCES document_lifecycle(id),

  -- Content summary
  subject VARCHAR(500),
  summary TEXT,
  document_type VARCHAR(100),

  -- Response tracking
  requires_response BOOLEAN DEFAULT false,
  response_due_date TIMESTAMP WITH TIME ZONE,
  response_received BOOLEAN DEFAULT false,
  response_timeline_id UUID REFERENCES stakeholder_communication_timeline(id),
  response_time_hours DECIMAL(10,2),

  -- Workflow impact
  triggered_workflow_state VARCHAR(100),
  triggered_milestone VARCHAR(100),

  -- Metadata
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_timeline_party ON stakeholder_communication_timeline(party_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_timeline_shipment ON stakeholder_communication_timeline(shipment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_timeline_awaiting ON stakeholder_communication_timeline(response_due_date)
  WHERE requires_response = true AND response_received = false;
CREATE INDEX IF NOT EXISTS idx_comm_timeline_type ON stakeholder_communication_timeline(communication_type, direction);

-- Function to auto-populate timeline from emails
CREATE OR REPLACE FUNCTION populate_communication_timeline()
RETURNS TRIGGER AS $$
DECLARE
  v_shipment_id UUID;
  v_party_id UUID;
  v_direction VARCHAR(20);
  v_doc_type VARCHAR(100);
  v_requires_response BOOLEAN := false;
  v_response_due_hours INTEGER;
BEGIN
  -- Determine direction based on sender
  IF NEW.sender_email ILIKE '%@intoglo.com' THEN
    v_direction := 'outbound';
  ELSE
    v_direction := 'inbound';
  END IF;

  -- Get shipment_id from shipment_documents
  SELECT sd.shipment_id INTO v_shipment_id
  FROM shipment_documents sd
  WHERE sd.email_id = NEW.id
  LIMIT 1;

  -- Get party_id from parties based on email domain
  SELECT p.id INTO v_party_id
  FROM parties p
  WHERE NEW.sender_email = ANY(p.email_domains)
    OR NEW.sender_email ILIKE '%@' || ANY(
      SELECT unnest(p.email_domains)
    )
  LIMIT 1;

  -- Get document type from classifications
  SELECT dc.document_type INTO v_doc_type
  FROM document_classifications dc
  WHERE dc.email_id = NEW.id
  LIMIT 1;

  -- Check if response is required (outbound emails to external parties)
  IF v_direction = 'outbound' AND v_doc_type IS NOT NULL THEN
    SELECT default_due_hours INTO v_response_due_hours
    FROM document_acknowledgment_patterns
    WHERE document_type = v_doc_type AND is_active = true
    LIMIT 1;

    IF v_response_due_hours IS NOT NULL THEN
      v_requires_response := true;
    END IF;
  END IF;

  -- Insert into timeline
  INSERT INTO stakeholder_communication_timeline (
    party_id, shipment_id, direction, communication_type,
    email_id, subject, document_type,
    requires_response, response_due_date, occurred_at
  ) VALUES (
    v_party_id, v_shipment_id, v_direction, 'email',
    NEW.id, NEW.subject, v_doc_type,
    v_requires_response,
    CASE WHEN v_requires_response THEN NEW.received_at + (v_response_due_hours || ' hours')::INTERVAL ELSE NULL END,
    NEW.received_at
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: Trigger created but disabled - enable after initial data load
-- DROP TRIGGER IF EXISTS trigger_populate_comm_timeline ON raw_emails;
-- CREATE TRIGGER trigger_populate_comm_timeline
--   AFTER INSERT ON raw_emails
--   FOR EACH ROW
--   EXECUTE FUNCTION populate_communication_timeline();

-- ============================================================================
-- 4. SHIPMENT BLOCKERS TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_blockers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  blocker_type VARCHAR(50) NOT NULL CHECK (blocker_type IN (
    'missing_document',
    'awaiting_approval',
    'awaiting_response',
    'customs_hold',
    'payment_pending',
    'milestone_missed',
    'task_overdue',
    'cutoff_passed',
    'discrepancy_unresolved'
  )),

  blocker_description TEXT NOT NULL,
  blocked_since TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- What's blocked
  blocks_workflow_state VARCHAR(100),
  blocks_milestone VARCHAR(100),
  blocks_document_type VARCHAR(100),

  -- Resolution
  is_resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID,
  resolution_notes TEXT,
  auto_resolved BOOLEAN DEFAULT false,

  -- Severity
  severity VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),

  -- Linked entities
  linked_task_id UUID REFERENCES action_tasks(id),
  linked_document_lifecycle_id UUID REFERENCES document_lifecycle(id),
  linked_notification_id UUID REFERENCES notifications(id),
  linked_email_id UUID REFERENCES raw_emails(id),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blockers_shipment ON shipment_blockers(shipment_id);
CREATE INDEX IF NOT EXISTS idx_blockers_unresolved ON shipment_blockers(blocked_since) WHERE is_resolved = false;
CREATE INDEX IF NOT EXISTS idx_blockers_severity ON shipment_blockers(severity, is_resolved);
CREATE INDEX IF NOT EXISTS idx_blockers_type ON shipment_blockers(blocker_type, is_resolved);

-- ============================================================================
-- 5. SHIPMENT JOURNEY STATUS VIEW
-- ============================================================================

CREATE OR REPLACE VIEW v_shipment_journey_status AS
SELECT
  s.id,
  s.booking_number,
  s.bl_number,
  s.status,
  s.workflow_phase,
  s.workflow_state,
  s.workflow_state_updated_at,
  s.etd,
  s.eta,

  -- Stakeholder info
  shipper.party_name as shipper_name,
  consignee.party_name as consignee_name,
  carrier.carrier_name,

  -- Document counts
  (SELECT COUNT(*) FROM shipment_documents sd WHERE sd.shipment_id = s.id) as total_documents,
  (SELECT COUNT(*) FROM document_lifecycle dl WHERE dl.shipment_id = s.id AND dl.lifecycle_status = 'approved') as docs_approved,
  (SELECT COUNT(*) FROM document_lifecycle dl WHERE dl.shipment_id = s.id AND dl.acknowledgment_required = true AND dl.acknowledged = false) as docs_awaiting_ack,
  (SELECT COUNT(*) FROM missing_document_alerts mda WHERE mda.shipment_id = s.id AND mda.alert_status = 'overdue') as docs_missing,

  -- Milestone progress
  (SELECT COUNT(*) FROM shipment_milestones sm WHERE sm.shipment_id = s.id AND sm.milestone_status = 'achieved') as milestones_completed,
  (SELECT COUNT(*) FROM shipment_milestones sm WHERE sm.shipment_id = s.id AND sm.milestone_status IN ('pending', 'expected')) as milestones_pending,
  (SELECT COUNT(*) FROM shipment_milestones sm WHERE sm.shipment_id = s.id AND sm.milestone_status = 'missed') as milestones_missed,

  -- Communication status
  (SELECT COUNT(*) FROM stakeholder_communication_timeline sct
   WHERE sct.shipment_id = s.id AND sct.requires_response = true AND sct.response_received = false) as emails_awaiting_response,

  -- Blocker status
  (SELECT COUNT(*) FROM shipment_blockers sb WHERE sb.shipment_id = s.id AND sb.is_resolved = false) as active_blockers,
  (SELECT COUNT(*) FROM shipment_blockers sb WHERE sb.shipment_id = s.id AND sb.is_resolved = false AND sb.severity = 'critical') as critical_blockers,

  -- Task status
  (SELECT COUNT(*) FROM action_tasks at WHERE at.shipment_id = s.id AND at.status IN ('pending', 'in_progress')) as pending_tasks,
  (SELECT COUNT(*) FROM action_tasks at WHERE at.shipment_id = s.id AND at.status IN ('pending', 'in_progress') AND at.priority IN ('critical', 'high')) as high_priority_tasks,

  -- Journey progress percentage
  CASE
    WHEN s.workflow_phase = 'delivery' AND s.workflow_state = 'pod_received' THEN 100
    WHEN s.workflow_phase = 'delivery' THEN 90
    WHEN s.workflow_phase = 'arrival' THEN 70
    WHEN s.workflow_phase = 'in_transit' THEN 50
    WHEN s.workflow_phase = 'pre_departure' THEN
      CASE s.workflow_state
        WHEN 'booking_confirmation_received' THEN 10
        WHEN 'booking_confirmation_shared' THEN 15
        WHEN 'commercial_invoice_received' THEN 20
        WHEN 'packing_list_received' THEN 25
        WHEN 'si_draft_received' THEN 30
        WHEN 'checklist_approved' THEN 35
        WHEN 'si_confirmed' THEN 40
        ELSE 5
      END
    ELSE 0
  END as journey_progress_pct,

  -- Days until ETD
  CASE WHEN s.etd IS NOT NULL THEN (s.etd::DATE - CURRENT_DATE) ELSE NULL END as days_to_etd,

  -- Cutoff warnings
  CASE WHEN s.si_cutoff IS NOT NULL AND s.si_cutoff::DATE <= CURRENT_DATE + 2 THEN true ELSE false END as si_cutoff_imminent,
  CASE WHEN s.vgm_cutoff IS NOT NULL AND s.vgm_cutoff::DATE <= CURRENT_DATE + 2 THEN true ELSE false END as vgm_cutoff_imminent,

  s.created_at,
  s.updated_at

FROM shipments s
LEFT JOIN parties shipper ON s.shipper_id = shipper.id
LEFT JOIN parties consignee ON s.consignee_id = consignee.id
LEFT JOIN carriers carrier ON s.carrier_id = carrier.id;

-- ============================================================================
-- 6. JOURNEY EVENT LOG (Unified timeline of all journey events)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipment_journey_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Event type hierarchy
  event_category VARCHAR(50) NOT NULL CHECK (event_category IN (
    'document',      -- Document received/sent/approved
    'workflow',      -- Workflow state transition
    'milestone',     -- Milestone achieved/missed
    'communication', -- Email sent/received/response
    'blocker',       -- Blocker created/resolved
    'task',          -- Task created/completed
    'financial',     -- Payment/invoice event
    'exception'      -- Exception/alert raised
  )),
  event_type VARCHAR(100) NOT NULL,
  event_description TEXT NOT NULL,

  -- Direction indicator
  direction VARCHAR(20) CHECK (direction IN ('inward', 'outward', 'internal')),

  -- Involved stakeholder
  party_id UUID REFERENCES parties(id),
  party_name VARCHAR(255),
  party_type VARCHAR(50),

  -- Source references
  email_id UUID REFERENCES raw_emails(id),
  document_lifecycle_id UUID REFERENCES document_lifecycle(id),
  task_id UUID REFERENCES action_tasks(id),
  notification_id UUID REFERENCES notifications(id),
  milestone_id UUID REFERENCES shipment_milestones(id),
  blocker_id UUID REFERENCES shipment_blockers(id),

  -- Workflow impact
  workflow_state_before VARCHAR(100),
  workflow_state_after VARCHAR(100),

  -- Metadata
  event_data JSONB,
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journey_events_shipment ON shipment_journey_events(shipment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_events_category ON shipment_journey_events(event_category, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_events_party ON shipment_journey_events(party_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_journey_events_direction ON shipment_journey_events(direction, occurred_at DESC);

-- ============================================================================
-- 7. HELPER FUNCTIONS
-- ============================================================================

-- Function to get full shipment journey timeline
CREATE OR REPLACE FUNCTION get_shipment_journey(p_shipment_id UUID)
RETURNS TABLE (
  event_time TIMESTAMP WITH TIME ZONE,
  category VARCHAR(50),
  event_type VARCHAR(100),
  description TEXT,
  direction VARCHAR(20),
  party_name VARCHAR(255),
  workflow_impact TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sje.occurred_at as event_time,
    sje.event_category as category,
    sje.event_type,
    sje.event_description as description,
    sje.direction,
    sje.party_name,
    CASE
      WHEN sje.workflow_state_after IS NOT NULL
      THEN sje.workflow_state_before || ' -> ' || sje.workflow_state_after
      ELSE NULL
    END as workflow_impact
  FROM shipment_journey_events sje
  WHERE sje.shipment_id = p_shipment_id
  ORDER BY sje.occurred_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- Function to detect and create blockers
CREATE OR REPLACE FUNCTION detect_shipment_blockers(p_shipment_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  v_inserted INTEGER := 0;
  v_shipment RECORD;
BEGIN
  SELECT * INTO v_shipment FROM shipments WHERE id = p_shipment_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Check for cutoff passed without required documents
  IF v_shipment.si_cutoff IS NOT NULL AND v_shipment.si_cutoff::DATE < CURRENT_DATE THEN
    IF NOT EXISTS (
      SELECT 1 FROM document_lifecycle dl
      WHERE dl.shipment_id = p_shipment_id
        AND dl.document_type = 'shipping_instruction'
        AND dl.lifecycle_status IN ('approved', 'sent')
    ) THEN
      INSERT INTO shipment_blockers (
        shipment_id, blocker_type, blocker_description, severity,
        blocks_workflow_state, blocks_document_type
      ) VALUES (
        p_shipment_id, 'cutoff_passed', 'SI cutoff passed without approved SI', 'critical',
        'si_confirmed', 'shipping_instruction'
      ) ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END IF;

  -- Check for documents awaiting acknowledgment past due
  INSERT INTO shipment_blockers (
    shipment_id, blocker_type, blocker_description, severity,
    blocks_document_type, linked_document_lifecycle_id
  )
  SELECT
    p_shipment_id,
    'awaiting_approval',
    'Document awaiting acknowledgment: ' || dl.document_type,
    'high',
    dl.document_type,
    dl.id
  FROM document_lifecycle dl
  WHERE dl.shipment_id = p_shipment_id
    AND dl.acknowledgment_required = true
    AND dl.acknowledged = false
    AND dl.acknowledgment_due_date < NOW()
    AND NOT EXISTS (
      SELECT 1 FROM shipment_blockers sb
      WHERE sb.linked_document_lifecycle_id = dl.id AND sb.is_resolved = false
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  v_count := v_count + v_inserted;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 8. UPDATE TRIGGERS
-- ============================================================================

-- Trigger to log workflow state changes to journey events
CREATE OR REPLACE FUNCTION log_workflow_change_to_journey()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_state IS DISTINCT FROM OLD.workflow_state THEN
    INSERT INTO shipment_journey_events (
      shipment_id, event_category, event_type, event_description,
      direction, workflow_state_before, workflow_state_after, occurred_at
    ) VALUES (
      NEW.id, 'workflow', 'state_transition',
      'Workflow state changed from ' || COALESCE(OLD.workflow_state, 'none') || ' to ' || NEW.workflow_state,
      'internal', OLD.workflow_state, NEW.workflow_state, NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_log_workflow_journey ON shipments;
CREATE TRIGGER trigger_log_workflow_journey
  AFTER UPDATE ON shipments
  FOR EACH ROW
  WHEN (NEW.workflow_state IS DISTINCT FROM OLD.workflow_state)
  EXECUTE FUNCTION log_workflow_change_to_journey();

-- Trigger to auto-resolve blockers when condition is met
CREATE OR REPLACE FUNCTION auto_resolve_blockers()
RETURNS TRIGGER AS $$
BEGIN
  -- Auto-resolve awaiting_approval blockers when document is acknowledged
  IF TG_TABLE_NAME = 'document_lifecycle' AND NEW.acknowledged = true AND OLD.acknowledged = false THEN
    UPDATE shipment_blockers
    SET is_resolved = true, resolved_at = NOW(), auto_resolved = true,
        resolution_notes = 'Auto-resolved: Document acknowledged'
    WHERE linked_document_lifecycle_id = NEW.id AND is_resolved = false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_resolve_doc_blockers ON document_lifecycle;
CREATE TRIGGER trigger_auto_resolve_doc_blockers
  AFTER UPDATE ON document_lifecycle
  FOR EACH ROW
  WHEN (NEW.acknowledged = true AND OLD.acknowledged = false)
  EXECUTE FUNCTION auto_resolve_blockers();

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
