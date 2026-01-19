-- Migration: 049_action_rules_and_priority.sql
-- Purpose: Better action detection + review prioritization + pattern noise prevention
-- Date: 2025-01-16

-- ============================================================================
-- PART 1: DOCUMENT TYPE ACTION RULES (Replace keyword-only approach)
-- ============================================================================

-- Document type determines DEFAULT action, with exception keywords that flip it
CREATE TABLE IF NOT EXISTS document_type_action_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(100) NOT NULL UNIQUE,

  -- Default action for this document type
  default_has_action BOOLEAN NOT NULL DEFAULT FALSE,
  default_reason TEXT,  -- Why this default makes sense

  -- Exception keywords that FLIP the default
  flip_to_action_keywords JSONB DEFAULT '[]',     -- If default=false, these make it true
  flip_to_no_action_keywords JSONB DEFAULT '[]',  -- If default=true, these make it false

  -- Confidence adjustments
  confidence_boost INTEGER DEFAULT 0,  -- Add to AI confidence when rule matches

  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_action_rules_document_type ON document_type_action_rules(document_type) WHERE enabled = true;

-- Populate with freight forwarding document types
INSERT INTO document_type_action_rules (document_type, default_has_action, default_reason, flip_to_action_keywords, flip_to_no_action_keywords) VALUES
  -- CONFIRMATIONS (default: no action - they're telling you something is done)
  ('booking_confirmation', false, 'Confirmations are informational, booking is complete',
   '["missing", "required", "please provide", "action needed", "incomplete", "pending"]'::jsonb,
   '[]'::jsonb),

  ('si_confirmation', false, 'SI accepted, no action unless issues flagged',
   '["rejected", "amendment required", "discrepancy", "please correct", "missing"]'::jsonb,
   '[]'::jsonb),

  ('vgm_confirmation', false, 'VGM submitted/verified, informational',
   '["rejected", "mismatch", "please resubmit", "error"]'::jsonb,
   '[]'::jsonb),

  ('bl_confirmation', false, 'BL issued, informational',
   '["surrender required", "original required", "telex release pending"]'::jsonb,
   '[]'::jsonb),

  -- REQUESTS (default: action required - they're asking you to do something)
  ('shipping_instructions', true, 'SI needs to be submitted or reviewed',
   '[]'::jsonb,
   '["submitted", "received", "confirmed", "accepted", "thank you for"]'::jsonb),

  ('vgm_request', true, 'VGM submission is required',
   '[]'::jsonb,
   '["submitted", "received", "verified", "confirmed"]'::jsonb),

  ('draft_bl', true, 'Draft BL needs review and approval',
   '[]'::jsonb,
   '["approved", "confirmed", "no changes", "accepted as is"]'::jsonb),

  ('amendment_notice', true, 'Amendment needs review/acknowledgment',
   '[]'::jsonb,
   '["for your information", "FYI", "no action required", "for your records"]'::jsonb),

  -- NOTICES (default: no action - informational updates)
  ('arrival_notice', false, 'Vessel arrival is informational',
   '["customs hold", "demurrage", "detention", "action required", "release pending"]'::jsonb,
   '[]'::jsonb),

  ('departure_notice', false, 'Vessel departure is informational',
   '["delay", "rollover", "reschedule"]'::jsonb,
   '[]'::jsonb),

  ('tracking_update', false, 'Status update is informational',
   '["exception", "delay", "hold", "issue"]'::jsonb,
   '[]'::jsonb),

  -- DOCUMENTS (default: varies)
  ('final_bl', false, 'Final BL issued, informational unless surrender needed',
   '["surrender", "original required", "endorsement", "release"]'::jsonb,
   '[]'::jsonb),

  ('sea_waybill', false, 'Sea waybill issued, informational',
   '["amendment", "correction needed"]'::jsonb,
   '[]'::jsonb),

  ('invoice', true, 'Invoices typically need payment action',
   '[]'::jsonb,
   '["paid", "settled", "for your records", "receipt"]'::jsonb),

  ('debit_note', true, 'Debit notes need payment action',
   '[]'::jsonb,
   '["paid", "settled", "cancelled"]'::jsonb),

  ('credit_note', false, 'Credit notes are informational (money coming to you)',
   '[]'::jsonb,
   '[]'::jsonb),

  -- CUSTOMS/COMPLIANCE (default: action - usually need response)
  ('customs_entry', true, 'Customs entry needs attention',
   '[]'::jsonb,
   '["cleared", "released", "completed"]'::jsonb),

  ('customs_release', false, 'Customs cleared, informational',
   '["hold", "inspection", "additional documents"]'::jsonb,
   '[]'::jsonb),

  -- GENERAL
  ('general_correspondence', false, 'Default to no action for general emails',
   '["urgent", "asap", "action required", "please confirm", "please advise", "awaiting"]'::jsonb,
   '[]'::jsonb),

  ('unknown', false, 'Unknown document types default to no action',
   '["urgent", "action required", "please"]'::jsonb,
   '[]'::jsonb)
ON CONFLICT (document_type) DO UPDATE SET
  default_has_action = EXCLUDED.default_has_action,
  default_reason = EXCLUDED.default_reason,
  flip_to_action_keywords = EXCLUDED.flip_to_action_keywords,
  flip_to_no_action_keywords = EXCLUDED.flip_to_no_action_keywords,
  updated_at = NOW();


-- ============================================================================
-- PART 2: REVIEW PRIORITY SCORING (Prioritize by business impact)
-- ============================================================================

-- Add priority columns to learning_episodes
ALTER TABLE learning_episodes ADD COLUMN IF NOT EXISTS review_priority INTEGER DEFAULT 50;
ALTER TABLE learning_episodes ADD COLUMN IF NOT EXISTS priority_factors JSONB DEFAULT '{}';

-- Priority scoring factors:
-- Base: 50
-- +30: impossible_flow (highest risk - classification likely wrong)
-- +20: low_confidence (<70%)
-- +15: action_keyword_override (AI and keyword disagree)
-- +10: high_value_document (BL, invoice, customs)
-- +5:  recent email (within 24 hours)
-- -10: old email (>7 days)
-- -20: already reviewed once before

-- Create function to calculate review priority
CREATE OR REPLACE FUNCTION calculate_review_priority(
  p_review_reason TEXT,
  p_prediction_confidence INTEGER,
  p_predicted_document_type TEXT,
  p_action_keyword_override BOOLEAN,
  p_created_at TIMESTAMPTZ,
  p_was_correct BOOLEAN
) RETURNS INTEGER AS $$
DECLARE
  priority INTEGER := 50;
  factors JSONB := '{}';
BEGIN
  -- Impossible flow is highest priority
  IF p_review_reason = 'impossible_flow' THEN
    priority := priority + 30;
    factors := factors || '{"impossible_flow": 30}';
  END IF;

  -- Low confidence
  IF p_prediction_confidence < 70 THEN
    priority := priority + 20;
    factors := factors || '{"low_confidence": 20}';
  ELSIF p_prediction_confidence < 80 THEN
    priority := priority + 10;
    factors := factors || '{"medium_confidence": 10}';
  END IF;

  -- Action keyword override (disagreement)
  IF p_action_keyword_override = TRUE THEN
    priority := priority + 15;
    factors := factors || '{"action_override": 15}';
  END IF;

  -- High-value document types
  IF p_predicted_document_type IN ('final_bl', 'draft_bl', 'invoice', 'customs_entry', 'customs_release', 'debit_note') THEN
    priority := priority + 10;
    factors := factors || '{"high_value_doc": 10}';
  END IF;

  -- Recency bonus/penalty
  IF p_created_at > NOW() - INTERVAL '24 hours' THEN
    priority := priority + 5;
    factors := factors || '{"recent": 5}';
  ELSIF p_created_at < NOW() - INTERVAL '7 days' THEN
    priority := priority - 10;
    factors := factors || '{"old": -10}';
  END IF;

  -- Previously reviewed
  IF p_was_correct IS NOT NULL THEN
    priority := priority - 20;
    factors := factors || '{"previously_reviewed": -20}';
  END IF;

  -- Clamp to 0-100 range
  RETURN GREATEST(0, LEAST(100, priority));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-calculate priority on insert/update
CREATE OR REPLACE FUNCTION update_review_priority() RETURNS TRIGGER AS $$
BEGIN
  NEW.review_priority := calculate_review_priority(
    NEW.review_reason,
    NEW.prediction_confidence,
    NEW.predicted_document_type,
    NEW.action_keyword_override,
    NEW.created_at,
    NEW.was_correct
  );

  NEW.priority_factors := jsonb_build_object(
    'review_reason', NEW.review_reason,
    'confidence', NEW.prediction_confidence,
    'document_type', NEW.predicted_document_type,
    'action_override', NEW.action_keyword_override,
    'age_days', EXTRACT(days FROM NOW() - NEW.created_at)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_review_priority ON learning_episodes;
CREATE TRIGGER trg_update_review_priority
  BEFORE INSERT OR UPDATE ON learning_episodes
  FOR EACH ROW
  EXECUTE FUNCTION update_review_priority();

-- Update existing records with priority
UPDATE learning_episodes SET
  review_priority = calculate_review_priority(
    review_reason,
    prediction_confidence,
    predicted_document_type,
    action_keyword_override,
    created_at,
    was_correct
  )
WHERE review_priority IS NULL OR review_priority = 50;


-- ============================================================================
-- PART 3: PATTERN DISCOVERY IMPROVEMENTS (Prevent noise)
-- ============================================================================

-- Add columns to pending_patterns for better filtering
ALTER TABLE pending_patterns ADD COLUMN IF NOT EXISTS normalized_pattern TEXT;
ALTER TABLE pending_patterns ADD COLUMN IF NOT EXISTS pattern_quality_score INTEGER DEFAULT 50;
ALTER TABLE pending_patterns ADD COLUMN IF NOT EXISTS rejection_risk_factors JSONB DEFAULT '{}';

-- Pattern quality scoring function
-- Penalizes patterns that are likely to be noise
CREATE OR REPLACE FUNCTION calculate_pattern_quality(
  p_pattern TEXT,
  p_sample_count INTEGER,
  p_accuracy_rate NUMERIC
) RETURNS INTEGER AS $$
DECLARE
  quality INTEGER := 50;
  risk_factors JSONB := '{}';
BEGIN
  -- Base quality from accuracy and volume
  quality := quality + (p_accuracy_rate * 30)::INTEGER;  -- +0-30 for 0-100% accuracy

  IF p_sample_count >= 50 THEN
    quality := quality + 15;
    risk_factors := risk_factors || '{"high_volume": 15}';
  ELSIF p_sample_count >= 20 THEN
    quality := quality + 10;
    risk_factors := risk_factors || '{"medium_volume": 10}';
  END IF;

  -- PENALTIES for noise indicators

  -- Too many RE:/FW: prefixes remaining (should have been stripped)
  IF p_pattern ~* '^(RE:|FW:|Fwd:)\s*' THEN
    quality := quality - 20;
    risk_factors := risk_factors || '{"reply_prefix_noise": -20}';
  END IF;

  -- Pattern is too short (likely to match too broadly)
  IF LENGTH(p_pattern) < 15 THEN
    quality := quality - 25;
    risk_factors := risk_factors || '{"too_short": -25}';
  END IF;

  -- Pattern is mostly placeholders (too generic)
  IF (LENGTH(REGEXP_REPLACE(p_pattern, 'NNNNN|DATE', '', 'g')) * 1.0 / LENGTH(p_pattern)) < 0.5 THEN
    quality := quality - 30;
    risk_factors := risk_factors || '{"too_generic": -30}';
  END IF;

  -- Pattern contains only common words
  IF p_pattern ~* '^(update|notification|notice|alert|reminder|information)\s*$' THEN
    quality := quality - 40;
    risk_factors := risk_factors || '{"common_word_only": -40}';
  END IF;

  -- Pattern looks like a container number placeholder (good!)
  IF p_pattern ~* '[A-Z]{4}NNNNNNN' THEN
    quality := quality + 10;
    risk_factors := risk_factors || '{"container_pattern": 10}';
  END IF;

  -- Pattern has carrier-specific keywords (good!)
  IF p_pattern ~* '(maersk|hapag|cma|msc|evergreen|cosco|one line|yang ming)' THEN
    quality := quality + 5;
    risk_factors := risk_factors || '{"carrier_specific": 5}';
  END IF;

  RETURN GREATEST(0, LEAST(100, quality));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create index for prioritized review queue
CREATE INDEX IF NOT EXISTS idx_learning_episodes_review_priority
  ON learning_episodes(review_priority DESC, created_at DESC)
  WHERE needs_review = true AND reviewed_at IS NULL;

-- Create index for pattern quality
CREATE INDEX IF NOT EXISTS idx_pending_patterns_quality
  ON pending_patterns(pattern_quality_score DESC)
  WHERE status = 'pending';


-- ============================================================================
-- PART 4: AUDIT TRAIL FOR ACTION RULES
-- ============================================================================

-- Track when action rules are used/overridden
ALTER TABLE learning_episodes ADD COLUMN IF NOT EXISTS action_rule_applied BOOLEAN DEFAULT FALSE;
ALTER TABLE learning_episodes ADD COLUMN IF NOT EXISTS action_rule_document_type TEXT;
ALTER TABLE learning_episodes ADD COLUMN IF NOT EXISTS action_rule_default_used BOOLEAN;
ALTER TABLE learning_episodes ADD COLUMN IF NOT EXISTS action_rule_flip_keyword TEXT;


-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE document_type_action_rules IS
'Determines default has_action based on document type, with exception keywords that flip the default.
Example: booking_confirmation defaults to NO action, but "missing VGM" flips it to action required.';

COMMENT ON COLUMN learning_episodes.review_priority IS
'0-100 priority score for human review queue. Higher = more urgent.
Factors: impossible_flow (+30), low_confidence (+20), action_override (+15), high_value_doc (+10), recency (+/-5-10)';

COMMENT ON COLUMN pending_patterns.pattern_quality_score IS
'0-100 quality score for discovered patterns. Higher = more likely to be useful.
Penalizes: too short, too generic, reply prefixes. Rewards: high volume, carrier-specific, container patterns.';
