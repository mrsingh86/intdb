-- Chronicle Intelligence System
-- Standalone system for shipment email intelligence
-- Run this in Supabase SQL Editor

-- ============================================================================
-- MAIN TABLE: chronicle
-- Immutable append-only log of all email intelligence
-- ============================================================================

CREATE TABLE IF NOT EXISTS chronicle (
  -- Identity
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL,

  -- Shipment Link (populated by linking function)
  shipment_id UUID REFERENCES shipments(id),
  linked_by TEXT, -- 'booking_number', 'mbl_number', 'hbl_number', 'container', 'thread'
  linked_at TIMESTAMPTZ,

  -- Direction & Parties
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_party TEXT NOT NULL CHECK (from_party IN ('carrier', 'customer', 'broker', 'trucker', 'terminal', 'intoglo', 'unknown')),
  from_address TEXT NOT NULL,

  -- Identifiers (extracted from subject primarily)
  booking_number TEXT,
  mbl_number TEXT,
  hbl_number TEXT,
  container_numbers TEXT[] DEFAULT '{}',
  identifier_source TEXT CHECK (identifier_source IN ('subject', 'body', 'attachment')),

  -- Document Classification
  document_type TEXT CHECK (document_type IN (
    'booking_confirmation', 'booking_amendment', 'shipping_instructions',
    'si_confirmation', 'draft_bl', 'final_bl', 'telex_release',
    'arrival_notice', 'delivery_order', 'invoice', 'debit_note',
    'credit_note', 'payment_receipt', 'vgm_confirmation',
    'customs_entry', 'isf_filing', 'pod_proof_of_delivery',
    'gate_pass', 'container_release', 'general_correspondence', 'unknown'
  )),

  -- Logistics Details (from attachment)
  vessel_name TEXT,
  voyage_number TEXT,
  port_of_loading TEXT,
  port_of_discharge TEXT,
  etd DATE,
  eta DATE,

  -- Intelligence (from body)
  message_type TEXT NOT NULL CHECK (message_type IN (
    'confirmation', 'request', 'update', 'action_required',
    'issue_reported', 'acknowledgement', 'query', 'escalation', 'general'
  )),
  sentiment TEXT NOT NULL CHECK (sentiment IN ('positive', 'neutral', 'negative', 'urgent')),
  summary TEXT NOT NULL,

  -- Actions
  has_action BOOLEAN DEFAULT FALSE,
  action_description TEXT,
  action_owner TEXT CHECK (action_owner IN ('operations', 'customer', 'carrier', 'broker')),
  action_deadline DATE,
  action_completed_at TIMESTAMPTZ,

  -- Raw Content (for debugging/reprocessing)
  subject TEXT,
  snippet TEXT,
  body_preview TEXT,
  attachments JSONB DEFAULT '[]',

  -- AI Metadata
  ai_response JSONB,
  ai_model TEXT DEFAULT 'claude-3-5-haiku-latest',
  ai_confidence INT,

  -- Timestamps
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_chronicle_thread_id ON chronicle(thread_id);
CREATE INDEX IF NOT EXISTS idx_chronicle_shipment_id ON chronicle(shipment_id);
CREATE INDEX IF NOT EXISTS idx_chronicle_booking_number ON chronicle(booking_number);
CREATE INDEX IF NOT EXISTS idx_chronicle_mbl_number ON chronicle(mbl_number);
CREATE INDEX IF NOT EXISTS idx_chronicle_hbl_number ON chronicle(hbl_number);
CREATE INDEX IF NOT EXISTS idx_chronicle_container_numbers ON chronicle USING GIN(container_numbers);
CREATE INDEX IF NOT EXISTS idx_chronicle_occurred_at ON chronicle(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_chronicle_has_action ON chronicle(has_action) WHERE has_action = TRUE;
CREATE INDEX IF NOT EXISTS idx_chronicle_action_pending ON chronicle(action_owner, action_deadline)
  WHERE has_action = TRUE AND action_completed_at IS NULL;

-- ============================================================================
-- LINKING FUNCTION
-- Priority: 1=thread, 2=booking, 3=mbl, 4=hbl, 5=container
-- ============================================================================

CREATE OR REPLACE FUNCTION link_chronicle_to_shipment(chronicle_id UUID)
RETURNS TABLE(shipment_id UUID, linked_by TEXT) AS $$
DECLARE
  rec RECORD;
  found_shipment_id UUID;
  link_method TEXT;
BEGIN
  -- Get chronicle record
  SELECT * INTO rec FROM chronicle WHERE id = chronicle_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Priority 1: Thread linking (most reliable for reply chains)
  SELECT c.shipment_id INTO found_shipment_id
  FROM chronicle c
  WHERE c.thread_id = rec.thread_id
    AND c.shipment_id IS NOT NULL
    AND c.id != chronicle_id
  LIMIT 1;

  IF found_shipment_id IS NOT NULL THEN
    link_method := 'thread';
    UPDATE chronicle SET
      shipment_id = found_shipment_id,
      linked_by = link_method,
      linked_at = NOW()
    WHERE id = chronicle_id;
    RETURN QUERY SELECT found_shipment_id, link_method;
    RETURN;
  END IF;

  -- Priority 2: Booking number
  IF rec.booking_number IS NOT NULL THEN
    SELECT s.id INTO found_shipment_id
    FROM shipments s
    WHERE s.booking_number = rec.booking_number
    LIMIT 1;

    IF found_shipment_id IS NOT NULL THEN
      link_method := 'booking_number';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- Priority 3: MBL number
  IF rec.mbl_number IS NOT NULL THEN
    SELECT s.id INTO found_shipment_id
    FROM shipments s
    WHERE s.mbl_number = rec.mbl_number
    LIMIT 1;

    IF found_shipment_id IS NOT NULL THEN
      link_method := 'mbl_number';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- Priority 4: HBL number (for destination team)
  IF rec.hbl_number IS NOT NULL THEN
    SELECT s.id INTO found_shipment_id
    FROM shipments s
    WHERE s.hbl_number = rec.hbl_number
    LIMIT 1;

    IF found_shipment_id IS NOT NULL THEN
      link_method := 'hbl_number';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- Priority 5: Container number
  IF array_length(rec.container_numbers, 1) > 0 THEN
    SELECT s.id INTO found_shipment_id
    FROM shipments s
    JOIN shipment_containers sc ON sc.shipment_id = s.id
    WHERE sc.container_number = ANY(rec.container_numbers)
    LIMIT 1;

    IF found_shipment_id IS NOT NULL THEN
      link_method := 'container';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- No link found
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Timeline view for a shipment
CREATE OR REPLACE VIEW chronicle_timeline AS
SELECT
  c.id,
  c.shipment_id,
  c.occurred_at,
  c.direction,
  c.from_party,
  c.document_type,
  c.message_type,
  c.sentiment,
  c.summary,
  c.has_action,
  c.action_description,
  c.action_owner,
  c.action_deadline,
  c.action_completed_at,
  c.booking_number,
  c.mbl_number,
  c.hbl_number,
  c.vessel_name,
  c.etd,
  c.eta
FROM chronicle c
ORDER BY c.occurred_at DESC;

-- Pending actions view
CREATE OR REPLACE VIEW chronicle_pending_actions AS
SELECT
  c.id,
  c.shipment_id,
  c.occurred_at,
  c.action_description,
  c.action_owner,
  c.action_deadline,
  c.summary,
  c.booking_number,
  c.mbl_number,
  CASE
    WHEN c.action_deadline < CURRENT_DATE THEN 'overdue'
    WHEN c.action_deadline = CURRENT_DATE THEN 'due_today'
    WHEN c.action_deadline <= CURRENT_DATE + INTERVAL '2 days' THEN 'due_soon'
    ELSE 'upcoming'
  END as urgency
FROM chronicle c
WHERE c.has_action = TRUE
  AND c.action_completed_at IS NULL
ORDER BY c.action_deadline ASC NULLS LAST;

-- Shipment health summary
CREATE OR REPLACE VIEW chronicle_shipment_health AS
SELECT
  c.shipment_id,
  COUNT(*) as total_communications,
  COUNT(*) FILTER (WHERE c.direction = 'inbound') as inbound_count,
  COUNT(*) FILTER (WHERE c.direction = 'outbound') as outbound_count,
  COUNT(*) FILTER (WHERE c.sentiment = 'negative') as negative_count,
  COUNT(*) FILTER (WHERE c.sentiment = 'urgent') as urgent_count,
  COUNT(*) FILTER (WHERE c.has_action AND c.action_completed_at IS NULL) as pending_actions,
  MAX(c.occurred_at) as last_communication,
  MAX(c.etd) as latest_etd,
  MAX(c.eta) as latest_eta
FROM chronicle c
WHERE c.shipment_id IS NOT NULL
GROUP BY c.shipment_id;

-- ============================================================================
-- RLS POLICIES (if needed)
-- ============================================================================

ALTER TABLE chronicle ENABLE ROW LEVEL SECURITY;

CREATE POLICY chronicle_read_all ON chronicle FOR SELECT USING (true);
CREATE POLICY chronicle_insert_all ON chronicle FOR INSERT WITH CHECK (true);
CREATE POLICY chronicle_update_all ON chronicle FOR UPDATE USING (true);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE chronicle IS 'Immutable append-only log of all shipment email intelligence';
COMMENT ON COLUMN chronicle.identifier_source IS 'Where primary identifier was extracted: subject (most reliable), body, or attachment';
COMMENT ON COLUMN chronicle.linked_by IS 'Method used to link to shipment: thread, booking_number, mbl_number, hbl_number, container';
COMMENT ON COLUMN chronicle.hbl_number IS 'House BL number - used by destination team for linking';
