import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Raw count
  const { count, error } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Total shipments in database:', count);

  // By confirmation status
  const { count: confirmed } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('is_direct_carrier_confirmed', true);

  const { count: notConfirmed } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .neq('is_direct_carrier_confirmed', true);

  console.log('Confirmed (true):', confirmed);
  console.log('Not confirmed (!true):', notConfirmed);

  // Check if there are any pending booking confirmations
  const { count: pendingBCs } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('processing_status', 'pending')
    .ilike('subject', '%Booking Confirmation%');

  console.log('\nPending booking confirmation emails:', pendingBCs);
}
main().catch(console.error);
