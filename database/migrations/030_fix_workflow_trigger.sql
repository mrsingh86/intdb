-- ============================================================================
-- MIGRATION 030: Fix Workflow Journey Trigger for NULL handling
-- ============================================================================
-- Purpose: Fix the trigger that logs workflow state changes to handle NULL values
-- ============================================================================

-- Fix the workflow journey trigger to handle NULL values
CREATE OR REPLACE FUNCTION log_workflow_change_to_journey()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_state IS DISTINCT FROM OLD.workflow_state THEN
    INSERT INTO shipment_journey_events (
      shipment_id, event_category, event_type, event_description,
      direction, workflow_state_before, workflow_state_after, occurred_at
    ) VALUES (
      NEW.id, 'workflow', 'state_transition',
      'Workflow state changed from ' || COALESCE(OLD.workflow_state, 'none') || ' to ' || COALESCE(NEW.workflow_state, 'none'),
      'internal', OLD.workflow_state, NEW.workflow_state, NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a helper function to reset workflow states (bypasses trigger)
CREATE OR REPLACE FUNCTION reset_workflow_states()
RETURNS void AS $$
BEGIN
  -- Temporarily disable the trigger
  ALTER TABLE shipments DISABLE TRIGGER trigger_log_workflow_journey;

  -- Reset all workflow states to null
  UPDATE shipments SET workflow_state = NULL;

  -- Re-enable triggers
  ALTER TABLE shipments ENABLE TRIGGER trigger_log_workflow_journey;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
