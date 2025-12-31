-- ============================================================================
-- MIGRATION 008: ADD CUTOFF DATE COLUMNS TO SHIPMENTS
-- ============================================================================
-- Purpose: Store SI, VGM, Cargo, and Gate cutoff dates on shipments
-- ============================================================================

-- Add cutoff date columns
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS si_cutoff TIMESTAMP WITH TIME ZONE;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS vgm_cutoff TIMESTAMP WITH TIME ZONE;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS cargo_cutoff TIMESTAMP WITH TIME ZONE;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS gate_cutoff TIMESTAMP WITH TIME ZONE;

-- Comments for documentation
COMMENT ON COLUMN shipments.si_cutoff IS 'Shipping Instruction submission deadline';
COMMENT ON COLUMN shipments.vgm_cutoff IS 'Verified Gross Mass submission deadline';
COMMENT ON COLUMN shipments.cargo_cutoff IS 'Cargo/CY cutoff - last time to deliver cargo to terminal';
COMMENT ON COLUMN shipments.gate_cutoff IS 'Gate-in cutoff - last time for container gate-in';

-- ============================================================================
-- END MIGRATION 008
-- ============================================================================
