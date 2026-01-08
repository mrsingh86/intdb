import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const shipmentId = 'b61c9149-8b3c-4ca7-aced-f89761e6430d';

  // Get all docs
  const { data: allDocs } = await supabase.from('shipment_documents').select('shipment_id');
  const shipmentWithDocs = new Set((allDocs || []).map(d => d.shipment_id));

  console.log('Is 263042012 (ID: ' + shipmentId + ') in Set:', shipmentWithDocs.has(shipmentId));
  console.log('Total shipments with docs:', shipmentWithDocs.size);

  // Get all shipments and filter
  const { data: allShipments } = await supabase.from('shipments').select('id, booking_number');
  const noDocShipments = (allShipments || []).filter(s => shipmentWithDocs.has(s.id) === false);

  console.log('');
  console.log('Shipments without docs:', noDocShipments.length);

  // Is 263042012 in the no-doc list?
  const found = noDocShipments.find(s => s.booking_number === '263042012');
  console.log('263042012 in no-doc list:', found ? 'YES' : 'NO');

  // Show first 5 orphans
  console.log('\nFirst 5 actual orphans:');
  for (const s of noDocShipments.slice(0, 5)) {
    const { count } = await supabase
      .from('shipment_documents')
      .select('*', { count: 'exact', head: true })
      .eq('shipment_id', s.id);
    console.log('  ' + s.booking_number + ': ' + count + ' docs');
  }
}

main().catch(console.error);
