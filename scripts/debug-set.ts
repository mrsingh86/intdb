import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const targetId = 'b61c9149-8b3c-4ca7-aced-f89761e6430d';

  // Get document for this shipment directly
  const { data: directDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id')
    .eq('shipment_id', targetId);

  console.log('Direct query for shipment:', directDocs);

  // Get ALL docs
  const { data: allDocs, count } = await supabase
    .from('shipment_documents')
    .select('shipment_id', { count: 'exact' });

  console.log('Total documents:', count);
  console.log('Returned docs:', allDocs?.length);

  // Check if target ID is in returned docs
  const found = (allDocs || []).find(d => d.shipment_id === targetId);
  console.log('Target ID in allDocs:', found ? 'YES' : 'NO');

  // Maybe pagination issue - get with range
  const { data: allDocs2 } = await supabase
    .from('shipment_documents')
    .select('shipment_id')
    .range(0, 5000);

  console.log('With range 0-5000:', allDocs2?.length);
  const found2 = (allDocs2 || []).find(d => d.shipment_id === targetId);
  console.log('Target ID in range query:', found2 ? 'YES' : 'NO');
}

main().catch(console.error);
