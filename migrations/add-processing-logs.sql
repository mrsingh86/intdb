-- ============================================================================
-- Processing Logs Table
-- Tracks all agent runs for monitoring and debugging
-- ============================================================================

CREATE TABLE IF NOT EXISTS processing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Agent Information
  agent_name VARCHAR(100) NOT NULL,
  run_id UUID NOT NULL,

  -- Timing
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,

  -- Status
  status VARCHAR(50) NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),

  -- Statistics
  emails_processed INTEGER DEFAULT 0,
  emails_failed INTEGER DEFAULT 0,
  attachments_processed INTEGER DEFAULT 0,

  -- Error Details
  error_details JSONB,

  -- Additional Metadata
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_processing_logs_agent_name ON processing_logs(agent_name);
CREATE INDEX idx_processing_logs_run_id ON processing_logs(run_id);
CREATE INDEX idx_processing_logs_status ON processing_logs(status);
CREATE INDEX idx_processing_logs_started_at ON processing_logs(started_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_processing_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER processing_logs_updated_at
  BEFORE UPDATE ON processing_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_processing_logs_updated_at();

-- Grant permissions (adjust based on your user roles)
GRANT ALL ON processing_logs TO authenticated;
GRANT ALL ON processing_logs TO service_role;

-- ============================================================================
-- Sample Queries for Monitoring
-- ============================================================================

COMMENT ON TABLE processing_logs IS 'Tracks all agent processing runs for monitoring and debugging';

-- View recent agent runs
-- SELECT
--   agent_name,
--   run_id,
--   status,
--   started_at,
--   completed_at,
--   EXTRACT(EPOCH FROM (completed_at - started_at)) as duration_seconds,
--   emails_processed,
--   emails_failed
-- FROM processing_logs
-- ORDER BY started_at DESC
-- LIMIT 20;

-- Check agent performance over time
-- SELECT
--   DATE(started_at) as run_date,
--   agent_name,
--   COUNT(*) as total_runs,
--   SUM(emails_processed) as total_processed,
--   SUM(emails_failed) as total_failed,
--   AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
-- FROM processing_logs
-- WHERE status = 'completed'
-- GROUP BY DATE(started_at), agent_name
-- ORDER BY run_date DESC;