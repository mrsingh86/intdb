import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function listShipments() {
  const { data, error } = await supabase
    .from('shipments')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.log('Error:', error);
    return;
  }

  console.log('=== ALL SHIPMENTS ===');
  console.log('Total:', data.length);

  // Print columns first
  if (data.length > 0) {
    console.log('Columns:', Object.keys(data[0]).join(', '));
  }

  const byCarrier: Record<string, number> = {};

  for (const s of data) {
    const carrier = s.carrier_id || s.carrier || 'unknown';
    byCarrier[carrier] = (byCarrier[carrier] || 0) + 1;
    const origin = s.origin_port || s.pol || 'N/A';
    const dest = s.destination_port || s.pod || 'N/A';
    const etd = s.etd || 'N/A';
    console.log(`${s.booking_number} | ${carrier} | ${origin} -> ${dest} | ETD: ${etd}`);
  }

  console.log('\n=== BY CARRIER ===');
  for (const [carrier, count] of Object.entries(byCarrier)) {
    console.log(`${carrier}: ${count}`);
  }
}

listShipments().catch(console.error);
