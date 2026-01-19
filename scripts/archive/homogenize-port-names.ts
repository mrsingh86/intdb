import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Normalization rules: old value -> { name, code }
const POL_NORMALIZATION: Record<string, { name: string; code: string }> = {
  'INNSA': { name: 'Nhava Sheva', code: 'INNSA' },
  'ind': { name: 'Nhava Sheva', code: 'INNSA' }, // Assuming India port
};

const POD_NORMALIZATION: Record<string, { name: string; code: string }> = {
  'NORFOLK, VA': { name: 'Norfolk', code: 'USORF' },
  'NORFOLK, VA NORFOLK INTL TERM\'L': { name: 'Norfolk', code: 'USORF' },
  'NEW YORK, NY': { name: 'New York', code: 'USNYC' },
  'USNYC': { name: 'New York', code: 'USNYC' },
  'Houston (Bay Port)': { name: 'Houston', code: 'USHOU' },
  'SAVANNAH, GA': { name: 'Savannah', code: 'USSAV' },
  'NEW ORLEANS, LA': { name: 'New Orleans', code: 'USMSY' },
  'pricing': { name: 'Unknown', code: '' }, // Invalid - will be flagged
};

async function main() {
  console.log('═'.repeat(80));
  console.log('HOMOGENIZING PORT NAMES');
  console.log('═'.repeat(80));

  let fixedCount = 0;

  // Fix POL
  for (const [oldValue, norm] of Object.entries(POL_NORMALIZATION)) {
    const { data, error } = await supabase
      .from('shipments')
      .update({ port_of_loading: norm.name, port_of_loading_code: norm.code })
      .eq('port_of_loading', oldValue)
      .select('booking_number');

    if (data && data.length > 0) {
      console.log(`POL: "${oldValue}" → "${norm.name}" (${data.length} shipments)`);
      fixedCount += data.length;
    }
  }

  // Fix POD
  for (const [oldValue, norm] of Object.entries(POD_NORMALIZATION)) {
    const { data, error } = await supabase
      .from('shipments')
      .update({ port_of_discharge: norm.name, port_of_discharge_code: norm.code })
      .eq('port_of_discharge', oldValue)
      .select('booking_number');

    if (data && data.length > 0) {
      console.log(`POD: "${oldValue}" → "${norm.name}" (${data.length} shipments)`);
      fixedCount += data.length;
    }
  }

  // Verify results
  console.log('\n' + '═'.repeat(80));
  console.log('VERIFICATION - Unique Port Names:');
  console.log('═'.repeat(80));

  const { data: shipments } = await supabase
    .from('shipments')
    .select('port_of_loading, port_of_discharge');

  const polNames = new Map<string, number>();
  const podNames = new Map<string, number>();

  for (const s of shipments || []) {
    const pol = s.port_of_loading || 'null';
    const pod = s.port_of_discharge || 'null';
    polNames.set(pol, (polNames.get(pol) || 0) + 1);
    podNames.set(pod, (podNames.get(pod) || 0) + 1);
  }

  console.log('\nPOL:');
  [...polNames.entries()].sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    console.log(`  ${name}: ${count}`);
  });

  console.log('\nPOD:');
  [...podNames.entries()].sort((a, b) => b[1] - a[1]).forEach(([name, count]) => {
    console.log(`  ${name}: ${count}`);
  });

  console.log(`\nTotal fixed: ${fixedCount} shipments`);
}

main().catch(console.error);
