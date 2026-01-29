-- ============================================================================
-- CHRONICLE LOGGING SYSTEM
-- For debugging (engineer) and shipment journey tracking (freight forwarder)
-- ============================================================================

-- Run-level tracking (each time we process emails)
CREATE TABLE IF NOT EXISTS chronicle_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'running',  -- running, completed, failed, cancelled

  -- Configuration
  query_after TIMESTAMP WITH TIME ZONE,
  query_before TIMESTAMP WITH TIME ZONE,
  max_results INT,

  -- Email counts
  emails_total INT DEFAULT 0,
  emails_processed INT DEFAULT 0,
  emails_succeeded INT DEFAULT 0,
  emails_failed INT DEFAULT 0,
  emails_skipped INT DEFAULT 0,

  -- Shipment metrics
  shipments_created INT DEFAULT 0,
  shipments_updated INT DEFAULT 0,
  emails_linked INT DEFAULT 0,
  stage_changes INT DEFAULT 0,
  actions_detected INT DEFAULT 0,
  issues_detected INT DEFAULT 0,

  -- Performance
  total_time_ms BIGINT DEFAULT 0,
  avg_time_per_email_ms INT DEFAULT 0,

  -- Error summary (aggregated)
  error_summary JSONB DEFAULT '{}'::jsonb,

  -- Last progress report
  last_progress_at TIMESTAMP WITH TIME ZONE
);

-- Stage-level metrics per run
CREATE TABLE IF NOT EXISTS chronicle_stage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES chronicle_runs(id) ON DELETE CASCADE,
  stage VARCHAR(30) NOT NULL,  -- gmail_fetch, pdf_extract, ocr_extract, ai_analysis, db_save, linking

  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  skip_count INT DEFAULT 0,

  total_duration_ms BIGINT DEFAULT 0,
  avg_duration_ms INT DEFAULT 0,
  max_duration_ms INT DEFAULT 0,

  -- Stage-specific details
  details JSONB DEFAULT '{}'::jsonb,

  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(run_id, stage)
);

-- Individual errors (for debugging)
CREATE TABLE IF NOT EXISTS chronicle_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES chronicle_runs(id) ON DELETE CASCADE,
  gmail_message_id VARCHAR(200),

  stage VARCHAR(30) NOT NULL,
  error_type VARCHAR(50) NOT NULL,
  error_message TEXT,
  stack_trace TEXT,

  -- Severity for filtering
  severity VARCHAR(10) DEFAULT 'error',  -- warning, error, critical

  -- Context for debugging
  context JSONB DEFAULT '{}'::jsonb,

  -- Can we retry?
  is_recoverable BOOLEAN DEFAULT false,
  retry_count INT DEFAULT 0,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Shipment journey events (freight forwarder view)
CREATE TABLE IF NOT EXISTS shipment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
  chronicle_id UUID REFERENCES chronicle(id) ON DELETE SET NULL,
  run_id UUID REFERENCES chronicle_runs(id) ON DELETE SET NULL,

  -- Event classification
  event_type VARCHAR(30) NOT NULL,  -- created, stage_change, document_received, action_detected, issue_flagged, party_communication
  event_subtype VARCHAR(50),  -- specific action/issue type
  event_description TEXT,

  -- Stage tracking (for stage_change events)
  previous_stage VARCHAR(30),
  new_stage VARCHAR(30),

  -- Action details (for action_detected events)
  action_owner VARCHAR(30),
  action_deadline DATE,
  action_priority VARCHAR(10),

  -- Issue details (for issue_flagged events)
  issue_type VARCHAR(30),
  issue_severity VARCHAR(10),  -- low, medium, high, critical

  -- Source document
  document_type VARCHAR(50),
  from_party VARCHAR(30),

  -- When did this happen in the real world
  occurred_at TIMESTAMP WITH TIME ZONE,
  -- When did we detect it
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_chronicle_runs_status ON chronicle_runs(status);
CREATE INDEX IF NOT EXISTS idx_chronicle_runs_started ON chronicle_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_chronicle_errors_run ON chronicle_errors(run_id);
CREATE INDEX IF NOT EXISTS idx_chronicle_errors_type ON chronicle_errors(error_type);
CREATE INDEX IF NOT EXISTS idx_chronicle_errors_stage ON chronicle_errors(stage);
CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON shipment_events(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_events_type ON shipment_events(event_type);
CREATE INDEX IF NOT EXISTS idx_shipment_events_occurred ON shipment_events(occurred_at DESC);

-- Add stage column to shipments if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'shipments' AND column_name = 'stage') THEN
    ALTER TABLE shipments ADD COLUMN stage VARCHAR(30) DEFAULT 'PENDING';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'shipments' AND column_name = 'stage_updated_at') THEN
    ALTER TABLE shipments ADD COLUMN stage_updated_at TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

-- View: Current run progress (for monitoring)
CREATE OR REPLACE VIEW v_current_run_progress AS
SELECT
  r.id,
  r.status,
  r.started_at,
  r.emails_total,
  r.emails_processed,
  r.emails_succeeded,
  r.emails_failed,
  r.emails_skipped,
  CASE WHEN r.emails_total > 0
    THEN ROUND((r.emails_processed::numeric / r.emails_total) * 100, 1)
    ELSE 0
  END AS progress_pct,
  r.shipments_created,
  r.emails_linked,
  r.stage_changes,
  r.actions_detected,
  r.issues_detected,
  r.avg_time_per_email_ms,
  EXTRACT(EPOCH FROM (NOW() - r.started_at))::int AS elapsed_seconds
FROM chronicle_runs r
WHERE r.status = 'running'
ORDER BY r.started_at DESC
LIMIT 1;

-- View: Shipment stage distribution
CREATE OR REPLACE VIEW v_shipment_stages AS
SELECT
  stage,
  COUNT(*) as count
FROM shipments
GROUP BY stage
ORDER BY
  CASE stage
    WHEN 'PENDING' THEN 1
    WHEN 'REQUESTED' THEN 2
    WHEN 'BOOKED' THEN 3
    WHEN 'SI_STAGE' THEN 4
    WHEN 'DRAFT_BL' THEN 5
    WHEN 'BL_ISSUED' THEN 6
    WHEN 'ARRIVED' THEN 7
    WHEN 'DELIVERED' THEN 8
    ELSE 9
  END;

-- View: Recent shipment events
CREATE OR REPLACE VIEW v_recent_shipment_events AS
SELECT
  se.event_type,
  se.event_description,
  se.previous_stage,
  se.new_stage,
  se.document_type,
  se.from_party,
  se.occurred_at,
  s.booking_number,
  s.intoglo_reference,
  s.mbl_number
FROM shipment_events se
JOIN shipments s ON s.id = se.shipment_id
ORDER BY se.occurred_at DESC
LIMIT 100;
