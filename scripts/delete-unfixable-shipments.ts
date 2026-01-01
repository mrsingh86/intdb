import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const bookings = ['263805268', 'CEI0329155'];

  console.log('═'.repeat(70));
  console.log('DELETING UNFIXABLE SHIPMENTS');
  console.log('═'.repeat(70));

  for (const bn of bookings) {
    console.log(`\nDeleting ${bn}...`);

    const { error } = await supabase
      .from('shipments')
      .delete()
      .eq('booking_number', bn);

    if (error) {
      console.log(`  ❌ ${error.message}`);
    } else {
      console.log(`  ✅ Deleted`);
    }
  }

  // Verify count
  const { count } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log(`\nTotal shipments now: ${count}`);
}

main().catch(console.error);
