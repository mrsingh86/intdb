-- ============================================================================
-- ACTION RULES V2: Flow-Based 3-Source Action System
-- ============================================================================
-- Philosophy: Actions originate from THREE sources:
--   1. DOCUMENT_RECEIPT - Implied workflow (e.g., draft_entry → share with customer)
--   2. EXPLICIT_REQUEST - External ask from party
--   3. TIME_BASED - Cutoff/ETA triggers
--
-- This extends the existing action_lookup with routing, time triggers, and stage awareness.
-- ============================================================================

-- ============================================================================
-- TABLE 1: document_action_rules (extends action_lookup)
-- ============================================================================
-- When document X is received from party Y, route to party Z with action A
-- This is the PRIMARY action source - most actions are document-triggered

CREATE TABLE IF NOT EXISTS document_action_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Trigger conditions
  document_type TEXT NOT NULL,                    -- e.g., 'draft_bl', 'checklist', 'duty_invoice'
  from_party TEXT NOT NULL,                       -- Who sent it: 'ocean_carrier', 'customs_broker', 'customer'
  is_reply BOOLEAN NOT NULL DEFAULT FALSE,        -- Is this a reply in thread?

  -- Stage awareness (optional - if NULL, applies to all stages)
  applicable_stages TEXT[] DEFAULT NULL,          -- e.g., ['SI_SUBMITTED', 'BL_ISSUED'] or NULL for any

  -- Action details
  has_action BOOLEAN NOT NULL DEFAULT TRUE,       -- Does this trigger an action?
  action_verb TEXT,                               -- 'share', 'review', 'approve', 'submit', 'pay', 'follow_up'
  action_object TEXT,                             -- What: 'document', 'corrections', 'payment', 'approval'

  -- Routing (Intoglo is middle layer)
  to_party TEXT,                                  -- Route to: 'customer', 'carrier', 'customs_broker', 'trucker'
  action_owner TEXT NOT NULL DEFAULT 'operations', -- Who does it: 'operations', 'customer', 'carrier'

  -- Action parameters
  action_description TEXT,                        -- Human-readable: "Share draft BL with customer for approval"
  requires_response BOOLEAN DEFAULT FALSE,        -- Does action require a response back?
  expected_response_type TEXT,                    -- If requires_response: 'approval', 'corrections', 'confirmation'

  -- Deadlines
  default_deadline_hours INTEGER,                 -- Default: complete within N hours
  urgency TEXT DEFAULT 'normal',                  -- 'critical', 'high', 'normal', 'low'

  -- Metadata
  confidence INTEGER DEFAULT 90,                  -- Rule confidence (for AI override)
  sample_size INTEGER DEFAULT 0,                  -- How many examples this rule is based on
  notes TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one rule per (doc_type, from_party, is_reply, stages)
  UNIQUE (document_type, from_party, is_reply)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_document_action_rules_lookup
ON document_action_rules(document_type, from_party, is_reply)
WHERE enabled = TRUE;

COMMENT ON TABLE document_action_rules IS
'Source 1: Document receipt triggers action. Maps (document_type, from_party) to (action, to_party).
Intoglo receives documents and routes them to appropriate parties.';


-- ============================================================================
-- TABLE 2: time_based_action_rules
-- ============================================================================
-- Actions triggered by time relative to cutoffs, ETD/ETA, or absolute dates

CREATE TABLE IF NOT EXISTS time_based_action_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Trigger conditions
  trigger_event TEXT NOT NULL,                    -- 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta'
  trigger_offset_hours INTEGER NOT NULL,          -- -24 = 24 hours BEFORE event, +48 = 48 hours AFTER

  -- Stage awareness
  applicable_stages TEXT[],                       -- Only fire if shipment in these stages

  -- Condition checks (only fire if condition met)
  condition_field TEXT,                           -- Field to check: 'si_submitted', 'vgm_submitted', 'bl_issued'
  condition_operator TEXT,                        -- 'is_null', 'is_false', 'is_true', 'before', 'after'
  condition_value TEXT,                           -- Optional value for comparison

  -- Action details
  action_verb TEXT NOT NULL,                      -- 'remind', 'escalate', 'submit', 'follow_up', 'alert'
  action_object TEXT NOT NULL,                    -- 'si', 'vgm', 'bl_approval', 'payment', 'delivery'
  action_description TEXT NOT NULL,               -- "SI cutoff in 24 hours - remind customer"

  -- Routing
  action_owner TEXT NOT NULL,                     -- 'operations', 'customer', 'carrier'
  notify_parties TEXT[],                          -- Additional parties to notify: ['customer', 'shipper']

  -- Urgency
  urgency TEXT DEFAULT 'high',                    -- Time-based actions are usually urgent

  -- Prevent duplicate triggers
  cooldown_hours INTEGER DEFAULT 24,              -- Don't re-trigger within N hours

  -- Metadata
  enabled BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique: one rule per (trigger_event, offset, condition)
  UNIQUE (trigger_event, trigger_offset_hours, condition_field)
);

COMMENT ON TABLE time_based_action_rules IS
'Source 2: Time-based triggers relative to cutoffs/ETD/ETA.
Example: 24 hours before SI cutoff, if SI not submitted → remind customer.';


-- ============================================================================
-- TABLE 3: document_routing_rules
-- ============================================================================
-- Explicit routing rules for document flow between parties
-- More detailed than document_action_rules - handles multi-step flows

CREATE TABLE IF NOT EXISTS document_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document flow
  document_type TEXT NOT NULL,                    -- e.g., 'checklist', 'draft_entry'
  flow_sequence INTEGER NOT NULL,                 -- 1 = first step, 2 = second step, etc.

  -- Flow step details
  step_from_party TEXT NOT NULL,                  -- Who has the document
  step_to_party TEXT NOT NULL,                    -- Who it goes to next
  step_action TEXT NOT NULL,                      -- 'share', 'review', 'approve', 'correct', 'submit'

  -- Conditions for this step
  requires_previous_step BOOLEAN DEFAULT TRUE,    -- Must previous step be complete?
  trigger_on_response TEXT,                       -- Trigger on: 'approval', 'rejection', 'corrections', NULL (immediate)

  -- Action details
  action_description TEXT,                        -- "Share checklist with customer for approval"
  action_owner TEXT NOT NULL,                     -- Who performs: 'operations', 'customer'

  -- Deadlines
  deadline_hours INTEGER,                         -- Complete within N hours of receiving

  -- Metadata
  enabled BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (document_type, flow_sequence)
);

COMMENT ON TABLE document_routing_rules IS
'Multi-step document flows. Example: checklist flow:
Step 1: CHA → Intoglo (receive)
Step 2: Intoglo → Customer (share for approval)
Step 3: Customer → Intoglo (approve/correct)
Step 4: Intoglo → CHA (submit approved checklist)';


-- ============================================================================
-- TABLE 4: action_trigger_log
-- ============================================================================
-- Audit trail of when rules fired (for learning and debugging)

CREATE TABLE IF NOT EXISTS action_trigger_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What triggered
  trigger_source TEXT NOT NULL,                   -- 'document_receipt', 'time_based', 'explicit_request'
  rule_id UUID,                                   -- Reference to rule that fired
  rule_table TEXT,                                -- 'document_action_rules', 'time_based_action_rules'

  -- Context
  chronicle_id UUID REFERENCES chronicle(id),     -- Source email if document-triggered
  shipment_id UUID,                               -- Shipment context

  -- What was triggered
  action_description TEXT,
  action_owner TEXT,
  to_party TEXT,

  -- Outcome
  action_created_at TIMESTAMPTZ DEFAULT NOW(),
  action_completed_at TIMESTAMPTZ,
  was_correct BOOLEAN,                            -- Feedback: was this the right action?
  feedback_notes TEXT,

  -- Prevent duplicates
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_trigger_log_shipment
ON action_trigger_log(shipment_id, created_at DESC);

COMMENT ON TABLE action_trigger_log IS
'Audit trail of all rule triggers. Used for:
1. Debugging: why did action X fire?
2. Learning: was this correct? Feed back to improve rules.
3. Analytics: which rules fire most often?';


-- ============================================================================
-- SEED DATA: Document Action Rules (Source 1)
-- ============================================================================
-- Based on chronicle data analysis and existing action_lookup patterns

INSERT INTO document_action_rules
(document_type, from_party, is_reply, action_verb, action_object, to_party, action_owner, action_description, requires_response, expected_response_type, default_deadline_hours, urgency)
VALUES
-- Customs flow: CHA documents → share with customer
('checklist', 'customs_broker', FALSE, 'share', 'document', 'customer', 'operations', 'Share customs checklist with customer for review and approval', TRUE, 'approval', 24, 'high'),
('draft_entry', 'customs_broker', FALSE, 'share', 'document', 'customer', 'operations', 'Share draft customs entry with customer for approval', TRUE, 'approval', 24, 'high'),
('duty_invoice', 'customs_broker', FALSE, 'share', 'invoice', 'customer', 'operations', 'Share duty invoice with customer for payment', TRUE, 'confirmation', 48, 'normal'),
('entry_summary', 'customs_broker', FALSE, 'share', 'document', 'customer', 'operations', 'Share entry summary (7501) with customer', FALSE, NULL, 24, 'normal'),
('leo_copy', 'customs_broker', FALSE, 'share', 'document', 'customer', 'operations', 'Share LEO copy with customer', FALSE, NULL, 24, 'low'),

-- Carrier documents → share/review
('draft_bl', 'ocean_carrier', FALSE, 'share', 'document', 'customer', 'operations', 'Share draft BL with customer for approval', TRUE, 'approval', 24, 'high'),
('draft_bl', 'nvocc', FALSE, 'share', 'document', 'customer', 'operations', 'Share draft BL with customer for approval', TRUE, 'approval', 24, 'high'),
('arrival_notice', 'ocean_carrier', FALSE, 'share', 'document', 'customer', 'operations', 'Forward arrival notice to customer', FALSE, NULL, 12, 'high'),
('arrival_notice', 'nvocc', FALSE, 'share', 'document', 'customer', 'operations', 'Forward arrival notice to customer', FALSE, NULL, 12, 'high'),
('delivery_order', 'ocean_carrier', FALSE, 'share', 'document', 'customer', 'operations', 'Forward delivery order to customer/trucker', FALSE, NULL, 4, 'critical'),
('delivery_order', 'nvocc', FALSE, 'share', 'document', 'customer', 'operations', 'Forward delivery order to customer/trucker', FALSE, NULL, 4, 'critical'),
('container_release', 'ocean_carrier', FALSE, 'share', 'document', 'customer', 'operations', 'Forward container release to customer/trucker', FALSE, NULL, 4, 'critical'),

-- Customer documents → process/submit
('booking_request', 'customer', FALSE, 'process', 'booking', NULL, 'operations', 'Process booking request with carrier', FALSE, NULL, 24, 'normal'),
('shipping_instructions', 'customer', FALSE, 'submit', 'si', 'ocean_carrier', 'operations', 'Submit SI to carrier', FALSE, NULL, 12, 'high'),
('booking_amendment', 'customer', FALSE, 'process', 'amendment', 'ocean_carrier', 'operations', 'Process amendment with carrier', FALSE, NULL, 12, 'high'),
('checklist', 'customer', FALSE, 'submit', 'document', 'customs_broker', 'operations', 'Submit approved checklist to CHA', FALSE, NULL, 24, 'normal'),

-- Invoices → process payment or share
('invoice', 'ocean_carrier', FALSE, 'share', 'invoice', 'customer', 'operations', 'Share carrier invoice with customer or process payment', FALSE, NULL, 48, 'normal'),
('invoice', 'nvocc', FALSE, 'share', 'invoice', 'customer', 'operations', 'Share invoice with customer or process payment', FALSE, NULL, 48, 'normal'),
('invoice', 'customs_broker', FALSE, 'share', 'invoice', 'customer', 'operations', 'Share customs broker invoice with customer', FALSE, NULL, 48, 'normal'),

-- Exceptions → investigate
('exception_notice', 'ocean_carrier', FALSE, 'investigate', 'issue', 'customer', 'operations', 'Investigate exception and inform customer', FALSE, NULL, 4, 'critical'),
('exception_notice', 'trucker', FALSE, 'investigate', 'issue', NULL, 'operations', 'Investigate trucking exception', FALSE, NULL, 4, 'critical'),

-- Confirmations → usually no action (mark task complete)
('booking_confirmation', 'ocean_carrier', FALSE, 'complete', 'task', NULL, 'operations', 'Booking confirmed - update records', FALSE, NULL, NULL, 'low'),
('booking_confirmation', 'nvocc', FALSE, 'complete', 'task', NULL, 'operations', 'Booking confirmed - update records', FALSE, NULL, NULL, 'low'),
('vgm_confirmation', 'ocean_carrier', FALSE, 'complete', 'task', NULL, 'operations', 'VGM confirmed - update records', FALSE, NULL, NULL, 'low'),
('si_confirmation', 'ocean_carrier', FALSE, 'complete', 'task', NULL, 'operations', 'SI confirmed - update records', FALSE, NULL, NULL, 'low'),
('telex_release', 'ocean_carrier', FALSE, 'share', 'document', 'customer', 'operations', 'Share telex release with customer', FALSE, NULL, 4, 'high'),
('telex_release', 'nvocc', FALSE, 'share', 'document', 'customer', 'operations', 'Share telex release with customer', FALSE, NULL, 4, 'high'),

-- Final BL → share
('final_bl', 'ocean_carrier', FALSE, 'share', 'document', 'customer', 'operations', 'Share final BL with customer', FALSE, NULL, 12, 'normal'),
('house_bl', 'nvocc', FALSE, 'share', 'document', 'customer', 'operations', 'Share house BL with customer', FALSE, NULL, 12, 'normal'),
('sea_waybill', 'ocean_carrier', FALSE, 'share', 'document', 'customer', 'operations', 'Share sea waybill with customer', FALSE, NULL, 12, 'normal'),

-- ISF filing
('isf_filing', 'customs_broker', FALSE, 'complete', 'task', NULL, 'operations', 'ISF filed - update records', FALSE, NULL, NULL, 'normal')

ON CONFLICT (document_type, from_party, is_reply)
DO UPDATE SET
  action_verb = EXCLUDED.action_verb,
  action_description = EXCLUDED.action_description,
  updated_at = NOW();


-- ============================================================================
-- SEED DATA: Time-Based Action Rules (Source 2)
-- ============================================================================

INSERT INTO time_based_action_rules
(trigger_event, trigger_offset_hours, applicable_stages, condition_field, condition_operator, action_verb, action_object, action_description, action_owner, notify_parties, urgency, cooldown_hours)
VALUES
-- SI cutoff reminders
('si_cutoff', -48, ARRAY['BOOKED', 'SI_PENDING'], 'si_submitted', 'is_false', 'remind', 'si', 'SI cutoff in 48 hours - remind customer to submit SI', 'operations', ARRAY['customer'], 'high', 24),
('si_cutoff', -24, ARRAY['BOOKED', 'SI_PENDING'], 'si_submitted', 'is_false', 'escalate', 'si', 'SI cutoff in 24 hours - URGENT: SI still not submitted', 'operations', ARRAY['customer', 'shipper'], 'critical', 12),
('si_cutoff', -4, ARRAY['BOOKED', 'SI_PENDING'], 'si_submitted', 'is_false', 'alert', 'si', 'SI cutoff in 4 hours - CRITICAL: Risk of rollover', 'operations', ARRAY['customer', 'shipper', 'manager'], 'critical', 4),

-- VGM cutoff reminders
('vgm_cutoff', -48, ARRAY['BOOKED', 'SI_SUBMITTED', 'SI_PENDING'], 'vgm_submitted', 'is_false', 'remind', 'vgm', 'VGM cutoff in 48 hours - remind customer', 'operations', ARRAY['customer'], 'high', 24),
('vgm_cutoff', -24, ARRAY['BOOKED', 'SI_SUBMITTED', 'SI_PENDING'], 'vgm_submitted', 'is_false', 'escalate', 'vgm', 'VGM cutoff in 24 hours - URGENT', 'operations', ARRAY['customer', 'shipper'], 'critical', 12),

-- Cargo cutoff reminders
('cargo_cutoff', -48, ARRAY['BOOKED', 'SI_SUBMITTED', 'SI_PENDING'], 'cargo_gated_in', 'is_false', 'remind', 'cargo', 'Cargo cutoff in 48 hours - confirm cargo delivery to terminal', 'operations', ARRAY['customer', 'trucker'], 'high', 24),
('cargo_cutoff', -24, ARRAY['BOOKED', 'SI_SUBMITTED', 'SI_PENDING'], 'cargo_gated_in', 'is_false', 'escalate', 'cargo', 'Cargo cutoff in 24 hours - URGENT: Cargo not at terminal', 'operations', ARRAY['customer', 'trucker', 'shipper'], 'critical', 12),

-- ETD-based (departure)
('etd', -72, ARRAY['SI_SUBMITTED', 'VGM_SUBMITTED'], 'bl_issued', 'is_false', 'remind', 'bl_approval', 'Vessel departs in 72 hours - confirm BL approval pending', 'operations', ARRAY['customer'], 'normal', 24),
('etd', -24, ARRAY['SI_SUBMITTED', 'VGM_SUBMITTED'], 'bl_issued', 'is_false', 'escalate', 'bl_approval', 'Vessel departs in 24 hours - BL still not finalized', 'operations', ARRAY['customer', 'carrier'], 'high', 12),

-- ETA-based (arrival)
('eta', -72, ARRAY['DEPARTED', 'IN_TRANSIT', 'BL_ISSUED'], NULL, NULL, 'remind', 'arrival_prep', 'Vessel arrives in 72 hours - prepare arrival documents', 'operations', ARRAY['customer', 'customs_broker'], 'normal', 24),
('eta', -48, ARRAY['DEPARTED', 'IN_TRANSIT', 'BL_ISSUED'], 'isf_filed', 'is_false', 'escalate', 'isf', 'Vessel arrives in 48 hours - ISF not filed', 'operations', ARRAY['customs_broker'], 'critical', 24),
('eta', 24, ARRAY['ARRIVED'], 'container_picked_up', 'is_false', 'remind', 'pickup', 'Container available for 24 hours - arrange pickup to avoid demurrage', 'operations', ARRAY['customer', 'trucker'], 'high', 24),
('eta', 48, ARRAY['ARRIVED'], 'container_picked_up', 'is_false', 'escalate', 'pickup', 'Container at terminal 48+ hours - demurrage accruing', 'operations', ARRAY['customer', 'trucker', 'manager'], 'critical', 24)

ON CONFLICT (trigger_event, trigger_offset_hours, condition_field) DO NOTHING;


-- ============================================================================
-- SEED DATA: Document Routing Rules (Multi-step flows)
-- ============================================================================

INSERT INTO document_routing_rules
(document_type, flow_sequence, step_from_party, step_to_party, step_action, requires_previous_step, trigger_on_response, action_description, action_owner, deadline_hours)
VALUES
-- Checklist flow (India customs)
('checklist', 1, 'customs_broker', 'operations', 'receive', FALSE, NULL, 'Receive checklist from CHA', 'operations', NULL),
('checklist', 2, 'operations', 'customer', 'share', TRUE, NULL, 'Share checklist with customer for approval', 'operations', 24),
('checklist', 3, 'customer', 'operations', 'approve', TRUE, 'approval', 'Customer approves or sends corrections', 'customer', 48),
('checklist', 4, 'operations', 'customs_broker', 'submit', TRUE, 'approval', 'Submit approved checklist to CHA', 'operations', 12),

-- Draft entry flow (US customs)
('draft_entry', 1, 'customs_broker', 'operations', 'receive', FALSE, NULL, 'Receive draft entry from customs broker', 'operations', NULL),
('draft_entry', 2, 'operations', 'customer', 'share', TRUE, NULL, 'Share draft entry with customer for approval', 'operations', 24),
('draft_entry', 3, 'customer', 'operations', 'approve', TRUE, 'approval', 'Customer approves draft entry', 'customer', 48),
('draft_entry', 4, 'operations', 'customs_broker', 'confirm', TRUE, 'approval', 'Confirm customer approval to customs broker', 'operations', 12),

-- Draft BL flow
('draft_bl', 1, 'ocean_carrier', 'operations', 'receive', FALSE, NULL, 'Receive draft BL from carrier', 'operations', NULL),
('draft_bl', 2, 'operations', 'customer', 'share', TRUE, NULL, 'Share draft BL with customer for approval', 'operations', 12),
('draft_bl', 3, 'customer', 'operations', 'review', TRUE, NULL, 'Customer reviews - approves or sends corrections', 'customer', 24),
('draft_bl', 4, 'operations', 'ocean_carrier', 'submit', TRUE, 'corrections', 'Submit corrections to carrier', 'operations', 12),

-- Duty invoice flow
('duty_invoice', 1, 'customs_broker', 'operations', 'receive', FALSE, NULL, 'Receive duty invoice from customs broker', 'operations', NULL),
('duty_invoice', 2, 'operations', 'customer', 'share', TRUE, NULL, 'Share duty invoice with customer for payment', 'operations', 24),
('duty_invoice', 3, 'customer', 'operations', 'pay', TRUE, NULL, 'Customer arranges payment', 'customer', 72),
('duty_invoice', 4, 'operations', 'customs_broker', 'confirm', TRUE, 'confirmation', 'Confirm payment to customs broker', 'operations', 12)

ON CONFLICT (document_type, flow_sequence) DO NOTHING;


-- ============================================================================
-- HELPER FUNCTION: Get action for document receipt
-- ============================================================================

CREATE OR REPLACE FUNCTION get_document_action(
  p_document_type TEXT,
  p_from_party TEXT,
  p_is_reply BOOLEAN DEFAULT FALSE,
  p_shipment_stage TEXT DEFAULT NULL
)
RETURNS TABLE (
  has_action BOOLEAN,
  action_verb TEXT,
  action_object TEXT,
  to_party TEXT,
  action_owner TEXT,
  action_description TEXT,
  requires_response BOOLEAN,
  urgency TEXT,
  deadline_hours INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dar.has_action,
    dar.action_verb,
    dar.action_object,
    dar.to_party,
    dar.action_owner,
    dar.action_description,
    dar.requires_response,
    dar.urgency,
    dar.default_deadline_hours
  FROM document_action_rules dar
  WHERE dar.document_type = p_document_type
    AND dar.from_party = p_from_party
    AND dar.is_reply = p_is_reply
    AND dar.enabled = TRUE
    AND (
      dar.applicable_stages IS NULL
      OR p_shipment_stage = ANY(dar.applicable_stages)
    )
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_document_action IS
'Look up what action to take when receiving a document.
Usage: SELECT * FROM get_document_action(''draft_bl'', ''ocean_carrier'', FALSE, ''SI_SUBMITTED'')';


-- ============================================================================
-- HELPER FUNCTION: Get time-based actions due
-- ============================================================================

CREATE OR REPLACE FUNCTION get_pending_time_actions(
  p_shipment_id UUID
)
RETURNS TABLE (
  rule_id UUID,
  trigger_event TEXT,
  action_verb TEXT,
  action_object TEXT,
  action_description TEXT,
  action_owner TEXT,
  urgency TEXT,
  hours_until_trigger NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH shipment_dates AS (
    SELECT
      s.id,
      s.stage,
      s.si_cutoff,
      s.vgm_cutoff,
      s.cargo_cutoff,
      s.etd,
      s.eta,
      -- Condition fields (would need actual column names from your schema)
      COALESCE(s.si_submitted_at IS NOT NULL, FALSE) as si_submitted,
      COALESCE(s.vgm_submitted_at IS NOT NULL, FALSE) as vgm_submitted,
      COALESCE(s.bl_issued_at IS NOT NULL, FALSE) as bl_issued
    FROM shipments s
    WHERE s.id = p_shipment_id
  )
  SELECT
    tar.id as rule_id,
    tar.trigger_event,
    tar.action_verb,
    tar.action_object,
    tar.action_description,
    tar.action_owner,
    tar.urgency,
    EXTRACT(EPOCH FROM (
      CASE tar.trigger_event
        WHEN 'si_cutoff' THEN sd.si_cutoff
        WHEN 'vgm_cutoff' THEN sd.vgm_cutoff
        WHEN 'cargo_cutoff' THEN sd.cargo_cutoff
        WHEN 'etd' THEN sd.etd
        WHEN 'eta' THEN sd.eta
      END
      + (tar.trigger_offset_hours || ' hours')::interval
      - NOW()
    )) / 3600 as hours_until_trigger
  FROM time_based_action_rules tar
  CROSS JOIN shipment_dates sd
  WHERE tar.enabled = TRUE
    AND (tar.applicable_stages IS NULL OR sd.stage = ANY(tar.applicable_stages))
    -- Check conditions
    AND (
      tar.condition_field IS NULL
      OR (tar.condition_field = 'si_submitted' AND tar.condition_operator = 'is_false' AND sd.si_submitted = FALSE)
      OR (tar.condition_field = 'vgm_submitted' AND tar.condition_operator = 'is_false' AND sd.vgm_submitted = FALSE)
      OR (tar.condition_field = 'bl_issued' AND tar.condition_operator = 'is_false' AND sd.bl_issued = FALSE)
    )
    -- Within trigger window (past trigger time but not too old)
    AND EXTRACT(EPOCH FROM (
      CASE tar.trigger_event
        WHEN 'si_cutoff' THEN sd.si_cutoff
        WHEN 'vgm_cutoff' THEN sd.vgm_cutoff
        WHEN 'cargo_cutoff' THEN sd.cargo_cutoff
        WHEN 'etd' THEN sd.etd
        WHEN 'eta' THEN sd.eta
      END
      + (tar.trigger_offset_hours || ' hours')::interval
      - NOW()
    )) / 3600 BETWEEN -24 AND tar.trigger_offset_hours
  ORDER BY hours_until_trigger;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- VIEW: Action rules summary (for dashboard)
-- ============================================================================

CREATE OR REPLACE VIEW action_rules_summary AS
SELECT
  'document_action_rules' as rule_type,
  COUNT(*) as total_rules,
  COUNT(*) FILTER (WHERE enabled) as enabled_rules,
  COUNT(DISTINCT document_type) as document_types_covered
FROM document_action_rules

UNION ALL

SELECT
  'time_based_action_rules' as rule_type,
  COUNT(*) as total_rules,
  COUNT(*) FILTER (WHERE enabled) as enabled_rules,
  COUNT(DISTINCT trigger_event) as events_covered
FROM time_based_action_rules

UNION ALL

SELECT
  'document_routing_rules' as rule_type,
  COUNT(*) as total_rules,
  COUNT(*) FILTER (WHERE enabled) as enabled_rules,
  COUNT(DISTINCT document_type) as document_types_covered
FROM document_routing_rules;


-- ============================================================================
-- Grant permissions
-- ============================================================================
GRANT SELECT ON document_action_rules TO authenticated;
GRANT SELECT ON time_based_action_rules TO authenticated;
GRANT SELECT ON document_routing_rules TO authenticated;
GRANT SELECT ON action_trigger_log TO authenticated;
GRANT INSERT ON action_trigger_log TO authenticated;
GRANT SELECT ON action_rules_summary TO authenticated;
