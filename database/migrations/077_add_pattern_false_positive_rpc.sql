-- Migration 077: Add RPC function for incrementing pattern false positives
-- Used by the learning classification correction API when a pattern prediction is wrong
-- Closes the learning loop: corrections feed back into pattern reliability scores

-- Create the RPC function for atomic false_positive_count increment
CREATE OR REPLACE FUNCTION increment_pattern_false_positive(p_pattern_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE detection_patterns
  SET false_positive_count = COALESCE(false_positive_count, 0) + 1,
      updated_at = NOW()
  WHERE id = p_pattern_id;
END;
$$ LANGUAGE plpgsql;

-- Add false_positive_count column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'detection_patterns' AND column_name = 'false_positive_count'
  ) THEN
    ALTER TABLE detection_patterns ADD COLUMN false_positive_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Auto-disable patterns with too many false positives (>5 false positives = unreliable)
-- This is a safety net - patterns with high false positive rates should be reviewed
CREATE OR REPLACE FUNCTION check_pattern_reliability()
RETURNS trigger AS $$
BEGIN
  IF NEW.false_positive_count >= 5 AND NEW.enabled = true THEN
    NEW.enabled := false;
    RAISE NOTICE 'Pattern % auto-disabled: % false positives', NEW.id, NEW.false_positive_count;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists before re-creating
DROP TRIGGER IF EXISTS pattern_reliability_check ON detection_patterns;
CREATE TRIGGER pattern_reliability_check
  BEFORE UPDATE ON detection_patterns
  FOR EACH ROW
  WHEN (NEW.false_positive_count IS DISTINCT FROM OLD.false_positive_count)
  EXECUTE FUNCTION check_pattern_reliability();
