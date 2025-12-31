/**
 * Fix Shipment Visibility
 *
 * Sets is_direct_carrier_confirmed=true on all shipments created from
 * direct carrier booking confirmations so they appear in the dashboard.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fixShipmentVisibility() {
  console.log('='.repeat(60));
  console.log('FIXING SHIPMENT VISIBILITY');
  console.log('='.repeat(60));

  // Get current counts
  const { count: totalCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const { count: confirmedCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('is_direct_carrier_confirmed', true);

  console.log(`\nCurrent state:`);
  console.log(`  Total shipments: ${totalCount}`);
  console.log(`  With is_direct_carrier_confirmed=true: ${confirmedCount}`);
  console.log(`  Hidden from dashboard: ${(totalCount || 0) - (confirmedCount || 0)}`);

  // Update all shipments with a booking_number to be confirmed
  // These are all from direct carrier emails
  const { data, error } = await supabase
    .from('shipments')
    .update({ is_direct_carrier_confirmed: true })
    .not('booking_number', 'is', null)
    .select('id');

  if (error) {
    console.error('\nError updating shipments:', error.message);
    return;
  }

  console.log(`\nUpdated ${data?.length || 0} shipments to is_direct_carrier_confirmed=true`);

  // Verify final counts
  const { count: newConfirmedCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('is_direct_carrier_confirmed', true);

  console.log(`\nFinal state:`);
  console.log(`  Total shipments: ${totalCount}`);
  console.log(`  With is_direct_carrier_confirmed=true: ${newConfirmedCount}`);
  console.log(`\n✅ All shipments should now be visible in the dashboard!`);
}

fixShipmentVisibility().catch(console.error);
