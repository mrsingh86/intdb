-- Chronicle Classification Review System
-- Add columns for manual review tracking
-- Run this in Supabase SQL Editor

-- ============================================================================
-- REVIEW TRACKING COLUMNS
-- ============================================================================

-- Review status: pending (needs review), reviewed (corrected), skipped (ignored)
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS review_status TEXT
  DEFAULT NULL
  CHECK (review_status IS NULL OR review_status IN ('pending', 'reviewed', 'skipped'));

-- When the record was reviewed
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Original document type before correction (for audit trail)
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS original_document_type TEXT;

-- Flag indicating this record needs manual review
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;

-- Reason why this record was flagged for review
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS review_reason TEXT;

-- ============================================================================
-- INDEX FOR REVIEW QUEUE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_chronicle_needs_review
  ON chronicle(needs_review, occurred_at DESC)
  WHERE needs_review = TRUE;

CREATE INDEX IF NOT EXISTS idx_chronicle_review_status
  ON chronicle(review_status)
  WHERE review_status IS NOT NULL;

-- ============================================================================
-- HELPER FUNCTION: Flag record for review
-- ============================================================================

CREATE OR REPLACE FUNCTION flag_for_review(
  p_chronicle_id UUID,
  p_reason TEXT DEFAULT 'manual'
) RETURNS VOID AS $$
BEGIN
  UPDATE chronicle
  SET
    needs_review = TRUE,
    review_status = 'pending',
    review_reason = p_reason
  WHERE id = p_chronicle_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER FUNCTION: Mark as reviewed
-- ============================================================================

CREATE OR REPLACE FUNCTION mark_as_reviewed(
  p_chronicle_id UUID,
  p_new_document_type TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_current_type TEXT;
BEGIN
  -- Get current document type
  SELECT document_type INTO v_current_type FROM chronicle WHERE id = p_chronicle_id;

  -- Update the record
  UPDATE chronicle
  SET
    needs_review = FALSE,
    review_status = 'reviewed',
    reviewed_at = NOW(),
    original_document_type = CASE
      WHEN p_new_document_type IS NOT NULL AND p_new_document_type != v_current_type
      THEN v_current_type
      ELSE original_document_type
    END,
    document_type = COALESCE(p_new_document_type, document_type)
  WHERE id = p_chronicle_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- HELPER FUNCTION: Skip review
-- ============================================================================

CREATE OR REPLACE FUNCTION skip_review(
  p_chronicle_id UUID
) RETURNS VOID AS $$
BEGIN
  UPDATE chronicle
  SET
    needs_review = FALSE,
    review_status = 'skipped',
    reviewed_at = NOW()
  WHERE id = p_chronicle_id;
END;
$$ LANGUAGE plpgsql;
