-- =============================================================================
-- Migration 055: Bot Request Logs
-- =============================================================================
-- Creates table for logging WhatsApp/Telegram bot interactions
-- Used for analytics, debugging, and audit trail
-- =============================================================================

-- Bot request logs table
CREATE TABLE IF NOT EXISTS bot_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Request details
  message TEXT NOT NULL,
  sender VARCHAR(50),
  channel VARCHAR(20) DEFAULT 'unknown',
  session_key VARCHAR(100),

  -- Response details
  response_success BOOLEAN NOT NULL,
  response_preview TEXT,  -- First 500 chars of response

  -- Performance
  processing_time_ms INTEGER,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON bot_request_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_logs_sender ON bot_request_logs(sender) WHERE sender IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bot_logs_channel ON bot_request_logs(channel);

-- Comments
COMMENT ON TABLE bot_request_logs IS 'Logs all bot command requests and responses for analytics and debugging';
COMMENT ON COLUMN bot_request_logs.message IS 'The raw command/message received from user';
COMMENT ON COLUMN bot_request_logs.sender IS 'Phone number or user ID (may be anonymized)';
COMMENT ON COLUMN bot_request_logs.channel IS 'whatsapp, telegram, slack, discord, etc.';
COMMENT ON COLUMN bot_request_logs.session_key IS 'Optional session identifier for multi-turn conversations';
COMMENT ON COLUMN bot_request_logs.response_preview IS 'First 500 characters of the bot response';
COMMENT ON COLUMN bot_request_logs.processing_time_ms IS 'Time taken to process the command in milliseconds';

-- =============================================================================
-- Bot notification logs (for proactive alerts sent)
-- =============================================================================

CREATE TABLE IF NOT EXISTS bot_notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Notification details
  alert_type VARCHAR(50) NOT NULL,
  booking_number VARCHAR(50),
  container_number VARCHAR(20),
  message_preview TEXT,

  -- Delivery details
  channel VARCHAR(20) DEFAULT 'whatsapp',
  recipient VARCHAR(100),

  -- Status
  success BOOLEAN NOT NULL,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bot_notifications_created_at ON bot_notification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_notifications_alert_type ON bot_notification_logs(alert_type);
CREATE INDEX IF NOT EXISTS idx_bot_notifications_booking ON bot_notification_logs(booking_number) WHERE booking_number IS NOT NULL;

-- Comments
COMMENT ON TABLE bot_notification_logs IS 'Logs proactive notifications sent via the bot (alerts, daily summaries, etc.)';
COMMENT ON COLUMN bot_notification_logs.alert_type IS 'Type of alert: overdue_action, eta_change, document_received, etc.';
