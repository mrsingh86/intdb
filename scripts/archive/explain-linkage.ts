import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get document count per shipment
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number');

  console.log('=== EMAILS PER SHIPMENT ===\n');

  let totalDocs = 0;
  const docCounts: number[] = [];

  for (const s of (shipments || []).slice(0, 20)) {
    const { count } = await supabase
      .from('shipment_documents')
      .select('*', { count: 'exact', head: true })
      .eq('shipment_id', s.id);

    docCounts.push(count || 0);
    totalDocs += count || 0;
    console.log(s.booking_number + ': ' + count + ' emails linked');
  }

  console.log('\n... (showing first 20)\n');

  // Get full stats
  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id');

  const shipmentDocCounts = new Map<string, number>();
  for (const d of allDocs || []) {
    shipmentDocCounts.set(d.shipment_id, (shipmentDocCounts.get(d.shipment_id) || 0) + 1);
  }

  const counts = Array.from(shipmentDocCounts.values());
  const avgDocs = counts.reduce((a, b) => a + b, 0) / counts.length;
  const maxDocs = Math.max(...counts);

  console.log('=== SUMMARY ===');
  console.log('Total Shipments:', shipmentDocCounts.size);
  console.log('Total Linked Emails:', allDocs?.length);
  console.log('Avg Emails per Shipment:', avgDocs.toFixed(1));
  console.log('Max Emails on Single Shipment:', maxDocs);

  // Show document types breakdown
  const { data: docTypes } = await supabase
    .from('shipment_documents')
    .select('document_type');

  const typeCounts = new Map<string, number>();
  for (const d of docTypes || []) {
    typeCounts.set(d.document_type, (typeCounts.get(d.document_type) || 0) + 1);
  }

  console.log('\n=== DOCUMENT TYPES LINKED ===');
  for (const [type, count] of Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(type + ': ' + count);
  }
}
main().catch(console.error);
