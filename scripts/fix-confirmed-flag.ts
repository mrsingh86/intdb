import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Update all unconfirmed shipments to confirmed
  const { data, error } = await supabase
    .from('shipments')
    .update({ is_direct_carrier_confirmed: true })
    .eq('is_direct_carrier_confirmed', false)
    .select('booking_number');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Updated', data?.length, 'shipments to is_direct_carrier_confirmed = true');
  
  for (const s of data || []) {
    console.log('  - ' + s.booking_number);
  }

  // Verify
  const { count } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('is_direct_carrier_confirmed', true);

  console.log('\nTotal confirmed shipments now:', count);
}
main().catch(console.error);
