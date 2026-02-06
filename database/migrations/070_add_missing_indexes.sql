-- Migration 070: Add missing indexes for frequently queried columns
-- Identified by database-auditor: these columns are used in WHERE clauses
-- but have no indexes, causing full table scans

-- document_type: used in action rules, classification analysis, dashboards
CREATE INDEX IF NOT EXISTS idx_chronicle_document_type
ON chronicle (document_type);

-- created_at: used for time-range queries, dashboard filters, cron lookback
CREATE INDEX IF NOT EXISTS idx_chronicle_created_at
ON chronicle (created_at);

-- from_address: used for sender analysis, pattern matching, deduplication
CREATE INDEX IF NOT EXISTS idx_chronicle_from_address
ON chronicle (from_address);

-- needs_reanalysis: used by reprocessing cron to find emails needing re-analysis
CREATE INDEX IF NOT EXISTS idx_chronicle_needs_reanalysis
ON chronicle (needs_reanalysis) WHERE needs_reanalysis = true;

-- has_issue: used by dashboard to show flagged emails
CREATE INDEX IF NOT EXISTS idx_chronicle_has_issue
ON chronicle (has_issue) WHERE has_issue = true;

-- Composite index for action queries (pending actions dashboard)
CREATE INDEX IF NOT EXISTS idx_chronicle_pending_actions
ON chronicle (has_action, action_completed_at)
WHERE has_action = true AND action_completed_at IS NULL;
