/**
 * Investigate source of bad ETD dates
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  // Get shipments with wrong ETD (created in 2026 but ETD in 2023-2025)
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, shipper_name, etd, eta, created_at, updated_at')
    .not('status', 'eq', 'cancelled')
    .lt('etd', '2026-01-01')
    .gte('created_at', '2026-01-01')
    .limit(10);

  console.log('=== INVESTIGATING SOURCE OF BAD ETD DATES ===\n');

  for (const s of shipments || []) {
    console.log('━'.repeat(70));
    console.log('SHIPMENT:', s.booking_number || 'no-booking');
    console.log('ID:', s.id);
    console.log('Shipper:', s.shipper_name);
    console.log('ETD:', s.etd, '| ETA:', s.eta);
    console.log('Created:', s.created_at);

    // Check chronicle entries for this shipment to see where dates came from
    const { data: chronicles } = await supabase
      .from('chronicle')
      .select('id, document_type, summary, occurred_at, etd, eta, created_at')
      .eq('shipment_id', s.id)
      .order('created_at', { ascending: true })
      .limit(5);

    console.log('\nCHRONICLE ENTRIES (source of data):');
    for (const c of chronicles || []) {
      console.log(`  - ${c.document_type}: ETD=${c.etd || 'null'} | ${(c.summary || '').slice(0, 60)}`);
    }

    // Check entity_extractions for this shipment
    const { data: extractions } = await supabase
      .from('entity_extractions')
      .select('id, email_id, extracted_data, created_at')
      .eq('shipment_id', s.id)
      .limit(3);

    if (extractions && extractions.length > 0) {
      console.log('\nENTITY EXTRACTIONS:');
      for (const e of extractions) {
        const data = e.extracted_data as Record<string, unknown>;
        console.log(`  - ETD: ${data?.etd || data?.estimated_departure || 'null'} | ETA: ${data?.eta || 'null'}`);
      }
    }
    console.log('');
  }
}

investigate().catch(console.error);
