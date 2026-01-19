import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // Check shipment statuses
  const { data: shipments, error: shipErr } = await supabase
    .from('shipments')
    .select('id, status, booking_number, intoglo_reference');

  if (shipErr) {
    console.error('Error:', shipErr);
    return;
  }

  const counts: Record<string, number> = {};
  for (const row of shipments || []) {
    counts[row.status || 'null'] = (counts[row.status || 'null'] || 0) + 1;
  }

  console.log('='.repeat(60));
  console.log('SHIPMENT STATUS DISTRIBUTION');
  console.log('='.repeat(60));
  console.log('Total shipments:', shipments?.length || 0);
  console.log('\nBy status:');
  for (const [status, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${count}`);
  }

  // Show some delivered examples if any
  const delivered = (shipments || []).filter(s =>
    s.status?.toLowerCase().includes('deliver') ||
    s.status === 'DELIVERED' ||
    s.status === 'delivered'
  );

  if (delivered.length > 0) {
    console.log('\nDelivered shipments:');
    for (const s of delivered.slice(0, 5)) {
      console.log(`  - ${s.intoglo_reference || s.booking_number} (status: ${s.status})`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
