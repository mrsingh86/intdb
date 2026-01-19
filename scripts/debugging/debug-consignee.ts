import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Check consignee_profiles table structure
  console.log('Checking consignee_profiles table...\n');

  // Try to insert a test profile
  const testProfile = {
    consignee_name: 'TEST CONSIGNEE',
    consignee_name_normalized: 'test consignee',
    total_shipments: 5,
    shipments_last_90_days: 2,
    detention_rate: 10,
    demurrage_rate: 5,
    customs_issue_rate: 0,
    risk_score: 10,
    risk_factors: ['test'],
    computed_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('consignee_profiles')
    .upsert(testProfile, { onConflict: 'consignee_name_normalized' })
    .select();

  if (error) {
    console.log('ERROR inserting:', error);
  } else {
    console.log('SUCCESS:', data);
  }

  // Check what's in the table
  const { data: profiles, error: selectError } = await supabase
    .from('consignee_profiles')
    .select('*')
    .limit(5);

  if (selectError) {
    console.log('\nSELECT ERROR:', selectError);
  } else {
    console.log('\nProfiles in table:', profiles?.length);
    profiles?.forEach(p => console.log('  -', p.consignee_name));
  }

  // Clean up test
  await supabase.from('consignee_profiles').delete().eq('consignee_name', 'TEST CONSIGNEE');
}

main().catch(console.error);
