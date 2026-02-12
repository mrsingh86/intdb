-- ============================================================================
-- Fix Phone-Number Shipments
--
-- ROOT CAUSE: extractBookingNumber regex \b(\d{9,10})\b matches Indian phone
-- numbers in email signatures (e.g. "Ph: +91 8810432530", "Mobile: 7006150312").
-- This creates fake shipments, then thread-linking cascades contamination.
--
-- STRATEGY:
-- 1. Identify confirmed phone-number shipments
-- 2. Unlink all chronicles from fake shipments
-- 3. Clean stored booking_number (NULL out the phone number)
-- 4. Re-run link_chronicle_to_shipment for each orphan
-- 5. Delete empty fake shipments
-- ============================================================================

-- Step 1: Identify phone-number shipments
-- Create temp table of confirmed phone-number bookings
CREATE TEMP TABLE phone_shipments AS
SELECT DISTINCT s.id AS shipment_id, s.booking_number
FROM shipments s
JOIN chronicle c ON c.shipment_id = s.id
WHERE s.booking_number ~ '^\d{10}$'
  AND (c.body_preview LIKE '%Ph%' || s.booking_number || '%'
    OR c.body_preview LIKE '%Mobile%' || s.booking_number || '%'
    OR c.body_preview LIKE '%Tel%' || s.booking_number || '%');

SELECT 'Phone-number shipments found: ' || COUNT(*) FROM phone_shipments;
SELECT booking_number FROM phone_shipments ORDER BY booking_number;

-- Step 2: Count chronicles that will be affected
SELECT 'Total chronicles to unlink: ' || COUNT(*)
FROM chronicle c
JOIN phone_shipments ps ON c.shipment_id = ps.shipment_id;

-- Step 3: Unlink all chronicles from phone-number shipments
-- Save the IDs first for re-linking
CREATE TEMP TABLE orphaned_chronicles AS
SELECT c.id, c.booking_number, ps.booking_number AS phone_number
FROM chronicle c
JOIN phone_shipments ps ON c.shipment_id = ps.shipment_id;

SELECT 'Orphaned chronicles saved: ' || COUNT(*) FROM orphaned_chronicles;

-- Unlink
UPDATE chronicle c
SET shipment_id = NULL, linked_by = NULL, linked_at = NULL
FROM phone_shipments ps
WHERE c.shipment_id = ps.shipment_id;

SELECT 'Chronicles unlinked: ' || COUNT(*)
FROM orphaned_chronicles;

-- Step 4: Clean stored booking_number where it equals the phone number
UPDATE chronicle c
SET booking_number = NULL
FROM orphaned_chronicles oc
WHERE c.id = oc.id AND c.booking_number = oc.phone_number;

SELECT 'Booking numbers cleaned (phone→NULL): ' || COUNT(*)
FROM orphaned_chronicles oc
WHERE oc.booking_number = oc.phone_number;

-- Step 5: Re-link each orphaned chronicle via RPC
-- This must be done one at a time (RPC call per record)
DO $$
DECLARE
  rec RECORD;
  relinked INTEGER := 0;
  orphaned INTEGER := 0;
  result RECORD;
BEGIN
  FOR rec IN SELECT id FROM orphaned_chronicles LOOP
    -- Call the linking function
    SELECT * INTO result FROM link_chronicle_to_shipment(rec.id);
    IF result.shipment_id IS NOT NULL THEN
      relinked := relinked + 1;
    ELSE
      orphaned := orphaned + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Re-linked: %, Remained orphaned: %', relinked, orphaned;
END $$;

-- Step 6: Delete phone-number shipments that now have 0 chronicles
DELETE FROM shipments s
USING phone_shipments ps
WHERE s.id = ps.shipment_id
  AND NOT EXISTS (
    SELECT 1 FROM chronicle c WHERE c.shipment_id = s.id
  );

SELECT 'Fake shipments deleted: ' || COUNT(*)
FROM phone_shipments ps
WHERE NOT EXISTS (
  SELECT 1 FROM shipments s WHERE s.id = ps.shipment_id
);

-- Step 7: Verification
SELECT 'Remaining phone-number shipments with chronicles:' AS check;
SELECT s.booking_number, COUNT(c.id) AS chronicles
FROM shipments s
JOIN phone_shipments ps ON s.id = ps.shipment_id
JOIN chronicle c ON c.shipment_id = s.id
GROUP BY s.booking_number
ORDER BY COUNT(c.id) DESC;

-- Check mega-shipments after cleanup
SELECT 'Mega-shipments (>50 chronicles) after cleanup:' AS check;
SELECT s.booking_number, COUNT(*) AS chronicles
FROM chronicle c
JOIN shipments s ON c.shipment_id = s.id
GROUP BY s.id, s.booking_number
HAVING COUNT(*) > 50
ORDER BY COUNT(*) DESC
LIMIT 20;

-- Cleanup temp tables
DROP TABLE IF EXISTS phone_shipments;
DROP TABLE IF EXISTS orphaned_chronicles;
