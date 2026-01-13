-- Migration: Chronicle Sync State
-- Purpose: Track Gmail sync state for hybrid historyId + timestamp fetching
-- Created: Thread handling improvements

-- ============================================================================
-- SYNC STATE TABLE
-- ============================================================================

-- Table for tracking Gmail sync state
-- Enables efficient incremental syncing using historyId
CREATE TABLE IF NOT EXISTS chronicle_sync_state (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'default',

  -- Gmail historyId for incremental sync
  last_history_id VARCHAR(50),

  -- Sync timestamps
  last_sync_at TIMESTAMPTZ,
  last_full_sync_at TIMESTAMPTZ,

  -- Status tracking
  sync_status VARCHAR(20) DEFAULT 'initial' CHECK (sync_status IN ('active', 'error', 'initial')),
  sync_error_message TEXT,
  consecutive_failures INTEGER DEFAULT 0,

  -- Statistics
  emails_synced_total INTEGER DEFAULT 0,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default row if not exists
INSERT INTO chronicle_sync_state (id, sync_status)
VALUES ('default', 'initial')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- INDEX FOR THREAD CONTEXT QUERIES
-- ============================================================================

-- Optimize thread context fetching (used by getThreadContext)
CREATE INDEX IF NOT EXISTS idx_chronicle_thread_occurred
ON chronicle(thread_id, occurred_at DESC);

-- Composite index for shipment + time queries (used in summaries)
CREATE INDEX IF NOT EXISTS idx_chronicle_shipment_occurred
ON chronicle(shipment_id, occurred_at DESC);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE chronicle_sync_state IS 'Tracks Gmail sync state for hybrid historyId + timestamp fetching';
COMMENT ON COLUMN chronicle_sync_state.last_history_id IS 'Gmail historyId for incremental sync';
COMMENT ON COLUMN chronicle_sync_state.last_full_sync_at IS 'Last weekly full sync timestamp';
COMMENT ON COLUMN chronicle_sync_state.sync_status IS 'Current sync status: active, error, or initial';
