import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Total shipments (raw count)
  const { count: totalCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log('Total shipments in database:', totalCount);

  // Check by status
  const { data: statusCounts } = await supabase
    .from('shipments')
    .select('status');

  const statusMap = new Map<string, number>();
  for (const s of statusCounts || []) {
    statusMap.set(s.status || 'null', (statusMap.get(s.status || 'null') || 0) + 1);
  }

  console.log('\nBy status:');
  for (const [status, count] of statusMap) {
    console.log('  ' + status + ': ' + count);
  }

  // Check if there's a deleted_at or is_deleted column
  const { data: sample } = await supabase
    .from('shipments')
    .select('*')
    .limit(1);

  if (sample && sample[0]) {
    const columns = Object.keys(sample[0]);
    console.log('\nShipment columns:', columns.join(', '));
    
    // Check for soft delete columns
    if (columns.includes('deleted_at')) {
      const { count: notDeleted } = await supabase
        .from('shipments')
        .select('*', { count: 'exact', head: true })
        .is('deleted_at', null);
      console.log('\nNot deleted (deleted_at IS NULL):', notDeleted);
    }
    if (columns.includes('is_deleted')) {
      const { count: notDeleted } = await supabase
        .from('shipments')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false);
      console.log('\nNot deleted (is_deleted = false):', notDeleted);
    }
  }

  // Check created_at range
  const { data: dateRange } = await supabase
    .from('shipments')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1);

  const { data: latestDate } = await supabase
    .from('shipments')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1);

  console.log('\nDate range:');
  console.log('  Oldest:', dateRange?.[0]?.created_at);
  console.log('  Newest:', latestDate?.[0]?.created_at);
}
main().catch(console.error);
