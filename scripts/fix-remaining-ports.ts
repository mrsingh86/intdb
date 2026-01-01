import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Specific fixes for remaining issues
const SPECIFIC_FIXES: Record<string, {
  port_of_loading?: string;
  port_of_loading_code?: string;
  port_of_discharge?: string;
  port_of_discharge_code?: string;
  place_of_delivery?: string;
}> = {
  // POD has terminal name - normalize to port
  '34864426': {
    port_of_discharge: 'Newark',
    port_of_discharge_code: 'USEWR',
    // Keep existing place_of_delivery
  },
  '31232060': {
    port_of_discharge: 'Newark',
    port_of_discharge_code: 'USEWR',
  },
  '24926645': {
    port_of_discharge: 'Newark',
    port_of_discharge_code: 'USEWR',
  },
  '17232103': {
    port_of_discharge: 'Newark',
    port_of_discharge_code: 'USEWR',
  },
  '22781146': {
    port_of_discharge: 'Charleston',
    port_of_discharge_code: 'USCHS',
  },
  '25823956': {
    port_of_discharge: 'Baltimore',
    port_of_discharge_code: 'USBAL',
  },
  // POL is just code, needs name
  '14089549': {
    port_of_loading: 'Mundra',
    port_of_loading_code: 'INMUN',
    port_of_discharge: 'New York',
    port_of_discharge_code: 'USNYC',
  },
  'CAD0845144': {
    port_of_loading: 'Mundra',
    port_of_loading_code: 'INMUN',
    port_of_discharge: 'Norfolk',
    port_of_discharge_code: 'USORF',
  },
  'EID0918049': {
    port_of_loading: 'Mundra',
    port_of_loading_code: 'INMUN',
  },
  // Missing POD code
  'QCAD051513': {
    port_of_discharge: 'Savannah',
    port_of_discharge_code: 'USSAV',
  },
};

async function main() {
  console.log('═'.repeat(80));
  console.log('FIXING REMAINING PORT ISSUES');
  console.log('═'.repeat(80));

  let fixedCount = 0;

  for (const [bookingNumber, updates] of Object.entries(SPECIFIC_FIXES)) {
    const { error } = await supabase
      .from('shipments')
      .update(updates)
      .eq('booking_number', bookingNumber);

    if (error) {
      console.log(`❌ ${bookingNumber}: ${error.message}`);
    } else {
      console.log(`✅ ${bookingNumber}: Updated`);
      Object.entries(updates).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
      fixedCount++;
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`SUMMARY: Fixed ${fixedCount} shipments`);
}

main().catch(console.error);
