/**
 * Run migration 081: Fix thread linking with conflict detection
 * Executes the CREATE OR REPLACE FUNCTION via Supabase SQL
 */

import * as dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const migrationSQL = `
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

  -- Priority 5: Container number
  IF array_length(rec.container_numbers, 1) > 0 THEN
    SELECT s.id INTO found_shipment_id
    FROM shipments s
    JOIN shipment_containers sc ON sc.shipment_id = s.id
    WHERE sc.container_number = ANY(rec.container_numbers)
    LIMIT 1;

    IF found_shipment_id IS NOT NULL THEN
      link_method := 'container';
      UPDATE chronicle SET
        shipment_id = found_shipment_id,
        linked_by = link_method,
        linked_at = NOW()
      WHERE id = chronicle_id;
      RETURN QUERY SELECT found_shipment_id, link_method;
      RETURN;
    END IF;
  END IF;

  -- No link found
  RETURN;
END;
$$ LANGUAGE plpgsql;
`;

async function run() {
  console.log('=== Migration 081: Fix thread linking with conflict detection ===\n');

  const { error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

  if (error) {
    // If exec_sql RPC doesn't exist, try via postgrest
    console.log('exec_sql RPC not available, trying direct approach...');

    // Use the Supabase management API or psql fallback
    const response = await fetch(
      `${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY || '',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`,
        },
        body: JSON.stringify({ sql: migrationSQL }),
      }
    );

    if (!response.ok) {
      console.error('Direct approach also failed. Please run the SQL manually:');
      console.error('File: database/migrations/081_fix_thread_linking_conflict_check.sql');
      console.error('Run in Supabase SQL Editor or via psql');
      return;
    }

    console.log('Migration applied successfully via direct API!');
    return;
  }

  console.log('Migration 081 applied successfully!');

  // Verify: test the function exists and has the new signature
  const { data, error: verifyErr } = await supabase.rpc('link_chronicle_to_shipment', {
    chronicle_id: '00000000-0000-0000-0000-000000000000',
  });

  if (verifyErr) {
    // Expected error (record not found) is fine - means function exists
    if (verifyErr.message.includes('not found') || verifyErr.code === 'PGRST') {
      console.log('Function verified: exists and callable');
    } else {
      console.log('Verification note:', verifyErr.message);
    }
  } else {
    console.log('Function verified: exists and callable (returned empty as expected)');
  }
}

run().catch(console.error);
