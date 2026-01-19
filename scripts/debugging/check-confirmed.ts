import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Count confirmed vs unconfirmed
  const { count: confirmedCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('is_direct_carrier_confirmed', true);

  const { count: unconfirmedCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('is_direct_carrier_confirmed', false);

  const { count: nullCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('is_direct_carrier_confirmed', null);

  console.log('=== is_direct_carrier_confirmed breakdown ===\n');
  console.log('TRUE (confirmed):', confirmedCount);
  console.log('FALSE:', unconfirmedCount);
  console.log('NULL:', nullCount);
  console.log('---');
  console.log('Total:', (confirmedCount || 0) + (unconfirmedCount || 0) + (nullCount || 0));

  // Show some unconfirmed ones
  const { data: unconfirmed } = await supabase
    .from('shipments')
    .select('booking_number, is_direct_carrier_confirmed, created_at')
    .or('is_direct_carrier_confirmed.eq.false,is_direct_carrier_confirmed.is.null')
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('\nRecent UNCONFIRMED shipments:');
  for (const s of unconfirmed || []) {
    console.log('  ' + s.booking_number + ' - confirmed: ' + s.is_direct_carrier_confirmed);
  }
}
main().catch(console.error);
