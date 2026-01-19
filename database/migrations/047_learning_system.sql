-- ============================================================================
-- MIGRATION 047: LEARNING SYSTEM
-- ============================================================================
-- Purpose: Enable classification learning from corrections and pattern memory
-- Based on: LEARNING-AGENT-DESIGN.md
-- Author: Chronicle Enhancement
-- Date: 2026-01-16
-- ============================================================================

-- ============================================================================
-- TABLE 1: LEARNING EPISODES (Individual predictions + outcomes)
-- ============================================================================
-- Every classification is recorded here. When team corrects, we update.
-- This enables pattern memory to learn from corrections.

CREATE TABLE IF NOT EXISTS learning_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was classified
  chronicle_id UUID REFERENCES chronicle(id) ON DELETE SET NULL,

  -- Prediction
  predicted_document_type TEXT NOT NULL,
  predicted_has_action BOOLEAN,
  prediction_confidence INTEGER CHECK (prediction_confidence >= 0 AND prediction_confidence <= 100),
  prediction_method TEXT, -- 'pattern', 'ai', 'hybrid'

  -- Correction (if any)
  corrected_document_type TEXT,
  corrected_has_action BOOLEAN,
  corrected_by UUID, -- references auth.users if you have it
  corrected_at TIMESTAMPTZ,
  correction_reason TEXT,

  -- Context for learning
  sender_domain TEXT,
  sender_party TEXT,
  subject_keywords TEXT[],
  has_attachment BOOLEAN DEFAULT false,
  attachment_types TEXT[],
  thread_position INTEGER,

  -- Outcome tracking
  was_correct BOOLEAN DEFAULT true,

  -- Classification context
  classification_strategy TEXT, -- 'subject_first', 'content_only', 'hybrid'
  pattern_id UUID, -- if pattern was used
  flow_validation_passed BOOLEAN DEFAULT true,
  flow_validation_warnings TEXT[],

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_learning_episodes_chronicle ON learning_episodes(chronicle_id);
CREATE INDEX IF NOT EXISTS idx_learning_episodes_sender ON learning_episodes(sender_domain);
CREATE INDEX IF NOT EXISTS idx_learning_episodes_corrected ON learning_episodes(corrected_at)
  WHERE corrected_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learning_episodes_was_correct ON learning_episodes(was_correct);
CREATE INDEX IF NOT EXISTS idx_learning_episodes_predicted_type ON learning_episodes(predicted_document_type);
CREATE INDEX IF NOT EXISTS idx_learning_episodes_created ON learning_episodes(created_at DESC);

-- ============================================================================
-- TABLE 2: PATTERN MEMORY (Aggregated learnings from sender/keyword patterns)
-- ============================================================================
-- Stores learned associations: sender_domain → document_type probabilities
-- Used to provide hints to classification before AI runs

CREATE TABLE IF NOT EXISTS pattern_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pattern signature
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('sender_domain', 'subject_keyword', 'party_doctype', 'sender_action')),
  pattern_key TEXT NOT NULL,

  -- Learned associations (probabilities)
  document_type_stats JSONB NOT NULL DEFAULT '{}',
  -- e.g., {"booking_confirmation": 0.57, "invoice": 0.12, "arrival_notice": 0.08}

  -- Action statistics
  action_required_rate NUMERIC(5,4), -- 0.0000 to 1.0000

  -- Observation counts
  total_observations INTEGER DEFAULT 0,
  correct_observations INTEGER DEFAULT 0,

  -- Computed accuracy
  accuracy_rate NUMERIC(5,4) GENERATED ALWAYS AS (
    CASE WHEN total_observations > 0
    THEN correct_observations::numeric / total_observations
    ELSE 0 END
  ) STORED,

  -- Timestamps
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint
  CONSTRAINT unique_pattern UNIQUE(pattern_type, pattern_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pattern_memory_lookup ON pattern_memory(pattern_type, pattern_key);
CREATE INDEX IF NOT EXISTS idx_pattern_memory_accuracy ON pattern_memory(accuracy_rate DESC);

-- ============================================================================
-- TABLE 3: ENUM MAPPINGS (Fix common AI mistakes)
-- ============================================================================
-- Maps invalid AI outputs to valid schema values
-- Fixes ~46% of errors from AI returning wrong enum values

CREATE TABLE IF NOT EXISTS enum_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  mapping_type TEXT NOT NULL CHECK (mapping_type IN ('document_type', 'party_type', 'action_owner')),
  ai_value TEXT NOT NULL, -- What AI returns (e.g., "amendment")
  correct_value TEXT NOT NULL, -- What it should be (e.g., "booking_amendment")

  -- Tracking
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,

  CONSTRAINT unique_mapping UNIQUE(mapping_type, ai_value)
);

-- Populate initial enum mappings based on LEARNING-AGENT-DESIGN.md
INSERT INTO enum_mappings (mapping_type, ai_value, correct_value, notes) VALUES
  -- Document type mappings (common AI mistakes)
  ('document_type', 'amendment', 'booking_amendment', 'AI shortens to amendment'),
  ('document_type', 'booking_change', 'booking_amendment', 'Alternative AI phrasing'),
  ('document_type', 'hbl_draft', 'house_bl', 'Wrong type name'),
  ('document_type', 'hbl', 'house_bl', 'Abbreviation'),
  ('document_type', 'mbl', 'final_bl', 'Abbreviation'),
  ('document_type', 'seaway_bill', 'sea_waybill', 'Spelling variation'),
  ('document_type', 'seawaybill', 'sea_waybill', 'No space variation'),
  ('document_type', 'broker', 'general_correspondence', 'Wrong type'),
  ('document_type', 'carrier', 'general_correspondence', 'Wrong type'),
  ('document_type', 'insurance', 'general_correspondence', 'Wrong type'),
  ('document_type', 'pre-alert', 'arrival_notice', 'Synonym'),
  ('document_type', 'pre_arrival_notice', 'arrival_notice', 'Synonym'),
  ('document_type', 'tracking', 'tracking_update', 'Shortened'),
  ('document_type', 'terminal', 'general_correspondence', 'Wrong type'),
  ('document_type', 'trucking', 'work_order', 'Wrong type'),
  ('document_type', 'customs', 'customs_clearance', 'Shortened'),
  ('document_type', 'inquiry', 'general_correspondence', 'Wrong type'),
  ('document_type', 'quotation', 'rate_request', 'Synonym'),
  ('document_type', 'packing_list', 'checklist', 'Sometimes confused'),
  ('document_type', 'update', 'tracking_update', 'Too generic'),
  ('document_type', 'confirmation', 'booking_confirmation', 'Too generic'),
  ('document_type', 'release', 'container_release', 'Too generic'),
  ('document_type', 'notice', 'arrival_notice', 'Too generic'),
  ('document_type', 'bl', 'draft_bl', 'Too generic - default to draft'),
  ('document_type', 'bill_of_lading', 'final_bl', 'Generic BL'),
  ('document_type', 'booking', 'booking_confirmation', 'Shortened'),
  ('document_type', 'si', 'shipping_instructions', 'Abbreviation'),
  ('document_type', 'vgm', 'vgm_request', 'Abbreviated - default to request'),
  ('document_type', 'arrival', 'arrival_notice', 'Shortened'),

  -- Party type mappings
  ('party_type', 'carrier', 'ocean_carrier', 'Generic carrier'),
  ('party_type', 'customs', 'customs_broker', 'Shortened'),
  ('party_type', 'broker', 'customs_broker', 'Ambiguous'),
  ('party_type', 'truckers', 'trucker', 'Plural'),
  ('party_type', 'terminal', 'warehouse', 'Related type'),
  ('party_type', 'factory', 'shipper', 'Origin party'),
  ('party_type', 'shipcube', 'ocean_carrier', 'Platform name'),
  ('party_type', 'finance', 'intoglo', 'Internal'),
  ('party_type', 'operations', 'intoglo', 'Internal'),
  ('party_type', 'system', 'unknown', 'Automated')
ON CONFLICT (mapping_type, ai_value) DO NOTHING;

-- ============================================================================
-- TABLE 4: FLOW VALIDATION RULES (Stage × Document matrix)
-- ============================================================================
-- Defines what document types are expected/allowed at each shipment stage
-- Used to flag impossible combinations

CREATE TABLE IF NOT EXISTS flow_validation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  shipment_stage TEXT NOT NULL,
  document_type TEXT NOT NULL,

  -- Rule type
  rule_type TEXT NOT NULL CHECK (rule_type IN ('expected', 'allowed', 'unexpected', 'impossible')),
  -- expected: normal for this stage
  -- allowed: acceptable but not typical
  -- unexpected: unusual, flag for review
  -- impossible: should not happen, likely misclassification

  -- Context
  notes TEXT,

  CONSTRAINT unique_flow_rule UNIQUE(shipment_stage, document_type)
);

-- Populate flow validation rules based on FLOW-BASED-CLASSIFICATION.md
-- Including ALL document types: shipping line, customs broker, and Intoglo
INSERT INTO flow_validation_rules (shipment_stage, document_type, rule_type, notes) VALUES

  -- ============================================================================
  -- REQUESTED STAGE (Pre-booking)
  -- ============================================================================
  ('REQUESTED', 'rate_request', 'expected', 'Initial inquiry'),
  ('REQUESTED', 'quotation', 'expected', 'Rate response'),
  ('REQUESTED', 'booking_request', 'expected', 'Booking initiation'),
  ('REQUESTED', 'booking_confirmation', 'allowed', 'Fast confirmation'),
  ('REQUESTED', 'general_correspondence', 'allowed', 'Any stage'),
  ('REQUESTED', 'arrival_notice', 'impossible', 'Way too early'),
  ('REQUESTED', 'container_release', 'impossible', 'Way too early'),
  ('REQUESTED', 'pod_proof_of_delivery', 'impossible', 'Way too early'),
  ('REQUESTED', 'entry_summary', 'impossible', 'Way too early'),
  ('REQUESTED', 'customs_entry', 'impossible', 'Way too early'),

  -- ============================================================================
  -- BOOKED STAGE (Booking confirmed, pre-SI)
  -- ============================================================================
  ('BOOKED', 'booking_confirmation', 'expected', 'Confirmation received'),
  ('BOOKED', 'booking_amendment', 'expected', 'Changes to booking'),
  ('BOOKED', 'booking_request', 'allowed', 'Additional booking on thread'),
  ('BOOKED', 'shipping_instructions', 'expected', 'SI submitted'),
  ('BOOKED', 'checklist', 'expected', 'CHA checklist - India'),
  ('BOOKED', 'form_13', 'allowed', 'India CHA - Form 13 prep early'),
  ('BOOKED', 'forwarding_note', 'allowed', 'India CHA - Forwarding instructions early'),
  ('BOOKED', 'invoice', 'allowed', 'Preliminary invoice from Intoglo'),
  ('BOOKED', 'general_correspondence', 'allowed', 'Any stage'),
  ('BOOKED', 'arrival_notice', 'impossible', 'Too early'),
  ('BOOKED', 'container_release', 'impossible', 'Too early'),
  ('BOOKED', 'entry_summary', 'impossible', 'Too early'),

  -- ============================================================================
  -- SI_STAGE (SI submitted, pre-BL)
  -- ============================================================================
  ('SI_STAGE', 'shipping_instructions', 'expected', 'SI confirmation'),
  ('SI_STAGE', 'vgm_request', 'expected', 'VGM submission required'),
  ('SI_STAGE', 'vgm_confirmation', 'expected', 'VGM submitted'),
  ('SI_STAGE', 'checklist', 'expected', 'Documents checklist'),
  ('SI_STAGE', 'form_13', 'expected', 'India CHA - Form 13 for customs'),
  ('SI_STAGE', 'forwarding_note', 'expected', 'India CHA - Forwarding instructions'),
  ('SI_STAGE', 'tr_submission', 'expected', 'India CHA - Transport Release submission'),
  ('SI_STAGE', 'shipping_bill', 'expected', 'India export - SB filed'),
  ('SI_STAGE', 'leo_copy', 'expected', 'India export - LEO received'),
  ('SI_STAGE', 'booking_amendment', 'allowed', 'Late amendment'),
  ('SI_STAGE', 'invoice', 'allowed', 'Preliminary invoice from Intoglo'),
  ('SI_STAGE', 'isf_filing', 'allowed', 'US import - ISF can be early'),
  ('SI_STAGE', 'general_correspondence', 'allowed', 'Any stage'),
  ('SI_STAGE', 'arrival_notice', 'impossible', 'Too early'),
  ('SI_STAGE', 'entry_summary', 'impossible', 'Too early'),

  -- ============================================================================
  -- DRAFT_BL STAGE (BL drafting, pre-SOB)
  -- ============================================================================
  ('DRAFT_BL', 'draft_bl', 'expected', 'Draft BL for review'),
  ('DRAFT_BL', 'house_bl', 'expected', 'HBL draft from Intoglo'),
  ('DRAFT_BL', 'isf_filing', 'expected', 'US import prep - ISF must be filed'),
  ('DRAFT_BL', 'shipping_bill', 'expected', 'India - may still be processing'),
  ('DRAFT_BL', 'leo_copy', 'expected', 'India - LEO confirmation'),
  ('DRAFT_BL', 'form_13', 'allowed', 'India CHA - may still be processing'),
  ('DRAFT_BL', 'forwarding_note', 'allowed', 'India CHA - late submission'),
  ('DRAFT_BL', 'tr_submission', 'allowed', 'India CHA - TR for export'),
  ('DRAFT_BL', 'invoice', 'expected', 'Intoglo preliminary invoice after BL approval'),
  ('DRAFT_BL', 'checklist', 'allowed', 'Final checklist'),
  ('DRAFT_BL', 'vgm_confirmation', 'allowed', 'Late VGM confirmation'),
  ('DRAFT_BL', 'general_correspondence', 'allowed', 'Any stage'),
  ('DRAFT_BL', 'arrival_notice', 'unexpected', 'Unusual timing'),
  ('DRAFT_BL', 'entry_summary', 'impossible', 'Too early'),

  -- ============================================================================
  -- BL_ISSUED STAGE (BL released, cargo loaded)
  -- ============================================================================
  ('BL_ISSUED', 'sea_waybill', 'expected', 'Sea waybill issued'),
  ('BL_ISSUED', 'final_bl', 'expected', 'Final BL'),
  ('BL_ISSUED', 'telex_release', 'expected', 'BL released'),
  ('BL_ISSUED', 'sob_confirmation', 'expected', 'Shipped on board'),
  ('BL_ISSUED', 'house_bl', 'expected', 'Final HBL from Intoglo'),
  ('BL_ISSUED', 'invoice', 'expected', 'Intoglo invoice - post BL'),
  ('BL_ISSUED', 'isf_filing', 'allowed', 'Late ISF update'),
  ('BL_ISSUED', 'general_correspondence', 'allowed', 'Any stage'),
  ('BL_ISSUED', 'booking_request', 'unexpected', 'Late booking on thread'),
  ('BL_ISSUED', 'entry_summary', 'unexpected', 'Too early usually'),

  -- ============================================================================
  -- DEPARTED STAGE (Vessel sailed, in transit)
  -- ============================================================================
  ('DEPARTED', 'tracking_update', 'expected', 'Vessel tracking'),
  ('DEPARTED', 'schedule_update', 'expected', 'Schedule changes'),
  ('DEPARTED', 'exception_notice', 'expected', 'Delays/issues'),
  ('DEPARTED', 'arrival_notice', 'allowed', 'Pre-arrival notice'),
  ('DEPARTED', 'isf_filing', 'allowed', 'ISF amendment'),
  ('DEPARTED', 'draft_entry', 'allowed', 'US Customs - Early entry prep'),
  ('DEPARTED', 'invoice', 'allowed', 'Intoglo invoice'),
  ('DEPARTED', 'general_correspondence', 'allowed', 'Any stage'),
  ('DEPARTED', 'entry_summary', 'allowed', 'Customs broker prep'),

  -- ============================================================================
  -- ARRIVED STAGE (Vessel arrived, customs processing)
  -- ============================================================================
  ('ARRIVED', 'arrival_notice', 'expected', 'Arrival notification'),
  ('ARRIVED', 'draft_entry', 'expected', 'US Customs - Draft entry for review'),
  ('ARRIVED', 'customs_entry', 'expected', 'Customs entry filed'),
  ('ARRIVED', 'entry_summary', 'expected', 'US Customs - 7501 filed'),
  ('ARRIVED', 'duty_invoice', 'expected', 'Customs broker duty invoice'),
  ('ARRIVED', 'container_release', 'expected', 'Cargo released'),
  ('ARRIVED', 'delivery_order', 'expected', 'D/O issued'),
  ('ARRIVED', 'invoice', 'expected', 'Intoglo final invoice'),
  ('ARRIVED', 'isf_filing', 'allowed', 'Late ISF amendment'),
  ('ARRIVED', 'tracking_update', 'allowed', 'Delivery tracking'),
  ('ARRIVED', 'exception_notice', 'allowed', 'Customs issues'),
  ('ARRIVED', 'general_correspondence', 'allowed', 'Any stage'),
  ('ARRIVED', 'booking_confirmation', 'unexpected', 'Old thread reply'),
  ('ARRIVED', 'draft_bl', 'unexpected', 'Old thread reply'),

  -- ============================================================================
  -- DELIVERED STAGE (Cargo delivered, post-delivery)
  -- ============================================================================
  ('DELIVERED', 'pod_proof_of_delivery', 'expected', 'Delivery confirmed'),
  ('DELIVERED', 'empty_return', 'expected', 'Container returned'),
  ('DELIVERED', 'invoice', 'expected', 'Final billing - Intoglo tax invoice'),
  ('DELIVERED', 'duty_invoice', 'expected', 'Final duty invoice'),
  ('DELIVERED', 'debit_note', 'expected', 'Additional charges'),
  ('DELIVERED', 'credit_note', 'expected', 'Adjustments'),
  ('DELIVERED', 'statement', 'expected', 'Account statement'),
  ('DELIVERED', 'payment_receipt', 'expected', 'Payment confirmation'),
  ('DELIVERED', 'delivery_order', 'allowed', 'Late D/O'),
  ('DELIVERED', 'general_correspondence', 'allowed', 'Any stage'),
  ('DELIVERED', 'booking_confirmation', 'unexpected', 'Old thread reply'),
  ('DELIVERED', 'arrival_notice', 'unexpected', 'Old thread reply'),

  -- ============================================================================
  -- PENDING STAGE (Unknown/unlinked shipment)
  -- ============================================================================
  -- No restrictions - anything is allowed for unlinked documents
  ('PENDING', 'general_correspondence', 'allowed', 'Default')

ON CONFLICT (shipment_stage, document_type) DO NOTHING;

-- ============================================================================
-- TABLE 5: ACTION COMPLETION KEYWORDS
-- ============================================================================
-- Keywords in subject that indicate action is COMPLETE (not required)
-- Used to fix has_action misclassification

CREATE TABLE IF NOT EXISTS action_completion_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  keyword_pattern TEXT NOT NULL,
  pattern_flags TEXT DEFAULT 'i', -- case insensitive
  has_action_result BOOLEAN NOT NULL, -- false = action complete
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT unique_action_keyword UNIQUE(keyword_pattern)
);

-- Populate based on LEARNING-AGENT-DESIGN.md
INSERT INTO action_completion_keywords (keyword_pattern, has_action_result, notes) VALUES
  ('SI submitted', false, 'SI action complete'),
  ('VGM submitted', false, 'VGM action complete'),
  ('VGM verified', false, 'VGM verified'),
  ('eVGM is verified', false, 'Hapag VGM confirmed'),
  ('Shipping Instruction Submitted', false, 'SI confirmed'),
  ('Amendment submitted', false, 'Amendment processed'),
  ('booking confirmed', false, 'Booking complete'),
  ('confirmed successfully', false, 'Generic confirmation'),
  ('has been confirmed', false, 'Confirmation received'),
  ('payment received', false, 'Payment complete'),
  ('delivered successfully', false, 'Delivery complete'),
  ('customs cleared', false, 'Customs complete'),
  ('SOB Confirmation', false, 'Shipped on board - no action'),

  -- Patterns that DO require action
  ('submit your VGM', true, 'VGM required'),
  ('SI required', true, 'SI needed'),
  ('action required', true, 'Generic action'),
  ('please submit', true, 'Submission needed'),
  ('deadline', true, 'Has deadline'),
  ('urgent', true, 'Urgent action'),
  ('overdue', true, 'Late action'),
  ('reminder', true, 'Reminder = action pending')
ON CONFLICT (keyword_pattern) DO NOTHING;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to update pattern memory from learning episodes
CREATE OR REPLACE FUNCTION update_pattern_memory()
RETURNS void AS $$
BEGIN
  -- Update sender_domain patterns
  INSERT INTO pattern_memory (pattern_type, pattern_key, document_type_stats, total_observations, correct_observations)
  SELECT
    'sender_domain',
    sender_domain,
    jsonb_object_agg(
      COALESCE(corrected_document_type, predicted_document_type),
      count
    ),
    SUM(count)::int,
    SUM(CASE WHEN was_correct THEN count ELSE 0 END)::int
  FROM (
    SELECT
      sender_domain,
      COALESCE(corrected_document_type, predicted_document_type) as doc_type,
      COUNT(*) as count,
      was_correct
    FROM learning_episodes
    WHERE sender_domain IS NOT NULL
    GROUP BY sender_domain, COALESCE(corrected_document_type, predicted_document_type), was_correct
  ) sub
  GROUP BY sender_domain
  ON CONFLICT (pattern_type, pattern_key) DO UPDATE SET
    document_type_stats = EXCLUDED.document_type_stats,
    total_observations = EXCLUDED.total_observations,
    correct_observations = EXCLUDED.correct_observations,
    last_updated = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to get classification hints for a sender domain
CREATE OR REPLACE FUNCTION get_classification_hints(p_sender_domain TEXT)
RETURNS TABLE (
  suggested_type TEXT,
  confidence NUMERIC,
  reason TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (jsonb_each_text(document_type_stats)).key as suggested_type,
    ((jsonb_each_text(document_type_stats)).value::numeric / total_observations * 100)::numeric(5,2) as confidence,
    format('%s is %s%% %s', p_sender_domain,
      ((jsonb_each_text(document_type_stats)).value::numeric / total_observations * 100)::numeric(5,1),
      (jsonb_each_text(document_type_stats)).key
    ) as reason
  FROM pattern_memory
  WHERE pattern_type = 'sender_domain'
    AND pattern_key = p_sender_domain
    AND accuracy_rate > 0.6
  ORDER BY ((jsonb_each_text(document_type_stats)).value::numeric / total_observations) DESC
  LIMIT 3;
END;
$$ LANGUAGE plpgsql;

-- Function to normalize document type using enum mappings
CREATE OR REPLACE FUNCTION normalize_document_type(p_ai_value TEXT)
RETURNS TEXT AS $$
DECLARE
  v_correct_value TEXT;
BEGIN
  SELECT correct_value INTO v_correct_value
  FROM enum_mappings
  WHERE mapping_type = 'document_type'
    AND LOWER(ai_value) = LOWER(p_ai_value);

  IF v_correct_value IS NOT NULL THEN
    -- Update usage count
    UPDATE enum_mappings
    SET usage_count = usage_count + 1, last_used_at = NOW()
    WHERE mapping_type = 'document_type' AND LOWER(ai_value) = LOWER(p_ai_value);

    RETURN v_correct_value;
  END IF;

  RETURN p_ai_value; -- Return original if no mapping found
END;
$$ LANGUAGE plpgsql;

-- Function to validate document against flow
CREATE OR REPLACE FUNCTION validate_document_flow(
  p_shipment_stage TEXT,
  p_document_type TEXT
)
RETURNS TABLE (
  is_valid BOOLEAN,
  rule_type TEXT,
  warning_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE rule.rule_type
      WHEN 'expected' THEN true
      WHEN 'allowed' THEN true
      WHEN 'unexpected' THEN true
      WHEN 'impossible' THEN false
      ELSE true -- No rule = allowed
    END as is_valid,
    COALESCE(rule.rule_type, 'no_rule') as rule_type,
    CASE rule.rule_type
      WHEN 'unexpected' THEN format('Document type "%s" is unusual at stage "%s"', p_document_type, p_shipment_stage)
      WHEN 'impossible' THEN format('Document type "%s" should not appear at stage "%s" - likely misclassification', p_document_type, p_shipment_stage)
      ELSE NULL
    END as warning_message
  FROM (SELECT 1) dummy
  LEFT JOIN flow_validation_rules rule
    ON rule.shipment_stage = p_shipment_stage
    AND rule.document_type = p_document_type;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger to update pattern memory after learning episode correction
CREATE OR REPLACE FUNCTION trigger_update_pattern_memory()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger on corrections
  IF NEW.corrected_at IS NOT NULL AND OLD.corrected_at IS NULL THEN
    PERFORM update_pattern_memory();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: Trigger disabled by default for performance
-- Enable with: CREATE TRIGGER learning_episode_correction_trigger AFTER UPDATE ON learning_episodes FOR EACH ROW EXECUTE FUNCTION trigger_update_pattern_memory();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE learning_episodes IS 'Tracks every classification prediction and outcome for learning';
COMMENT ON TABLE pattern_memory IS 'Aggregated pattern statistics from learning episodes';
COMMENT ON TABLE enum_mappings IS 'Maps common AI mistakes to correct enum values';
COMMENT ON TABLE flow_validation_rules IS 'Defines valid document types per shipment stage';
COMMENT ON TABLE action_completion_keywords IS 'Keywords indicating action is complete vs required';

COMMENT ON FUNCTION update_pattern_memory() IS 'Refreshes pattern_memory from learning_episodes';
COMMENT ON FUNCTION get_classification_hints(TEXT) IS 'Returns classification hints for a sender domain';
COMMENT ON FUNCTION normalize_document_type(TEXT) IS 'Maps AI output to correct enum value';
COMMENT ON FUNCTION validate_document_flow(TEXT, TEXT) IS 'Validates document type against shipment stage';

-- ============================================================================
-- NON-SHIPPING LINE DETECTION PATTERNS
-- ============================================================================
-- Patterns for customs brokers, CHAs, and Intoglo documents
-- These work for Position 1 emails (subject first strategy)

INSERT INTO detection_patterns (
  carrier_id, pattern_type, document_type, pattern, pattern_flags,
  priority, confidence_base, requires_attachment, notes, enabled
) VALUES

  -- ============================================================================
  -- US CUSTOMS BROKER PATTERNS
  -- ============================================================================

  -- Draft Entry (sent for review before filing)
  ('customs_broker', 'subject', 'draft_entry', 'Draft Entry', 'i', 80, 95, false, 'US Customs broker draft entry for review', true),
  ('customs_broker', 'subject', 'draft_entry', 'Entry Draft', 'i', 79, 95, false, 'Alternative phrasing', true),
  ('customs_broker', 'subject', 'draft_entry', 'Customs Entry.*Review', 'i', 78, 90, false, 'Entry for review', true),
  ('customs_broker', 'subject', 'draft_entry', 'Entry.*for.*Approval', 'i', 77, 90, false, 'Entry approval request', true),

  -- Entry Summary (7501 filed)
  ('customs_broker', 'subject', 'entry_summary', 'Entry Summary', 'i', 80, 95, false, 'US Customs 7501 entry summary', true),
  ('customs_broker', 'subject', 'entry_summary', '7501', 'i', 79, 90, false, 'CBP form 7501', true),
  ('customs_broker', 'subject', 'entry_summary', 'Entry.*Filed', 'i', 78, 90, false, 'Entry filed notification', true),
  ('customs_broker', 'subject', 'entry_summary', 'Customs Entry.*Complete', 'i', 77, 85, false, 'Entry completion', true),

  -- ISF Filing
  ('customs_broker', 'subject', 'isf_filing', 'ISF Filing', 'i', 80, 95, false, 'Importer Security Filing', true),
  ('customs_broker', 'subject', 'isf_filing', 'ISF.*Submitted', 'i', 79, 95, false, 'ISF submitted', true),
  ('customs_broker', 'subject', 'isf_filing', '10\+2', 'i', 78, 90, false, '10+2 ISF reference', true),
  ('customs_broker', 'subject', 'isf_filing', 'Importer Security Filing', 'i', 77, 95, false, 'Full name', true),

  -- Duty Invoice
  ('customs_broker', 'subject', 'duty_invoice', 'Duty Invoice', 'i', 80, 95, false, 'Customs duty invoice', true),
  ('customs_broker', 'subject', 'duty_invoice', 'Duties.*Taxes', 'i', 79, 90, false, 'Duties and taxes', true),
  ('customs_broker', 'subject', 'duty_invoice', 'CBP.*Charges', 'i', 78, 85, false, 'CBP charges', true),
  ('customs_broker', 'subject', 'duty_invoice', 'Customs.*Fees', 'i', 77, 85, false, 'Customs fees', true),

  -- ============================================================================
  -- INDIA CHA (CUSTOMS HOUSE AGENT) PATTERNS
  -- ============================================================================

  -- Form 13
  ('india_cha', 'subject', 'form_13', 'Form.?13', 'i', 80, 95, false, 'India customs Form 13', true),
  ('india_cha', 'subject', 'form_13', 'F-?13', 'i', 79, 90, false, 'F13 abbreviation', true),

  -- Forwarding Note
  ('india_cha', 'subject', 'forwarding_note', 'Forwarding Note', 'i', 80, 95, false, 'CHA forwarding note', true),
  ('india_cha', 'subject', 'forwarding_note', 'FWD Note', 'i', 79, 90, false, 'Abbreviated', true),

  -- TR Submission (Transport Release)
  ('india_cha', 'subject', 'tr_submission', 'TR Submission', 'i', 80, 95, false, 'Transport Release submission', true),
  ('india_cha', 'subject', 'tr_submission', 'Transport Release', 'i', 79, 95, false, 'Full name', true),

  -- Shipping Bill
  ('india_cha', 'subject', 'shipping_bill', 'Shipping Bill', 'i', 80, 95, false, 'India export shipping bill', true),
  ('india_cha', 'subject', 'shipping_bill', 'SB.*Copy', 'i', 79, 90, false, 'SB copy', true),
  ('india_cha', 'subject', 'shipping_bill', 'SB //', 'i', 78, 90, false, 'SB with number format', true),

  -- LEO Copy (Let Export Order)
  ('india_cha', 'subject', 'leo_copy', 'LEO', 'i', 80, 95, false, 'Let Export Order copy', true),
  ('india_cha', 'subject', 'leo_copy', 'Let Export Order', 'i', 79, 95, false, 'Full name', true),

  -- ============================================================================
  -- INTOGLO INTERNAL PATTERNS
  -- ============================================================================

  -- Invoice (preliminary and final)
  ('intoglo', 'subject', 'invoice', 'Invoice //', 'i', 80, 95, false, 'Intoglo invoice with number', true),
  ('intoglo', 'subject', 'invoice', 'Preliminary Invoice', 'i', 79, 95, false, 'Pre-shipment invoice', true),
  ('intoglo', 'subject', 'invoice', 'Tax Invoice', 'i', 78, 95, false, 'Post-delivery tax invoice', true),
  ('intoglo', 'subject', 'invoice', 'Proforma Invoice', 'i', 77, 90, false, 'Proforma', true),

  -- Debit Note
  ('intoglo', 'subject', 'debit_note', 'Debit Note', 'i', 80, 95, false, 'Additional charges', true),
  ('intoglo', 'subject', 'debit_note', 'DN //', 'i', 79, 90, false, 'DN with number', true),

  -- Credit Note
  ('intoglo', 'subject', 'credit_note', 'Credit Note', 'i', 80, 95, false, 'Adjustments/refunds', true),
  ('intoglo', 'subject', 'credit_note', 'CN //', 'i', 79, 90, false, 'CN with number', true),

  -- Statement
  ('intoglo', 'subject', 'statement', 'Account Statement', 'i', 80, 95, false, 'Account statement', true),
  ('intoglo', 'subject', 'statement', 'SOA //', 'i', 79, 90, false, 'Statement of Account', true),

  -- ============================================================================
  -- GENERIC DOCUMENT PATTERNS (Any sender)
  -- ============================================================================

  -- Arrival Notice (generic)
  ('generic', 'subject', 'arrival_notice', 'Arrival Notice', 'i', 70, 90, false, 'Generic arrival notice', true),
  ('generic', 'subject', 'arrival_notice', 'Pre.?Arrival', 'i', 69, 85, false, 'Pre-arrival notice', true),

  -- Delivery Order
  ('generic', 'subject', 'delivery_order', 'Delivery Order', 'i', 70, 95, false, 'D/O issued', true),
  ('generic', 'subject', 'delivery_order', 'D/O //', 'i', 69, 90, false, 'D/O with number', true),

  -- Container Release
  ('generic', 'subject', 'container_release', 'Container Release', 'i', 70, 95, false, 'Release notification', true),
  ('generic', 'subject', 'container_release', 'Cargo Release', 'i', 69, 90, false, 'Cargo released', true),

  -- Empty Return
  ('generic', 'subject', 'empty_return', 'Empty Return', 'i', 70, 95, false, 'Container return', true),
  ('generic', 'subject', 'empty_return', 'Container Return', 'i', 69, 90, false, 'Container returned', true),

  -- POD (Proof of Delivery)
  ('generic', 'subject', 'pod_proof_of_delivery', 'Proof of Delivery', 'i', 70, 95, false, 'POD confirmation', true),
  ('generic', 'subject', 'pod_proof_of_delivery', 'POD //', 'i', 69, 90, false, 'POD with reference', true),
  ('generic', 'subject', 'pod_proof_of_delivery', 'Delivery Confirmation', 'i', 68, 85, false, 'Delivery confirmed', true)

ON CONFLICT (carrier_id, pattern_type, document_type, pattern) DO NOTHING;
