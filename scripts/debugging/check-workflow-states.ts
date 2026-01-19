import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, created_at')
    .order('created_at', { ascending: false });

  // Count by state
  const stateCounts: Record<string, number> = {};
  const nullOrMissing: any[] = [];

  for (const s of shipments || []) {
    const state = s.workflow_state || 'NULL';
    stateCounts[state] = (stateCounts[state] || 0) + 1;

    if (!s.workflow_state) {
      nullOrMissing.push({ id: s.id, booking: s.booking_number, created: s.created_at?.substring(0, 10) });
    }
  }

  console.log('=== WORKFLOW STATE DISTRIBUTION ===\n');
  Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => {
      console.log('  ' + count.toString().padStart(4) + '  ' + state);
    });

  console.log('\n=== SHIPMENTS WITH NULL WORKFLOW_STATE ===\n');
  nullOrMissing.slice(0, 20).forEach(s => {
    console.log('  ' + s.booking + ' (created: ' + s.created + ')');
  });

  if (nullOrMissing.length > 20) {
    console.log('  ... and ' + (nullOrMissing.length - 20) + ' more');
  }

  console.log('\nTotal with NULL state: ' + nullOrMissing.length + ' / ' + (shipments?.length || 0));
}

run();
