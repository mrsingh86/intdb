-- Migration 068: Clean up garbage shipments
-- 3 shipments with invalid booking_numbers cause hundreds of wrong links
-- Found by linking-auditor: "confirmation", "Stuffing", "Cancellation" as booking_number
-- These are document keywords, not actual booking numbers

-- Step 1: Unlink chronicle records from garbage shipments
UPDATE chronicle
SET shipment_id = NULL
WHERE shipment_id IN (
  SELECT id FROM shipments
  WHERE booking_number IN ('confirmation', 'Stuffing', 'Cancellation')
);

-- Step 2: Delete shipment events for garbage shipments
DELETE FROM shipment_events
WHERE shipment_id IN (
  SELECT id FROM shipments
  WHERE booking_number IN ('confirmation', 'Stuffing', 'Cancellation')
);

-- Step 3: Delete AI summaries for garbage shipments
DELETE FROM shipment_ai_summaries
WHERE shipment_id IN (
  SELECT id FROM shipments
  WHERE booking_number IN ('confirmation', 'Stuffing', 'Cancellation')
);

-- Step 4: Delete health records for garbage shipments
DELETE FROM chronicle_shipment_health
WHERE shipment_id IN (
  SELECT id FROM shipments
  WHERE booking_number IN ('confirmation', 'Stuffing', 'Cancellation')
);

-- Step 5: Delete the garbage shipments themselves
DELETE FROM shipments
WHERE booking_number IN ('confirmation', 'Stuffing', 'Cancellation');

-- Step 6: Add booking_number validation constraint to prevent future garbage
-- Booking numbers should be alphanumeric with common separators, min 4 chars
ALTER TABLE shipments
ADD CONSTRAINT chk_booking_number_format
CHECK (
  booking_number IS NULL
  OR (
    length(booking_number) >= 4
    AND booking_number ~ '^[A-Za-z0-9\-_/\.]+$'
  )
);
