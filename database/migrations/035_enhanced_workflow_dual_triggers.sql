-- Migration: 035_enhanced_workflow_dual_triggers.sql
-- Description: Adds columns for dual-trigger workflow state management
--              Supports email type triggers alongside document type triggers
--              Enables parallel workflow tracking (origin/destination)
--
-- This migration enables:
-- 1. Email type tracking in workflow history (approval_granted, stuffing_update, etc.)
-- 2. Sender category tracking (who triggered the transition)
-- 3. Trigger type tracking (document, email, or both)
-- 4. Parallel workflow states (origin/destination tracks)

-- =============================================================================
-- PART 1: Enhance shipment_workflow_history table
-- =============================================================================

-- Add email_type column to track which email type triggered the transition
ALTER TABLE shipment_workflow_history
ADD COLUMN IF NOT EXISTS email_type VARCHAR(50);

COMMENT ON COLUMN shipment_workflow_history.email_type IS
  'Email type that triggered transition (e.g., approval_granted, stuffing_update, departure_update)';

-- Add sender_category column to track who triggered the transition
ALTER TABLE shipment_workflow_history
ADD COLUMN IF NOT EXISTS sender_category VARCHAR(30);

COMMENT ON COLUMN shipment_workflow_history.sender_category IS
  'Category of sender who triggered transition (e.g., carrier, cha_india, customs_broker_us, shipper)';

-- Add trigger_type column to indicate what triggered the transition
ALTER TABLE shipment_workflow_history
ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(20);

COMMENT ON COLUMN shipment_workflow_history.trigger_type IS
  'What triggered the transition: document, email, or both';

-- Add email_direction column (may already exist from migration 032)
ALTER TABLE shipment_workflow_history
ADD COLUMN IF NOT EXISTS email_direction VARCHAR(10);

COMMENT ON COLUMN shipment_workflow_history.email_direction IS
  'Direction of email that triggered transition: inbound or outbound';

-- Add constraint for trigger_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shipment_workflow_history_trigger_type_check'
  ) THEN
    ALTER TABLE shipment_workflow_history
    ADD CONSTRAINT shipment_workflow_history_trigger_type_check
    CHECK (trigger_type IS NULL OR trigger_type IN ('document', 'email', 'both'));
  END IF;
END $$;

-- Add constraint for email_direction
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shipment_workflow_history_direction_check'
  ) THEN
    ALTER TABLE shipment_workflow_history
    ADD CONSTRAINT shipment_workflow_history_direction_check
    CHECK (email_direction IS NULL OR email_direction IN ('inbound', 'outbound'));
  END IF;
END $$;

-- =============================================================================
-- PART 2: Add parallel workflow tracking to shipments table
-- =============================================================================

-- Origin workflow state (India side: stuffing, gate_in, handover)
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS origin_workflow_state VARCHAR(50);

COMMENT ON COLUMN shipments.origin_workflow_state IS
  'Parallel origin workflow state (stuffing_complete, gate_in_complete, handover_complete)';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS origin_workflow_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN shipments.origin_workflow_updated_at IS
  'When origin workflow state was last updated';

-- Destination workflow state (US side: clearance, delivery)
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS destination_workflow_state VARCHAR(50);

COMMENT ON COLUMN shipments.destination_workflow_state IS
  'Parallel destination workflow state (clearance_started, customs_cleared, delivery_scheduled)';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS destination_workflow_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN shipments.destination_workflow_updated_at IS
  'When destination workflow state was last updated';

-- =============================================================================
-- PART 3: Create workflow_state_definitions table (database-driven config)
-- =============================================================================

CREATE TABLE IF NOT EXISTS workflow_state_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- State identification
  state_code VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  state_order INTEGER NOT NULL,
  phase VARCHAR(20) NOT NULL,

  -- Trigger configuration (stored as JSON for flexibility)
  document_types TEXT[],
  email_types TEXT[],
  email_subject_patterns TEXT[],
  allowed_directions TEXT[] NOT NULL DEFAULT ARRAY['inbound', 'outbound'],
  allowed_sender_categories TEXT[],

  -- Validation
  prerequisites TEXT[],
  is_parallel BOOLEAN DEFAULT FALSE,

  -- Metadata
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  CONSTRAINT workflow_state_definitions_phase_check
    CHECK (phase IN ('pre_departure', 'in_transit', 'arrival', 'delivery'))
);

COMMENT ON TABLE workflow_state_definitions IS
  'Database-driven workflow state definitions with dual-trigger support';

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_workflow_state_defs_phase
  ON workflow_state_definitions(phase);
CREATE INDEX IF NOT EXISTS idx_workflow_state_defs_order
  ON workflow_state_definitions(state_order);

-- =============================================================================
-- PART 4: Indexes for workflow history queries
-- =============================================================================

-- Index for querying by email type
CREATE INDEX IF NOT EXISTS idx_workflow_history_email_type
  ON shipment_workflow_history(email_type)
  WHERE email_type IS NOT NULL;

-- Index for querying by sender category
CREATE INDEX IF NOT EXISTS idx_workflow_history_sender_category
  ON shipment_workflow_history(sender_category)
  WHERE sender_category IS NOT NULL;

-- Index for querying by trigger type
CREATE INDEX IF NOT EXISTS idx_workflow_history_trigger_type
  ON shipment_workflow_history(trigger_type)
  WHERE trigger_type IS NOT NULL;

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_workflow_history_shipment_created
  ON shipment_workflow_history(shipment_id, created_at DESC);

-- =============================================================================
-- PART 5: Update trigger for updated_at on workflow_state_definitions
-- =============================================================================

CREATE OR REPLACE FUNCTION update_workflow_state_definitions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_workflow_state_definitions_updated_at
  ON workflow_state_definitions;

CREATE TRIGGER trigger_workflow_state_definitions_updated_at
  BEFORE UPDATE ON workflow_state_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_workflow_state_definitions_updated_at();

-- =============================================================================
-- PART 6: Seed initial workflow state definitions (optional - can be done later)
-- =============================================================================

-- NOTE: The actual state definitions are in TypeScript (workflow-transition-rules.ts)
-- This table can be populated via a script if we want database-driven config
-- For now, we just create the structure

-- Example of how to insert (commented out, run via script if needed):
/*
INSERT INTO workflow_state_definitions (state_code, label, state_order, phase, document_types, email_types, allowed_directions, allowed_sender_categories, prerequisites, description)
VALUES
  ('booking_confirmed', 'Booking Confirmed', 10, 'pre_departure',
   ARRAY['booking_confirmation'], NULL, ARRAY['inbound'], ARRAY['carrier'],
   NULL, 'Carrier confirms booking - creates shipment'),
  ('stuffing_complete', 'Stuffing Complete', 25, 'pre_departure',
   NULL, ARRAY['stuffing_update'], ARRAY['inbound'], ARRAY['cha_india', 'shipper'],
   ARRAY['stuffing_started'], 'Container stuffing completed at factory')
ON CONFLICT (state_code) DO NOTHING;
*/

-- =============================================================================
-- Migration complete
-- =============================================================================

COMMENT ON TABLE shipment_workflow_history IS
  'Workflow state transition history with enhanced tracking for email type triggers, sender category, and direction';
