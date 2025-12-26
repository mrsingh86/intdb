-- ============================================================================
-- MIGRATION 020: ADD IDEMPOTENCY CONSTRAINTS
-- ============================================================================
-- Purpose: Add UNIQUE constraints for idempotent operations
--          Critical for preventing duplicate records during cron job runs
-- Author: AI Intelligence System
-- Date: 2025-12-26
-- Dependencies: Migration 016, 017, 018
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CONSTRAINT: Unique email_id in notifications
-- Prevents duplicate notifications for same email
-- ----------------------------------------------------------------------------
ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_email_id_key;

ALTER TABLE notifications
ADD CONSTRAINT notifications_email_id_key UNIQUE (email_id);

COMMENT ON CONSTRAINT notifications_email_id_key ON notifications IS
  'Prevents duplicate notifications from same email (idempotency)';

-- ----------------------------------------------------------------------------
-- CONSTRAINT: Unique email_id in stakeholder_extraction_queue
-- Prevents duplicate extraction queue entries for same email
-- ----------------------------------------------------------------------------
ALTER TABLE stakeholder_extraction_queue
DROP CONSTRAINT IF EXISTS stakeholder_extraction_queue_email_id_key;

ALTER TABLE stakeholder_extraction_queue
ADD CONSTRAINT stakeholder_extraction_queue_email_id_key UNIQUE (email_id);

COMMENT ON CONSTRAINT stakeholder_extraction_queue_email_id_key ON stakeholder_extraction_queue IS
  'Prevents duplicate extraction entries for same email (idempotency)';

-- ----------------------------------------------------------------------------
-- CONSTRAINT: Unique shipment_id + document_type in document_lifecycle
-- Already defined in migration 017, verify it exists
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_lifecycle_shipment_document_unique'
  ) THEN
    ALTER TABLE document_lifecycle
    ADD CONSTRAINT document_lifecycle_shipment_document_unique
    UNIQUE (shipment_id, document_type);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- INDEX: Optimize notification lookups by email_id
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_email_id ON notifications(email_id);

-- ----------------------------------------------------------------------------
-- INDEX: Optimize stakeholder extraction queue lookups
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stakeholder_extraction_email
  ON stakeholder_extraction_queue(email_id);

-- ----------------------------------------------------------------------------
-- INDEX: Composite index for document lifecycle queries by shipment+status
-- Optimizes: "show all pending documents for shipment X"
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_shipment_status
  ON document_lifecycle(shipment_id, lifecycle_status);

-- ----------------------------------------------------------------------------
-- INDEX: Partial index for overdue notifications by deadline+priority
-- Optimizes: "show critical overdue notifications"
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_overdue_critical
  ON notifications(deadline_date, priority)
  WHERE deadline_date IS NOT NULL
    AND status NOT IN ('actioned', 'dismissed');

-- ----------------------------------------------------------------------------
-- CONSTRAINT: Ensure action_tasks have at least one linked entity
-- Prevents orphan tasks with no context
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'check_task_has_entity'
  ) THEN
    ALTER TABLE action_tasks
    ADD CONSTRAINT check_task_has_entity
    CHECK (
      shipment_id IS NOT NULL OR
      notification_id IS NOT NULL OR
      document_lifecycle_id IS NOT NULL OR
      stakeholder_id IS NOT NULL
    );
  END IF;
EXCEPTION WHEN undefined_column THEN
  -- Skip if columns don't exist yet
  NULL;
END $$;

-- ============================================================================
-- END OF MIGRATION 020
-- ============================================================================
