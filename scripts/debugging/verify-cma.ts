import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get all shipments with carrier info
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) { console.error('Error:', error); return; }

  console.log('Recent Shipments:\n');

  for (const s of shipments || []) {
    const date = s.created_at ? s.created_at.split('T')[0] : 'unknown';
    console.log('- ' + s.booking_number + ' (carrier: ' + s.carrier_id + ') - Created: ' + date);
  }

  // Total shipment count
  const { count } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log('\n---');
  console.log('Total shipments in system:', count);
}
main().catch(console.error);
