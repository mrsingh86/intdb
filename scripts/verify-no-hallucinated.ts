import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Check for any remaining hallucinated dates
  const { data: hallucinated } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff')
    .or('etd.lt.2024-01-01,eta.lt.2024-01-01,si_cutoff.lt.2024-01-01,vgm_cutoff.lt.2024-01-01,cargo_cutoff.lt.2024-01-01,gate_cutoff.lt.2024-01-01');

  if (!hallucinated || hallucinated.length === 0) {
    console.log('✅ No hallucinated dates remaining in database');
  } else {
    console.log(`⚠️ Found ${hallucinated.length} shipments with pre-2024 dates:`);
    for (const s of hallucinated) {
      console.log(`  - ${s.booking_number}`);
    }
  }

  // Check the two fixed shipments
  console.log('\nVerifying fixed shipments:');
  for (const bn of ['CAD0850107', '263805268']) {
    const { data: s } = await supabase
      .from('shipments')
      .select('booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff')
      .eq('booking_number', bn)
      .single();

    console.log(`  ${bn}:`);
    console.log(`    ETD: ${s?.etd ?? 'null'}, ETA: ${s?.eta ?? 'null'}`);
    console.log(`    SI: ${s?.si_cutoff ?? 'null'}, VGM: ${s?.vgm_cutoff ?? 'null'}`);
  }
}

main().catch(console.error);
