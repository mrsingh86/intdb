import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function updateCarrierId() {
  // Get the CMA CGM carrier ID
  const { data: carrier } = await supabase
    .from('carriers')
    .select('id, carrier_name')
    .ilike('carrier_name', '%cma%')
    .single();

  if (!carrier) {
    console.log('CMA CGM carrier not found');
    return;
  }

  console.log('CMA CGM carrier:', carrier.id, carrier.carrier_name);

  // Update shipments with CAD/AMC/CEI/EID prefixes
  const { data: updated, error } = await supabase
    .from('shipments')
    .update({ carrier_id: carrier.id })
    .or('booking_number.ilike.CAD%,booking_number.ilike.AMC%,booking_number.ilike.CEI%,booking_number.ilike.EID%')
    .is('carrier_id', null)
    .select('booking_number');

  if (error) {
    console.log('Error:', error);
    return;
  }

  console.log('Updated shipments:', updated?.length);
  for (const s of updated || []) {
    console.log('  -', s.booking_number);
  }
}

updateCarrierId().catch(console.error);
