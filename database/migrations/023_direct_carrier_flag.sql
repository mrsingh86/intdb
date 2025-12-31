-- Migration 023: Add direct carrier confirmation flag
--
-- Purpose: Store whether a shipment was created from a DIRECT CARRIER
-- booking confirmation (single source of truth)
--
-- "Real shipments" = shipments where is_direct_carrier_confirmed = true

-- Add the flag column
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS is_direct_carrier_confirmed BOOLEAN DEFAULT false;

-- Add index for filtering
CREATE INDEX IF NOT EXISTS idx_shipments_direct_carrier
ON shipments(is_direct_carrier_confirmed)
WHERE is_direct_carrier_confirmed = true;

-- Comment for documentation
COMMENT ON COLUMN shipments.is_direct_carrier_confirmed IS
'True if this shipment has a booking confirmation from a DIRECT carrier domain (maersk.com, hapag-lloyd.com, etc) detected via true_sender_email';
