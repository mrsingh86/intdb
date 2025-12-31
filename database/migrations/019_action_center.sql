-- ============================================================================
-- MIGRATION 019: ACTION CENTER
-- ============================================================================
-- Purpose: Create the command hub for proactive task management with
--          AI-powered priority scoring, insights, and communication execution
-- Author: AI Intelligence System
-- Date: 2025-12-26
-- Dependencies: Migrations 016, 017, 018 (stakeholders, documents, notifications)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- TABLE: task_templates
-- Configuration templates for different task types
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Template identification
  template_code VARCHAR(100) NOT NULL UNIQUE,
  template_name VARCHAR(200) NOT NULL,
  template_description TEXT,

  -- Categorization
  template_category VARCHAR(50) NOT NULL
    CHECK (template_category IN (
      'deadline',       -- Deadline-based tasks (SI submission, VGM, etc.)
      'document',       -- Document-related tasks (review, comparison)
      'notification',   -- Response to notifications (rollovers, holds)
      'compliance',     -- Compliance tasks (customs, certifications)
      'communication',  -- Follow-up communications
      'financial',      -- Payment, invoice tasks
      'operational'     -- General operational tasks
    )),

  -- Title template with placeholders
  default_title_template TEXT NOT NULL,
  -- Example: "Submit SI for {booking_number} - Due {due_date}"

  default_description_template TEXT,

  -- Trigger configuration
  trigger_type VARCHAR(50) NOT NULL
    CHECK (trigger_type IN (
      'deadline_approaching',   -- X days before deadline
      'deadline_passed',        -- Deadline has passed
      'document_received',      -- New document arrived
      'document_missing',       -- Document not received by due date
      'notification_received',  -- Notification needs action
      'milestone_reached',      -- Workflow state changed
      'milestone_missed',       -- Expected milestone not reached
      'manual'                  -- Manually created
    )),

  trigger_conditions JSONB DEFAULT '{}',
  -- Examples:
  -- {"days_before_deadline": 3, "deadline_type": "si_cutoff"}
  -- {"document_type": "si_draft", "workflow_state": "booking_received"}
  -- {"notification_type": "rollover"}

  -- Email template (if task involves communication)
  has_email_template BOOLEAN DEFAULT false,
  email_subject_template TEXT,
  email_body_template TEXT,
  default_recipients JSONB DEFAULT '[]',
  -- Structure: [{"type": "shipper"}, {"type": "consignee"}, {"email": "specific@email.com"}]

  -- Priority configuration
  base_priority VARCHAR(20) DEFAULT 'medium',
  priority_boost_conditions JSONB DEFAULT '{}',
  -- Structure: {"customer_tier_platinum": 20, "deadline_within_24h": 15}

  -- Active flag
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_templates_code ON task_templates(template_code);
CREATE INDEX IF NOT EXISTS idx_task_templates_category ON task_templates(template_category);
CREATE INDEX IF NOT EXISTS idx_task_templates_trigger ON task_templates(trigger_type);

COMMENT ON TABLE task_templates IS 'Configuration templates for auto-generated and manual tasks';
COMMENT ON COLUMN task_templates.default_title_template IS 'Title with {placeholders} for dynamic content';
COMMENT ON COLUMN task_templates.trigger_conditions IS 'Conditions that trigger task creation';

-- ----------------------------------------------------------------------------
-- TABLE: action_tasks
-- Generated tasks in the Action Center
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS action_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Task number for human reference
  task_number SERIAL NOT NULL,  -- TASK-001, TASK-002, etc.

  -- Template reference
  template_id UUID REFERENCES task_templates(id),
  template_code VARCHAR(100),

  -- Linked entities (at least one should be set)
  shipment_id UUID REFERENCES shipments(id),
  notification_id UUID REFERENCES notifications(id),
  document_lifecycle_id UUID REFERENCES document_lifecycle(id),
  stakeholder_id UUID REFERENCES parties(id),

  -- Task details
  title VARCHAR(500) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,

  -- Priority scoring (based on plan algorithm)
  priority VARCHAR(20) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  priority_score INTEGER NOT NULL DEFAULT 50
    CHECK (priority_score >= 0 AND priority_score <= 100),
  priority_factors JSONB DEFAULT '{}',
  -- Structure: {
  --   "deadline_urgency": {"score": 35, "reason": "Due in 2 days"},
  --   "financial_impact": {"score": 20, "reason": "Platinum customer"},
  --   "notification_severity": {"score": 15, "reason": "Rollover notice"},
  --   ...
  -- }

  -- Timeline
  due_date TIMESTAMP WITH TIME ZONE,
  -- urgency_level calculated at query time based on due_date vs NOW()

  -- Assignment
  assigned_to UUID,
  assigned_to_name VARCHAR(200),
  assigned_at TIMESTAMP WITH TIME ZONE,

  -- Status tracking
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',      -- Not yet started
      'in_progress',  -- Being worked on
      'blocked',      -- Waiting on something
      'completed',    -- Successfully finished
      'dismissed',    -- Dismissed/not needed
      'failed'        -- Could not complete
    )),
  status_notes TEXT,

  -- Completion tracking
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID,
  completion_notes TEXT,

  -- Recurrence (for repeat tasks)
  is_recurring BOOLEAN DEFAULT false,
  recurrence_pattern JSONB,
  -- Structure: {"frequency": "per_shipment", "trigger": "booking_received"}

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_number ON action_tasks(task_number);
CREATE INDEX IF NOT EXISTS idx_tasks_shipment ON action_tasks(shipment_id);
CREATE INDEX IF NOT EXISTS idx_tasks_notification ON action_tasks(notification_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON action_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON action_tasks(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON action_tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_pending ON action_tasks(priority_score DESC)
  WHERE status IN ('pending', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON action_tasks(assigned_to)
  WHERE assigned_to IS NOT NULL;

COMMENT ON TABLE action_tasks IS 'Tasks in the Action Center command hub';
COMMENT ON COLUMN action_tasks.task_number IS 'Human-readable task number (TASK-001)';
COMMENT ON COLUMN action_tasks.priority_score IS '0-100 score calculated from weighted factors';
COMMENT ON COLUMN action_tasks.priority_factors IS 'Breakdown of priority score components';

-- ----------------------------------------------------------------------------
-- TABLE: task_insights
-- AI-generated insights explaining why tasks are recommended
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES action_tasks(id) ON DELETE CASCADE,

  -- Insight type
  insight_type VARCHAR(50) NOT NULL
    CHECK (insight_type IN (
      'why_recommended',      -- Why this task is important now
      'risk_assessment',      -- What could go wrong if not addressed
      'historical_pattern',   -- Based on past behavior
      'stakeholder_context',  -- Relevant stakeholder info
      'deadline_impact',      -- Impact of missing deadline
      'financial_impact',     -- Financial consequences
      'suggested_action'      -- Recommended next steps
    )),

  -- Content
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,

  -- Supporting data
  supporting_data JSONB DEFAULT '{}',
  -- Examples:
  -- {"previous_late_shipments": 3, "avg_delay_days": 2}
  -- {"customer_revenue_ytd": 150000, "tier": "platinum"}
  -- {"similar_cases_resolved": 5, "avg_resolution_hours": 4}

  -- Confidence
  confidence_score DECIMAL(5,2),  -- 0-100

  -- Metadata
  generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_insights_task ON task_insights(task_id);
CREATE INDEX IF NOT EXISTS idx_insights_type ON task_insights(insight_type);

COMMENT ON TABLE task_insights IS 'AI-generated insights explaining task recommendations';
COMMENT ON COLUMN task_insights.insight_type IS 'Type of insight provided';
COMMENT ON COLUMN task_insights.supporting_data IS 'Data supporting the insight';

-- ----------------------------------------------------------------------------
-- TABLE: communication_log
-- Track all communications sent through Action Center
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linked entities
  task_id UUID REFERENCES action_tasks(id),
  shipment_id UUID REFERENCES shipments(id),
  notification_id UUID REFERENCES notifications(id),

  -- Communication type
  communication_type VARCHAR(50) NOT NULL DEFAULT 'email'
    CHECK (communication_type IN ('email', 'sms', 'internal_note')),

  -- Recipients
  to_emails TEXT[] NOT NULL,
  cc_emails TEXT[],
  bcc_emails TEXT[],

  -- Content
  subject VARCHAR(500) NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,

  -- AI assistance
  ai_drafted BOOLEAN DEFAULT false,
  ai_draft_prompt TEXT,
  ai_model_used VARCHAR(100),
  human_edited BOOLEAN DEFAULT false,

  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',        -- Being composed
      'queued',       -- Ready to send
      'sent',         -- Sent successfully
      'delivered',    -- Delivery confirmed
      'failed',       -- Send failed
      'bounced'       -- Email bounced
    )),
  status_details TEXT,

  -- Gmail integration
  gmail_message_id VARCHAR(200),
  gmail_thread_id VARCHAR(200),

  -- Response tracking
  response_received BOOLEAN DEFAULT false,
  response_email_id UUID REFERENCES raw_emails(id),
  response_received_at TIMESTAMP WITH TIME ZONE,

  -- Sender
  sent_by UUID,
  sent_by_name VARCHAR(200),
  sent_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_log_task ON communication_log(task_id);
CREATE INDEX IF NOT EXISTS idx_comm_log_shipment ON communication_log(shipment_id);
CREATE INDEX IF NOT EXISTS idx_comm_log_status ON communication_log(status);
CREATE INDEX IF NOT EXISTS idx_comm_log_gmail_thread ON communication_log(gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_comm_log_awaiting_response ON communication_log(sent_at DESC)
  WHERE status = 'sent' AND response_received = false;

COMMENT ON TABLE communication_log IS 'Track all communications sent through Action Center';
COMMENT ON COLUMN communication_log.ai_drafted IS 'Whether content was AI-generated';
COMMENT ON COLUMN communication_log.response_received IS 'Whether a response was received';

-- ----------------------------------------------------------------------------
-- TABLE: task_activity_log
-- Audit trail for all task actions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES action_tasks(id) ON DELETE CASCADE,

  -- Activity details
  activity_type VARCHAR(50) NOT NULL
    CHECK (activity_type IN (
      'created',
      'status_changed',
      'priority_updated',
      'assigned',
      'unassigned',
      'due_date_changed',
      'comment_added',
      'email_sent',
      'insight_generated',
      'escalated',
      'completed',
      'dismissed'
    )),

  -- Change details
  old_value JSONB,
  new_value JSONB,
  change_reason TEXT,

  -- Actor
  performed_by UUID,
  performed_by_name VARCHAR(200),
  is_system_action BOOLEAN DEFAULT false,

  -- Metadata
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity_log(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_type ON task_activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_task_activity_time ON task_activity_log(performed_at DESC);

COMMENT ON TABLE task_activity_log IS 'Complete audit trail of task activities';

-- ----------------------------------------------------------------------------
-- SEED DATA: Task templates
-- ----------------------------------------------------------------------------
INSERT INTO task_templates
  (template_code, template_name, template_category, default_title_template, trigger_type, trigger_conditions, has_email_template, email_subject_template, email_body_template)
VALUES
  -- Deadline tasks
  ('submit_si', 'Submit Shipping Instructions', 'deadline',
   'Submit SI for {booking_number} - {carrier_name}',
   'deadline_approaching',
   '{"days_before_deadline": 3, "deadline_type": "si_cutoff"}'::jsonb,
   true,
   'SI Submission Required - Booking {booking_number}',
   'Dear {shipper_name},\n\nPlease submit the Shipping Instructions for booking {booking_number}.\n\nDeadline: {deadline_date}\nVessel: {vessel_name} v.{voyage_number}\n\nPlease let us know if you have any questions.\n\nBest regards'),

  ('submit_vgm', 'Submit VGM', 'deadline',
   'Submit VGM for {booking_number}',
   'deadline_approaching',
   '{"days_before_deadline": 2, "deadline_type": "vgm_cutoff"}'::jsonb,
   true,
   'VGM Submission Required - Booking {booking_number}',
   'Dear {shipper_name},\n\nPlease submit the Verified Gross Mass (VGM) declaration for booking {booking_number}.\n\nDeadline: {deadline_date}\n\nThis is a mandatory requirement under SOLAS regulations.\n\nBest regards'),

  -- Document tasks
  ('review_si_draft', 'Review SI Draft', 'document',
   'Review SI Draft for {booking_number}',
   'document_received',
   '{"document_type": "si_draft"}'::jsonb,
   false, NULL, NULL),

  ('compare_si_checklist', 'Compare SI vs Checklist', 'document',
   'Verify SI matches Checklist for {booking_number}',
   'document_received',
   '{"source_document": "si_draft", "target_document": "checklist"}'::jsonb,
   false, NULL, NULL),

  -- Notification response tasks
  ('respond_rollover', 'Respond to Rollover Notice', 'notification',
   'URGENT: Rollover for {booking_number} - Action Required',
   'notification_received',
   '{"notification_type": "rollover"}'::jsonb,
   true,
   'RE: Rollover Notice - Booking {booking_number}',
   'Dear Team,\n\nWe have received a rollover notice for booking {booking_number}.\n\nOriginal Vessel: {original_vessel}\nNew Vessel: {new_vessel}\nNew ETD: {new_etd}\n\nPlease confirm if this is acceptable or if we need to explore alternatives.\n\nBest regards'),

  ('respond_customs_hold', 'Address Customs Hold', 'notification',
   'CRITICAL: Customs Hold for {booking_number}',
   'notification_received',
   '{"notification_type": "customs_hold"}'::jsonb,
   true,
   'RE: Customs Hold - {booking_number}',
   'Dear Customs Team,\n\nWe need to address the customs hold for booking {booking_number}.\n\nPlease provide the required documentation or clarification.\n\nBest regards'),

  -- Follow-up tasks
  ('follow_up_pod', 'Follow Up POD', 'communication',
   'Request POD for {booking_number}',
   'milestone_missed',
   '{"expected_milestone": "pod_received", "days_overdue": 3}'::jsonb,
   true,
   'POD Request - Booking {booking_number}',
   'Dear {consignee_name},\n\nWe are following up regarding the Proof of Delivery for booking {booking_number}.\n\nDelivered: {delivery_date}\n\nPlease provide the signed POD at your earliest convenience.\n\nBest regards'),

  ('share_arrival_notice', 'Share Arrival Notice', 'communication',
   'Share Arrival Notice with {consignee_name}',
   'notification_received',
   '{"notification_type": "arrival_notice"}'::jsonb,
   true,
   'Arrival Notice - Booking {booking_number}',
   'Dear {consignee_name},\n\nPlease find attached the Arrival Notice for booking {booking_number}.\n\nVessel: {vessel_name}\nETA: {eta}\nPort of Discharge: {port_of_discharge}\n\nPlease arrange for cargo clearance.\n\nBest regards')
ON CONFLICT (template_code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- FUNCTION: Calculate task priority score
-- Based on plan: deadline_urgency(35), financial_impact(20), notification_severity(15),
--                stakeholder_importance(15), historical_pattern(10), document_criticality(5)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_task_priority_score(
  p_due_date TIMESTAMP WITH TIME ZONE,
  p_customer_tier VARCHAR(20),
  p_notification_type VARCHAR(100),
  p_stakeholder_reliability_score DECIMAL(5,2),
  p_has_past_delays BOOLEAN,
  p_document_is_critical BOOLEAN
) RETURNS TABLE(
  total_score INTEGER,
  priority VARCHAR(20),
  factors JSONB
) AS $$
DECLARE
  deadline_score INTEGER := 0;
  financial_score INTEGER := 0;
  notification_score INTEGER := 0;
  stakeholder_score INTEGER := 0;
  historical_score INTEGER := 0;
  document_score INTEGER := 0;
  total INTEGER;
  deadline_reason TEXT;
  financial_reason TEXT;
  notification_reason TEXT;
  stakeholder_reason TEXT;
  historical_reason TEXT;
  document_reason TEXT;
BEGIN
  -- Deadline urgency (35% weight)
  IF p_due_date IS NOT NULL THEN
    IF p_due_date < NOW() THEN
      deadline_score := 35;
      deadline_reason := 'Overdue';
    ELSIF p_due_date < NOW() + INTERVAL '24 hours' THEN
      deadline_score := 30;
      deadline_reason := 'Due within 24 hours';
    ELSIF p_due_date < NOW() + INTERVAL '48 hours' THEN
      deadline_score := 25;
      deadline_reason := 'Due within 48 hours';
    ELSIF p_due_date < NOW() + INTERVAL '7 days' THEN
      deadline_score := 15;
      deadline_reason := 'Due within 7 days';
    ELSE
      deadline_score := 5;
      deadline_reason := 'Due later';
    END IF;
  ELSE
    deadline_reason := 'No deadline set';
  END IF;

  -- Financial impact (20% weight)
  financial_score := CASE p_customer_tier
    WHEN 'platinum' THEN 20
    WHEN 'gold' THEN 15
    WHEN 'silver' THEN 10
    WHEN 'bronze' THEN 5
    ELSE 5
  END;
  financial_reason := COALESCE(p_customer_tier || ' customer', 'Standard customer');

  -- Notification severity (15% weight)
  notification_score := CASE p_notification_type
    WHEN 'rollover' THEN 15
    WHEN 'customs_hold' THEN 15
    WHEN 'vessel_omission' THEN 15
    WHEN 'cargo_cutoff' THEN 12
    WHEN 'vessel_delay' THEN 10
    WHEN 'equipment_shortage' THEN 8
    ELSE 0
  END;
  notification_reason := CASE
    WHEN notification_score >= 12 THEN 'Critical notification'
    WHEN notification_score >= 8 THEN 'Important notification'
    ELSE 'Standard notification'
  END;

  -- Stakeholder importance (15% weight)
  IF p_stakeholder_reliability_score IS NOT NULL THEN
    IF p_stakeholder_reliability_score >= 90 THEN
      stakeholder_score := 15;
      stakeholder_reason := 'Highly reliable stakeholder';
    ELSIF p_stakeholder_reliability_score >= 70 THEN
      stakeholder_score := 10;
      stakeholder_reason := 'Good reliability';
    ELSE
      stakeholder_score := 5;
      stakeholder_reason := 'Below average reliability';
    END IF;
  ELSE
    stakeholder_score := 7;
    stakeholder_reason := 'Unknown reliability';
  END IF;

  -- Historical pattern (10% weight)
  IF p_has_past_delays = true THEN
    historical_score := 10;
    historical_reason := 'History of delays';
  ELSE
    historical_score := 0;
    historical_reason := 'No delay history';
  END IF;

  -- Document criticality (5% weight)
  IF p_document_is_critical = true THEN
    document_score := 5;
    document_reason := 'Critical document';
  ELSE
    document_score := 0;
    document_reason := 'Standard document';
  END IF;

  -- Calculate total
  total := deadline_score + financial_score + notification_score +
           stakeholder_score + historical_score + document_score;

  -- Return results
  RETURN QUERY SELECT
    total,
    CASE
      WHEN total >= 85 THEN 'critical'::VARCHAR(20)
      WHEN total >= 70 THEN 'high'::VARCHAR(20)
      WHEN total >= 50 THEN 'medium'::VARCHAR(20)
      ELSE 'low'::VARCHAR(20)
    END,
    jsonb_build_object(
      'deadline_urgency', jsonb_build_object('score', deadline_score, 'max', 35, 'reason', deadline_reason),
      'financial_impact', jsonb_build_object('score', financial_score, 'max', 20, 'reason', financial_reason),
      'notification_severity', jsonb_build_object('score', notification_score, 'max', 15, 'reason', notification_reason),
      'stakeholder_importance', jsonb_build_object('score', stakeholder_score, 'max', 15, 'reason', stakeholder_reason),
      'historical_pattern', jsonb_build_object('score', historical_score, 'max', 10, 'reason', historical_reason),
      'document_criticality', jsonb_build_object('score', document_score, 'max', 5, 'reason', document_reason)
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION calculate_task_priority_score IS 'Calculate task priority using weighted factors from plan';

-- ----------------------------------------------------------------------------
-- FUNCTION: Generate task number formatted
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION format_task_number(task_number INTEGER)
RETURNS TEXT AS $$
BEGIN
  RETURN 'TASK-' || LPAD(task_number::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ----------------------------------------------------------------------------
-- FUNCTION: Update action_tasks timestamp
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_action_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_action_tasks_updated
  BEFORE UPDATE ON action_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_action_tasks_timestamp();

CREATE TRIGGER trigger_task_templates_updated
  BEFORE UPDATE ON task_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_action_tasks_timestamp();

CREATE TRIGGER trigger_communication_log_updated
  BEFORE UPDATE ON communication_log
  FOR EACH ROW
  EXECUTE FUNCTION update_action_tasks_timestamp();

-- ----------------------------------------------------------------------------
-- VIEW: Active tasks with priority
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_active_tasks AS
SELECT
  t.id,
  format_task_number(t.task_number) as task_number,
  t.title,
  t.category,
  t.priority,
  t.priority_score,
  t.priority_factors,
  t.due_date,
  CASE
    WHEN t.due_date IS NULL THEN 'no_deadline'
    WHEN t.due_date < NOW() THEN 'overdue'
    WHEN t.due_date < NOW() + INTERVAL '4 hours' THEN 'immediate'
    WHEN t.due_date < NOW() + INTERVAL '24 hours' THEN 'today'
    WHEN t.due_date < NOW() + INTERVAL '7 days' THEN 'this_week'
    ELSE 'later'
  END as urgency_level,
  t.status,
  t.assigned_to_name,
  t.created_at,
  s.booking_number,
  s.vessel_name,
  c.carrier_name
FROM action_tasks t
LEFT JOIN shipments s ON t.shipment_id = s.id
LEFT JOIN carriers c ON s.carrier_id = c.id
WHERE t.status IN ('pending', 'in_progress', 'blocked')
ORDER BY t.priority_score DESC, t.due_date ASC NULLS LAST;

COMMENT ON VIEW v_active_tasks IS 'Active tasks ordered by priority for Action Center';

-- ----------------------------------------------------------------------------
-- GRANT PERMISSIONS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON task_templates TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON action_tasks TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_insights TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON communication_log TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON task_activity_log TO anon, authenticated, service_role;
GRANT SELECT ON v_active_tasks TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE action_tasks_task_number_seq TO anon, authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION 019
-- ============================================================================
