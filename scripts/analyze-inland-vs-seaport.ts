import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get ALL shipments with their port and inland location fields
  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number, place_of_receipt, port_of_loading, port_of_loading_code, place_of_delivery, port_of_discharge, port_of_discharge_code');

  console.log('═'.repeat(80));
  console.log('INLAND vs SEAPORT ANALYSIS');
  console.log('═'.repeat(80));

  // Known inland indicators (not seaports)
  const inlandIndicators = ['icd', 'terminal', 'depot', 'cfs', 'warehouse', 'ludhiana', 'gurgaon', 'patli', 'garhi', 'delhi', 'chicago', 'fort worth', 'toronto'];

  // Known seaport names
  const seaportNames = ['mundra', 'pipavav', 'nhava sheva', 'jnpt', 'chennai', 'hazira', 'kolkata', 'cochin', 'newark', 'houston', 'savannah', 'norfolk', 'los angeles', 'long beach', 'tampa', 'vancouver', 'montreal'];

  const issues: any[] = [];
  let withInland = 0;
  let withoutInland = 0;

  for (const s of shipments || []) {
    const hasInland = s.place_of_receipt || s.place_of_delivery;
    if (hasInland) withInland++;
    else withoutInland++;

    // Check if POL looks like inland (should be seaport)
    const polLower = (s.port_of_loading || '').toLowerCase();
    const podLower = (s.port_of_discharge || '').toLowerCase();

    const polIsSeaport = seaportNames.some(port => polLower.includes(port));
    const podIsSeaport = seaportNames.some(port => podLower.includes(port));

    const polLooksInland = inlandIndicators.some(ind => polLower.includes(ind)) && !polIsSeaport;
    const podLooksInland = inlandIndicators.some(ind => podLower.includes(ind)) && !podIsSeaport;

    // Check missing port codes
    const missingPolCode = s.port_of_loading && !s.port_of_loading_code;
    const missingPodCode = s.port_of_discharge && !s.port_of_discharge_code;

    if (polLooksInland || podLooksInland || missingPolCode || missingPodCode) {
      issues.push({
        booking: s.booking_number,
        por: s.place_of_receipt || '-',
        pol: s.port_of_loading || '-',
        polCode: s.port_of_loading_code || 'MISSING',
        pod: s.port_of_discharge || '-',
        podCode: s.port_of_discharge_code || 'MISSING',
        pod_inland: s.place_of_delivery || '-',
        issue: [
          polLooksInland ? 'POL_LOOKS_INLAND' : '',
          podLooksInland ? 'POD_LOOKS_INLAND' : '',
          missingPolCode ? 'MISSING_POL_CODE' : '',
          missingPodCode ? 'MISSING_POD_CODE' : ''
        ].filter(Boolean).join(', ')
      });
    }
  }

  console.log(`\nSummary: ${withInland} shipments with inland locations, ${withoutInland} without\n`);

  if (issues.length > 0) {
    console.log(`\n⚠️ ISSUES FOUND (${issues.length}):\n`);
    for (const i of issues) {
      console.log(`${i.booking}:`);
      console.log(`  Place of Receipt: ${i.por}`);
      console.log(`  POL: ${i.pol} (${i.polCode})`);
      console.log(`  Place of Delivery: ${i.pod_inland}`);
      console.log(`  POD: ${i.pod} (${i.podCode})`);
      console.log(`  Issue: ${i.issue}`);
      console.log();
    }
  } else {
    console.log('✅ No issues found - all POL/POD appear to be seaports');
  }
}

main().catch(console.error);
