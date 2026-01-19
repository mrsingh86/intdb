import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // Count total chronicle records
  const { count: totalChronicle } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true });

  // Count linked to shipments
  const { count: linkedCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true })
    .not('shipment_id', 'is', null);

  // Count shipments
  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  // Document type distribution (paginated)
  let allDocs: any[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('chronicle')
      .select('document_type')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allDocs = allDocs.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  const docCounts: Record<string, number> = {};
  for (const d of allDocs) {
    docCounts[d.document_type] = (docCounts[d.document_type] || 0) + 1;
  }

  // From party distribution (paginated)
  let allParties: any[] = [];
  offset = 0;
  while (true) {
    const { data } = await supabase
      .from('chronicle')
      .select('from_party')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    allParties = allParties.concat(data);
    offset += 1000;
    if (data.length < 1000) break;
  }

  const partyCounts: Record<string, number> = {};
  for (const p of allParties) {
    partyCounts[p.from_party] = (partyCounts[p.from_party] || 0) + 1;
  }

  // Date range
  const { data: earliest } = await supabase
    .from('chronicle')
    .select('occurred_at')
    .order('occurred_at', { ascending: true })
    .limit(1);

  const { data: latest } = await supabase
    .from('chronicle')
    .select('occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(1);

  // Actions and issues
  const { count: actionCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true })
    .eq('has_action', true);

  const { count: issueCount } = await supabase
    .from('chronicle')
    .select('*', { count: 'exact', head: true })
    .eq('has_issue', true);

  console.log('='.repeat(60));
  console.log('CHRONICLE RESULTS SO FAR');
  console.log('='.repeat(60));
  console.log(`Total chronicle records: ${totalChronicle}`);
  console.log(`Linked to shipments: ${linkedCount}`);
  console.log(`Total shipments: ${shipmentCount}`);
  console.log(`Link rate: ${((linkedCount || 0) / (totalChronicle || 1) * 100).toFixed(1)}%`);
  console.log(`\nWith actions needed: ${actionCount}`);
  console.log(`With issues flagged: ${issueCount}`);

  if (earliest?.[0] && latest?.[0]) {
    console.log('\nDate range:');
    console.log(`  From: ${earliest[0].occurred_at?.split('T')[0]}`);
    console.log(`  To: ${latest[0].occurred_at?.split('T')[0]}`);
  }

  console.log('\nBy Document Type:');
  const sortedDocs = Object.entries(docCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedDocs.slice(0, 15)) {
    console.log(`  ${type}: ${count}`);
  }

  console.log('\nBy Sender Party:');
  const sortedParties = Object.entries(partyCounts).sort((a, b) => b[1] - a[1]);
  for (const [party, count] of sortedParties) {
    console.log(`  ${party}: ${count}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
