-- ============================================================================
-- MIGRATION 027: ADD DATABASE CONSTRAINTS
-- ============================================================================
-- Purpose: Add data integrity constraints for shipments table
-- Author: AI Pipeline Implementation
-- Date: 2025-12-31
-- Dependencies: Migration 004 (Shipment Schema)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CONSTRAINT 1: Unique booking number per carrier
-- Prevents duplicate bookings from the same carrier
-- Creates a UNIQUE partial index (allows NULL booking numbers)
-- ----------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS idx_shipments_booking_carrier
ON shipments(booking_number, carrier_id)
WHERE booking_number IS NOT NULL;

COMMENT ON INDEX idx_shipments_booking_carrier IS 'Ensures unique booking number per carrier';

-- ----------------------------------------------------------------------------
-- CONSTRAINT 2: ETD must be before or equal to ETA
-- Departure cannot happen after arrival
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_etd_before_eta'
  ) THEN
    ALTER TABLE shipments
    ADD CONSTRAINT check_etd_before_eta
    CHECK (etd IS NULL OR eta IS NULL OR etd <= eta);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- NOTE: Cutoff vs ETD constraint NOT added as database constraint
-- Reason: Historical data has cutoffs after ETD due to schedule updates
-- Business logic should validate new cutoffs, not database constraint
-- ----------------------------------------------------------------------------

-- ============================================================================
-- END OF MIGRATION 027
-- ============================================================================
