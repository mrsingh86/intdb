-- ============================================================================
-- Migration 081: Fix Thread Linking with Conflict Detection
--
-- Problem: link_chronicle_to_shipment Priority 1 (thread linking) has ZERO
-- conflict checking. If any email in a Gmail thread links to shipment X,
-- ALL subsequent emails link to X — even with different booking/MBL numbers.
-- This caused shipment 7006150312 to accumulate 284 chronicles (only ~44 genuine).
--
-- Fix: Before thread linking, verify the chronicle's identifiers don't conflict
-- with the candidate shipment. If they do, skip thread linking and fall through
-- to identifier-based linking (Priority 2+).
-- ============================================================================

CREATE OR REPLACE FUNCTION link_chronicle_to_shipment(chronicle_id UUID)
RETURNS TABLE(shipment_id UUID, linked_by TEXT) AS $$
DECLARE
  rec RECORD;
  found_shipment_id UUID;
  link_method TEXT;
  shipment_booking TEXT;
  shipment_mbl TEXT;
BEGIN
  -- Get chronicle record
  SELECT * INTO rec FROM chronicle WHERE id = chronicle_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Priority 1: Thread linking (with conflict detection)
  SELECT c.shipment_id INTO found_shipment_id
  FROM chronicle c
  WHERE c.thread_id = rec.thread_id
    AND c.shipment_id IS NOT NULL
    AND c.id != chronicle_id
  LIMIT 1;

  IF found_shipment_id IS NOT NULL THEN
    -- Verify no identifier conflict before thread linking
    SELECT s.booking_number, s.mbl_number INTO shipment_booking, shipment_mbl
    FROM shipments s WHERE s.id = found_shipment_id;

    -- If chronicle has a DIFFERENT booking or MBL than the shipment, skip thread linking
    IF (rec.booking_number IS NOT NULL AND shipment_booking IS NOT NULL
        AND rec.booking_number != shipment_booking) OR
       (rec.mbl_number IS NOT NULL AND shipment_mbl IS NOT NULL
        AND rec.mbl_number != shipment_mbl) THEN
      -- Conflict detected: fall through to identifier-based linking
      found_shipment_id := NULL;
    ELSE
      link_method := 'thread';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- Priority 2: Booking number
  IF rec.booking_number IS NOT NULL THEN
    SELECT s.id INTO found_shipment_id
    FROM shipments s
    WHERE s.booking_number = rec.booking_number
    LIMIT 1;

    IF found_shipment_id IS NOT NULL THEN
      link_method := 'booking_number';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- Priority 3: MBL number
  IF rec.mbl_number IS NOT NULL THEN
    SELECT s.id INTO found_shipment_id
    FROM shipments s
    WHERE s.mbl_number = rec.mbl_number
    LIMIT 1;

    IF found_shipment_id IS NOT NULL THEN
      link_method := 'mbl_number';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- Priority 4: HBL number (for destination team)
  IF rec.hbl_number IS NOT NULL THEN
    SELECT s.id INTO found_shipment_id
    FROM shipments s
    WHERE s.hbl_number = rec.hbl_number
    LIMIT 1;

    IF found_shipment_id IS NOT NULL THEN
      link_method := 'hbl_number';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- Priority 5: Container linking skipped (shipment_containers table does not exist)

  -- No link found
  RETURN;
END;
$$ LANGUAGE plpgsql;
