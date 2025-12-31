-- ============================================================================
-- MIGRATION 018: NOTIFICATION MANAGEMENT
-- ============================================================================
-- Purpose: Classify and manage notifications from carriers and stakeholders
--          (deadline advisories, rate changes, vessel delays, rollovers, etc.)
-- Author: AI Intelligence System
-- Date: 2025-12-26
-- Dependencies: Migration 004 (shipments, raw_emails)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: notification_type_configs
-- Configuration for different notification types
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_type_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Type identification
  notification_type VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(200) NOT NULL,
  description TEXT,

  -- Category for grouping
  category VARCHAR(50) NOT NULL
    CHECK (category IN (
      'deadline',     -- SI cutoff, VGM cutoff, documentation deadlines
      'rate',         -- Rate changes, surcharges
      'vessel',       -- Delays, rollovers, schedule changes
      'operational',  -- Port congestion, equipment availability
      'customs',      -- Holds, inspections, clearance issues
      'carrier',      -- Amendments, confirmations, acknowledgments
      'financial',    -- Payment reminders, invoice notifications
      'general'       -- Other notifications
    )),

  -- Detection patterns
  subject_patterns TEXT[],        -- Keywords/patterns to match in subject
  body_keywords TEXT[],           -- Keywords to find in body
  sender_patterns TEXT[],         -- Sender email patterns

  -- Priority configuration
  default_priority VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (default_priority IN ('critical', 'high', 'medium', 'low')),
  default_urgency_hours INTEGER DEFAULT 24,  -- Hours until action needed

  -- Task generation
  auto_generate_task BOOLEAN DEFAULT true,
  task_template_code VARCHAR(100),  -- Reference to task_templates

  -- Active flag
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_type_category ON notification_type_configs(category);
CREATE INDEX IF NOT EXISTS idx_notification_type_active ON notification_type_configs(is_active);

COMMENT ON TABLE notification_type_configs IS 'Configuration for notification types and detection';
COMMENT ON COLUMN notification_type_configs.subject_patterns IS 'Patterns to match in email subjects';
COMMENT ON COLUMN notification_type_configs.auto_generate_task IS 'Whether to auto-create task when detected';

-- ----------------------------------------------------------------------------
-- TABLE: notifications
-- Classified notifications from emails
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source
  email_id UUID NOT NULL REFERENCES raw_emails(id),
  sender_email VARCHAR(255),
  sender_name VARCHAR(500),

  -- Classification
  notification_type VARCHAR(100) REFERENCES notification_type_configs(notification_type),
  classification_confidence DECIMAL(5,2),  -- 0-100

  -- Linked entities
  shipment_id UUID REFERENCES shipments(id),
  carrier_id UUID REFERENCES carriers(id),
  party_id UUID REFERENCES parties(id),

  -- Content
  title VARCHAR(500) NOT NULL,
  summary TEXT,
  original_subject VARCHAR(500),

  -- Extracted data (type-specific)
  extracted_data JSONB DEFAULT '{}',
  -- Examples:
  -- Deadline: {"cutoff_type": "SI", "cutoff_date": "2025-01-15", "booking_number": "..."}
  -- Rollover: {"original_vessel": "...", "new_vessel": "...", "new_etd": "..."}
  -- Rate change: {"old_rate": 1500, "new_rate": 1800, "effective_date": "..."}

  -- Priority
  priority VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  urgency_score INTEGER CHECK (urgency_score >= 0 AND urgency_score <= 100),

  -- Deadline (if applicable)
  deadline_date TIMESTAMP WITH TIME ZONE,
  -- is_deadline_passed calculated at query time: deadline_date < NOW()

  -- Status tracking
  status VARCHAR(50) NOT NULL DEFAULT 'unread'
    CHECK (status IN (
      'unread',       -- Not yet seen
      'read',         -- Viewed but not acted upon
      'acknowledged', -- Team member acknowledged
      'actioned',     -- Action taken
      'dismissed'     -- Dismissed/not relevant
    )),
  status_changed_at TIMESTAMP WITH TIME ZONE,
  status_changed_by UUID,

  -- Metadata
  received_at TIMESTAMP WITH TIME ZONE NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(email_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_shipment ON notifications(shipment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(received_at DESC)
  WHERE status = 'unread';
CREATE INDEX IF NOT EXISTS idx_notifications_deadline ON notifications(deadline_date)
  WHERE deadline_date IS NOT NULL AND status NOT IN ('actioned', 'dismissed');

COMMENT ON TABLE notifications IS 'Classified notifications extracted from emails';
COMMENT ON COLUMN notifications.extracted_data IS 'Type-specific extracted data as JSON';
COMMENT ON COLUMN notifications.urgency_score IS 'Calculated urgency 0-100 (higher = more urgent)';

-- ----------------------------------------------------------------------------
-- TABLE: notification_actions
-- Track actions taken on notifications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,

  -- Action details
  action_type VARCHAR(50) NOT NULL
    CHECK (action_type IN (
      'acknowledged',
      'task_created',
      'email_sent',
      'escalated',
      'resolved',
      'dismissed',
      'commented'
    )),

  -- Actor
  performed_by UUID,
  performed_by_name VARCHAR(200),

  -- Details
  action_details JSONB DEFAULT '{}',
  notes TEXT,

  -- Related entities
  related_task_id UUID,       -- If task_created
  related_email_id UUID,      -- If email_sent

  -- Metadata
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_actions_notification ON notification_actions(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_actions_type ON notification_actions(action_type);

COMMENT ON TABLE notification_actions IS 'Audit trail of actions taken on notifications';

-- ----------------------------------------------------------------------------
-- SEED DATA: Notification type configurations
-- ----------------------------------------------------------------------------
INSERT INTO notification_type_configs
  (notification_type, display_name, category, subject_patterns, body_keywords, default_priority, default_urgency_hours, auto_generate_task)
VALUES
  -- Deadline notifications
  ('si_cutoff', 'SI Cutoff Reminder', 'deadline',
   ARRAY['SI CUT', 'SHIPPING INSTRUCTION', 'SI DEADLINE', 'DOCUMENTATION CUTOFF'],
   ARRAY['shipping instruction', 'SI cutoff', 'submit SI'],
   'high', 24, true),

  ('vgm_cutoff', 'VGM Cutoff Reminder', 'deadline',
   ARRAY['VGM CUT', 'VGM DEADLINE', 'VERIFIED GROSS MASS'],
   ARRAY['VGM', 'verified gross mass', 'weight declaration'],
   'high', 24, true),

  ('cargo_cutoff', 'Cargo Cutoff Advisory', 'deadline',
   ARRAY['CARGO CUT', 'CY CUTOFF', 'GATE CLOSE'],
   ARRAY['cargo cutoff', 'gate closing', 'CY closing'],
   'critical', 12, true),

  -- Vessel notifications
  ('vessel_delay', 'Vessel Delay Notice', 'vessel',
   ARRAY['DELAY', 'DELAYED', 'SCHEDULE CHANGE', 'REVISED ETA'],
   ARRAY['delay', 'delayed', 'revised schedule', 'new ETA'],
   'high', 48, true),

  ('rollover', 'Rollover Notice', 'vessel',
   ARRAY['ROLLOVER', 'ROLLED', 'ROLLED OVER', 'CARGO ROLL'],
   ARRAY['rollover', 'rolled over', 'bumped', 'next vessel'],
   'critical', 4, true),

  ('vessel_omission', 'Port Omission Notice', 'vessel',
   ARRAY['OMISSION', 'PORT SKIP', 'PORT OMIT'],
   ARRAY['omission', 'skip port', 'will not call'],
   'critical', 4, true),

  -- Operational notifications
  ('port_congestion', 'Port Congestion Advisory', 'operational',
   ARRAY['CONGESTION', 'PORT DELAY', 'TERMINAL DELAY'],
   ARRAY['congestion', 'terminal congestion', 'delays expected'],
   'medium', 72, true),

  ('equipment_shortage', 'Equipment Shortage', 'operational',
   ARRAY['EQUIPMENT', 'CONTAINER SHORTAGE', 'NO EQUIPMENT'],
   ARRAY['equipment shortage', 'no containers', 'container availability'],
   'high', 48, true),

  -- Customs notifications
  ('customs_hold', 'Customs Hold Notice', 'customs',
   ARRAY['CUSTOMS HOLD', 'HELD BY CUSTOMS', 'CUSTOMS EXAMINATION'],
   ARRAY['customs hold', 'examination', 'customs inspection', 'held'],
   'critical', 2, true),

  ('customs_clearance', 'Customs Clearance Complete', 'customs',
   ARRAY['CLEARED', 'CUSTOMS RELEASE', 'RELEASED BY CUSTOMS'],
   ARRAY['customs cleared', 'released', 'clearance complete'],
   'low', 168, false),

  -- Rate notifications
  ('rate_increase', 'Rate Increase Notice', 'rate',
   ARRAY['RATE INCREASE', 'RATE CHANGE', 'NEW RATES', 'SURCHARGE'],
   ARRAY['rate increase', 'new rates', 'effective', 'surcharge'],
   'medium', 168, true),

  ('rate_restoration', 'Rate Restoration', 'rate',
   ARRAY['RATE RESTORATION', 'GRI', 'GENERAL RATE INCREASE'],
   ARRAY['rate restoration', 'GRI', 'general rate increase'],
   'medium', 168, true),

  -- Carrier notifications
  ('booking_amendment', 'Booking Amendment Confirmation', 'carrier',
   ARRAY['AMENDMENT', 'AMENDED', 'REVISED BOOKING', 'UPDATE'],
   ARRAY['amendment confirmed', 'booking revised', 'changes confirmed'],
   'low', 168, false),

  ('arrival_notice', 'Arrival Notice', 'carrier',
   ARRAY['ARRIVAL NOTICE', 'VESSEL ARRIVED', 'CARGO ARRIVAL'],
   ARRAY['arrival notice', 'cargo available', 'vessel arrived'],
   'medium', 48, true),

  ('delivery_order', 'Delivery Order Ready', 'carrier',
   ARRAY['DELIVERY ORDER', 'D/O READY', 'DO AVAILABLE'],
   ARRAY['delivery order', 'D/O', 'pickup available'],
   'high', 24, true),

  -- Financial notifications
  ('payment_reminder', 'Payment Reminder', 'financial',
   ARRAY['PAYMENT', 'INVOICE', 'OUTSTANDING', 'OVERDUE'],
   ARRAY['payment due', 'invoice', 'outstanding balance'],
   'medium', 72, true),

  ('detention_alert', 'Detention/Demurrage Alert', 'financial',
   ARRAY['DETENTION', 'DEMURRAGE', 'FREE TIME', 'STORAGE'],
   ARRAY['detention', 'demurrage', 'free time expiring', 'storage charges'],
   'high', 24, true)
ON CONFLICT (notification_type) DO NOTHING;

-- ----------------------------------------------------------------------------
-- FUNCTION: Calculate notification urgency score
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_notification_urgency(
  p_priority VARCHAR(20),
  p_deadline_date TIMESTAMP WITH TIME ZONE,
  p_notification_type VARCHAR(100)
) RETURNS INTEGER AS $$
DECLARE
  base_score INTEGER;
  deadline_factor INTEGER := 0;
  type_factor INTEGER := 0;
BEGIN
  -- Base score from priority
  base_score := CASE p_priority
    WHEN 'critical' THEN 80
    WHEN 'high' THEN 60
    WHEN 'medium' THEN 40
    WHEN 'low' THEN 20
    ELSE 30
  END;

  -- Deadline factor
  IF p_deadline_date IS NOT NULL THEN
    IF p_deadline_date < NOW() THEN
      deadline_factor := 20;  -- Already overdue
    ELSIF p_deadline_date < NOW() + INTERVAL '24 hours' THEN
      deadline_factor := 15;  -- Due within 24h
    ELSIF p_deadline_date < NOW() + INTERVAL '48 hours' THEN
      deadline_factor := 10;  -- Due within 48h
    ELSIF p_deadline_date < NOW() + INTERVAL '7 days' THEN
      deadline_factor := 5;   -- Due within week
    END IF;
  END IF;

  -- Type factor for critical types
  IF p_notification_type IN ('rollover', 'customs_hold', 'vessel_omission', 'cargo_cutoff') THEN
    type_factor := 10;
  END IF;

  RETURN LEAST(base_score + deadline_factor + type_factor, 100);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_notification_urgency IS 'Calculate urgency score 0-100 based on priority, deadline, and type';

-- ----------------------------------------------------------------------------
-- FUNCTION: Update notification timestamp
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_notification_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_notification_type_updated
  BEFORE UPDATE ON notification_type_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_timestamp();

-- ----------------------------------------------------------------------------
-- GRANT PERMISSIONS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_type_configs TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_actions TO anon, authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION 018
-- ============================================================================
