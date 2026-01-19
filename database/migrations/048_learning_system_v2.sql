-- ============================================================================
-- MIGRATION 048: LEARNING SYSTEM V2 (Flow-Based)
-- ============================================================================
-- Purpose: Shift from sender-based guessing to flow-based learning
-- Changes:
--   - DROP pattern_memory table (sender-based guessing is obsolete)
--   - DROP related functions (update_pattern_memory, get_classification_hints)
--   - ADD review workflow columns to learning_episodes
--   - ADD action tracking columns to learning_episodes
--   - CREATE pattern_audit table for tracking pattern lifecycle
-- Author: Chronicle Enhancement
-- Date: 2026-01-16
-- ============================================================================

-- ============================================================================
-- PART 1: DROP OBSOLETE COMPONENTS
-- ============================================================================
-- Pattern memory was designed for sender-based guessing ("service.hlag.com
-- sends 57% booking"). We've shifted to flow-based classification using
-- shipment stages. These components are no longer needed.

-- Drop trigger function first (depends on update_pattern_memory)
DROP FUNCTION IF EXISTS trigger_update_pattern_memory() CASCADE;

-- Drop sender-based functions
DROP FUNCTION IF EXISTS update_pattern_memory() CASCADE;
DROP FUNCTION IF EXISTS get_classification_hints(TEXT) CASCADE;

-- Drop pattern_memory table
DROP TABLE IF EXISTS pattern_memory CASCADE;

-- ============================================================================
-- PART 2: ADD REVIEW WORKFLOW COLUMNS TO LEARNING_EPISODES
-- ============================================================================
-- Enable flagging classifications for human review instead of auto-correction

-- Add review workflow columns
ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;

ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS review_reason TEXT;
  -- Values: 'impossible_flow', 'low_confidence', 'action_override', 'auto_corrected'

ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS reviewed_by UUID;

-- ============================================================================
-- PART 3: ADD ACTION TRACKING COLUMNS TO LEARNING_EPISODES
-- ============================================================================
-- Track action keyword overrides for learning

ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS action_keyword_override BOOLEAN DEFAULT FALSE;

ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS action_keyword_matched TEXT;

-- ============================================================================
-- PART 4: ADD AUTO-CORRECTION TRACKING
-- ============================================================================
-- Track when and why classifications were auto-corrected

ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS auto_corrected BOOLEAN DEFAULT FALSE;

ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS auto_correction_reason TEXT;

ALTER TABLE learning_episodes
  ADD COLUMN IF NOT EXISTS original_prediction TEXT;

-- ============================================================================
-- PART 5: CREATE PATTERN_AUDIT TABLE
-- ============================================================================
-- Track pattern lifecycle: discovery, approval, modification, disabling

CREATE TABLE IF NOT EXISTS pattern_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Action taken
  action TEXT NOT NULL CHECK (action IN ('discovered', 'approved', 'rejected', 'modified', 'disabled', 're-enabled', 'deleted')),

  -- Pattern reference (NULL for discovered patterns pending approval)
  pattern_id UUID REFERENCES detection_patterns(id) ON DELETE SET NULL,

  -- Pattern details (stored for history even if pattern deleted)
  pattern_template TEXT,
  document_type TEXT,
  carrier_id TEXT,

  -- Discovery context
  sample_count INTEGER,
  accuracy_before NUMERIC(5,4),
  accuracy_after NUMERIC(5,4),

  -- Reason for action
  reason TEXT,

  -- Who/what performed the action
  created_by UUID, -- NULL for auto-discovery
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'auto_discovery', 'auto_cleanup', 'system')),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for pattern_audit
CREATE INDEX IF NOT EXISTS idx_pattern_audit_pattern ON pattern_audit(pattern_id);
CREATE INDEX IF NOT EXISTS idx_pattern_audit_action ON pattern_audit(action);
CREATE INDEX IF NOT EXISTS idx_pattern_audit_created ON pattern_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pattern_audit_pending ON pattern_audit(action) WHERE action = 'discovered';

-- ============================================================================
-- PART 6: ADD INDEXES FOR REVIEW WORKFLOW
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_learning_episodes_needs_review
  ON learning_episodes(needs_review) WHERE needs_review = TRUE;

CREATE INDEX IF NOT EXISTS idx_learning_episodes_review_reason
  ON learning_episodes(review_reason) WHERE review_reason IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_learning_episodes_action_override
  ON learning_episodes(action_keyword_override) WHERE action_keyword_override = TRUE;

-- ============================================================================
-- PART 7: ADD COLUMNS TO DETECTION_PATTERNS FOR ACCURACY TRACKING
-- ============================================================================
-- Track pattern accuracy for auto-cleanup

ALTER TABLE detection_patterns
  ADD COLUMN IF NOT EXISTS hit_count INTEGER DEFAULT 0;

ALTER TABLE detection_patterns
  ADD COLUMN IF NOT EXISTS false_positive_count INTEGER DEFAULT 0;

ALTER TABLE detection_patterns
  ADD COLUMN IF NOT EXISTS last_hit_at TIMESTAMPTZ;

ALTER TABLE detection_patterns
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'auto_discovery', 'migration'));

-- ============================================================================
-- PART 8: CREATE PENDING PATTERNS TABLE
-- ============================================================================
-- Patterns discovered but not yet approved for production use

CREATE TABLE IF NOT EXISTS pending_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pattern definition (same structure as detection_patterns)
  carrier_id TEXT NOT NULL,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN ('subject', 'sender', 'body', 'attachment')),
  document_type TEXT NOT NULL,
  pattern TEXT NOT NULL,
  pattern_flags TEXT DEFAULT 'i',

  -- Discovery stats
  sample_count INTEGER NOT NULL,
  accuracy_rate NUMERIC(5,4) NOT NULL,
  sample_chronicle_ids UUID[],  -- Sample of chronicle IDs that matched

  -- Discovery metadata
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  discovery_batch_id UUID,  -- Groups patterns discovered together

  -- Review status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID,
  rejection_reason TEXT,

  -- If approved, link to created pattern
  approved_pattern_id UUID REFERENCES detection_patterns(id) ON DELETE SET NULL,

  CONSTRAINT unique_pending_pattern UNIQUE(carrier_id, pattern_type, document_type, pattern)
);

-- Indexes for pending_patterns
CREATE INDEX IF NOT EXISTS idx_pending_patterns_status ON pending_patterns(status);
CREATE INDEX IF NOT EXISTS idx_pending_patterns_discovered ON pending_patterns(discovered_at DESC);

-- ============================================================================
-- PART 9: COMMENTS
-- ============================================================================

COMMENT ON TABLE pattern_audit IS 'Audit trail for pattern lifecycle: discovery, approval, modification, cleanup';
COMMENT ON TABLE pending_patterns IS 'Auto-discovered patterns awaiting human approval';

COMMENT ON COLUMN learning_episodes.needs_review IS 'Flag for human review (impossible flow, low confidence, etc.)';
COMMENT ON COLUMN learning_episodes.review_reason IS 'Why this episode needs review: impossible_flow, low_confidence, action_override';
COMMENT ON COLUMN learning_episodes.action_keyword_override IS 'True if action_completion_keywords overrode AI has_action decision';
COMMENT ON COLUMN learning_episodes.action_keyword_matched IS 'The keyword pattern that triggered the override';
COMMENT ON COLUMN learning_episodes.auto_corrected IS 'True if classification was auto-corrected (e.g., enum normalization)';
COMMENT ON COLUMN learning_episodes.original_prediction IS 'Original AI prediction before auto-correction';

COMMENT ON COLUMN detection_patterns.hit_count IS 'Number of times this pattern matched an email';
COMMENT ON COLUMN detection_patterns.false_positive_count IS 'Number of times pattern match was later corrected';
COMMENT ON COLUMN detection_patterns.source IS 'How pattern was created: manual, auto_discovery, migration';

-- ============================================================================
-- PART 10: UPDATE EXISTING PATTERNS SOURCE
-- ============================================================================
-- Mark existing patterns as 'migration' source

UPDATE detection_patterns
SET source = 'migration'
WHERE source IS NULL;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Summary of changes:
-- 1. DROPPED: pattern_memory table (sender-based guessing obsolete)
-- 2. DROPPED: update_pattern_memory(), get_classification_hints(), trigger_update_pattern_memory()
-- 3. KEPT: normalize_document_type(), validate_document_flow() (still useful)
-- 4. ADDED: Review workflow columns to learning_episodes
-- 5. ADDED: Action tracking columns to learning_episodes
-- 6. ADDED: Accuracy tracking columns to detection_patterns
-- 7. CREATED: pattern_audit table for pattern lifecycle tracking
-- 8. CREATED: pending_patterns table for auto-discovered patterns
