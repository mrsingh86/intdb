-- Migration 073: Clean up old chronicle_runs and chronicle_errors
-- chronicle_runs grows at 288 rows/day (4,622 total), needs pruning
-- chronicle_errors has 6,248 rows, old resolved errors should be archived

-- Delete chronicle_runs older than 30 days (keep recent for monitoring)
DELETE FROM chronicle_runs
WHERE created_at < NOW() - INTERVAL '30 days'
  AND status IN ('completed', 'failed');

-- Delete chronicle_errors older than 60 days (keep recent for debugging)
-- Errors older than 60 days are unlikely to be actionable
DELETE FROM chronicle_errors
WHERE created_at < NOW() - INTERVAL '60 days';

-- Delete orphaned chronicle_stage_metrics (no matching run)
DELETE FROM chronicle_stage_metrics
WHERE run_id NOT IN (SELECT id FROM chronicle_runs);

-- Add created_at index on chronicle_errors for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_chronicle_errors_created_at
ON chronicle_errors (created_at);

-- Add created_at index on chronicle_runs for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_chronicle_runs_created_at
ON chronicle_runs (created_at);
