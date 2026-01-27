-- ============================================================================
-- LEARNING LOOP TRIGGERS
-- Makes the confidence system improve automatically over time
-- Applied: 2026-01-27
-- ============================================================================

-- 1. UPDATE SENDER TRUST when learning_episode is marked correct/incorrect
CREATE OR REPLACE FUNCTION update_sender_trust_on_feedback()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when was_correct changes from NULL to true/false
  IF OLD.was_correct IS NULL AND NEW.was_correct IS NOT NULL THEN
    -- Get sender domain from chronicle
    PERFORM update_sender_trust_score(
      (SELECT from_address FROM chronicle WHERE id = NEW.chronicle_id),
      NEW.was_correct
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_sender_trust ON learning_episodes;
CREATE TRIGGER trg_update_sender_trust
  AFTER UPDATE OF was_correct ON learning_episodes
  FOR EACH ROW
  EXECUTE FUNCTION update_sender_trust_on_feedback();

-- 2. AUTO-DISABLE BAD PATTERNS (false positive rate > 20%)
CREATE OR REPLACE FUNCTION check_and_disable_bad_patterns()
RETURNS TRIGGER AS $$
DECLARE
  v_false_positive_rate DECIMAL;
BEGIN
  -- Calculate false positive rate
  IF NEW.hit_count >= 10 THEN  -- Only check after 10 hits
    v_false_positive_rate := NEW.false_positive_count::DECIMAL / NEW.hit_count;

    IF v_false_positive_rate > 0.20 THEN
      -- Disable the pattern
      UPDATE detection_patterns
      SET enabled = false,
          disabled_reason = 'Auto-disabled: ' || ROUND(v_false_positive_rate * 100) || '% false positive rate',
          disabled_at = NOW()
      WHERE id = NEW.id;

      -- Log to pattern_audit if table exists
      INSERT INTO pattern_audit (pattern_id, action, details, created_at)
      SELECT NEW.id, 'auto_disabled', jsonb_build_object(
        'false_positive_rate', v_false_positive_rate,
        'hit_count', NEW.hit_count,
        'false_positive_count', NEW.false_positive_count
      ), NOW()
      WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pattern_audit');
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_disable_patterns ON detection_patterns;
CREATE TRIGGER trg_auto_disable_patterns
  AFTER UPDATE OF false_positive_count ON detection_patterns
  FOR EACH ROW
  EXECUTE FUNCTION check_and_disable_bad_patterns();

-- 3. SUGGEST NEW PATTERNS (when sender sends same doc_type 5+ times)
CREATE OR REPLACE FUNCTION suggest_pattern_from_learning()
RETURNS TRIGGER AS $$
DECLARE
  v_sender_domain TEXT;
  v_doc_type TEXT;
  v_count INT;
  v_existing_pattern INT;
BEGIN
  v_sender_domain := NEW.sender_domain;
  v_doc_type := NEW.predicted_document_type;

  -- Count successful predictions from this sender for this doc type
  SELECT COUNT(*) INTO v_count
  FROM learning_episodes
  WHERE sender_domain = v_sender_domain
    AND predicted_document_type = v_doc_type
    AND was_correct = true;

  -- If 5+ successful predictions, add to pending_patterns
  IF v_count >= 5 THEN
    -- Check if pattern already exists in detection_patterns
    SELECT COUNT(*) INTO v_existing_pattern
    FROM detection_patterns
    WHERE pattern ILIKE '%' || v_sender_domain || '%'
      AND document_type = v_doc_type;

    IF v_existing_pattern = 0 THEN
      -- Insert into pending_patterns with existing schema
      INSERT INTO pending_patterns (
        carrier_id,
        pattern_type,
        document_type,
        pattern,
        sample_count,
        accuracy_rate,
        status,
        discovered_at
      )
      VALUES (
        'auto_suggested',
        'sender',
        v_doc_type,
        v_sender_domain,
        v_count,
        1.0,  -- 100% accuracy since only counting correct ones
        'pending',
        NOW()
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_suggest_patterns ON learning_episodes;
CREATE TRIGGER trg_suggest_patterns
  AFTER UPDATE OF was_correct ON learning_episodes
  FOR EACH ROW
  WHEN (NEW.was_correct = true)
  EXECUTE FUNCTION suggest_pattern_from_learning();

-- 4. TRACK CONFIDENCE FEEDBACK (for threshold tuning)
CREATE TABLE IF NOT EXISTS confidence_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  confidence_calculation_id UUID,
  original_recommendation TEXT,
  was_correct BOOLEAN,
  corrected_document_type TEXT,
  feedback_source TEXT,  -- 'human', 'escalation_result', 'auto'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for analysis
CREATE INDEX IF NOT EXISTS idx_confidence_feedback_recommendation
ON confidence_feedback(original_recommendation, was_correct);

-- 5. VIEW: Confidence system performance
CREATE OR REPLACE VIEW confidence_system_stats AS
SELECT
  COALESCE(confidence_source, 'unknown') as confidence_source,
  COUNT(*) as total,
  COUNT(CASE WHEN escalated_to IS NOT NULL THEN 1 END) as escalated
FROM chronicle
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY confidence_source;

-- 6. VIEW: Sender trust leaderboard (most reliable senders)
CREATE OR REPLACE VIEW sender_trust_leaderboard AS
SELECT
  sender_domain,
  trust_score,
  total_emails,
  correct_extractions,
  ROUND((correct_extractions::numeric / NULLIF(total_emails, 0)) * 100, 1) as accuracy_pct,
  last_updated
FROM sender_trust_scores
WHERE total_emails >= 10
ORDER BY trust_score DESC
LIMIT 50;

-- 7. VIEW: Patterns needing review (high false positive rate)
CREATE OR REPLACE VIEW patterns_needing_review AS
SELECT
  id,
  pattern_type,
  document_type,
  pattern,
  hit_count,
  false_positive_count,
  ROUND((false_positive_count::numeric / NULLIF(hit_count, 0)) * 100, 1) as false_positive_pct,
  enabled
FROM detection_patterns
WHERE hit_count >= 5
  AND false_positive_count > 0
  AND (false_positive_count::numeric / NULLIF(hit_count, 0)) > 0.10
ORDER BY false_positive_count DESC;

COMMENT ON VIEW confidence_system_stats IS 'Shows confidence system performance over last 7 days';
COMMENT ON VIEW sender_trust_leaderboard IS 'Top 50 most reliable sender domains';
COMMENT ON VIEW patterns_needing_review IS 'Patterns with >10% false positive rate';
