import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Find shipments with duplicate document types
  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select('id, shipment_id, document_type, email_id, created_at');

  // Group by shipment_id + document_type
  const groups: Record<string, Array<{ id: string; emailId: string; createdAt: string }>> = {};
  for (const d of allDocs || []) {
    const key = d.shipment_id + '|' + d.document_type;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ id: d.id, emailId: d.email_id, createdAt: d.created_at });
  }

  // Find duplicates (more than 1 of same doc type per shipment)
  const duplicateGroups = Object.entries(groups).filter(([_, docs]) => docs.length > 1);

  console.log('DUPLICATE DOCUMENT ANALYSIS');
  console.log('='.repeat(60));
  console.log('Total shipment-doctype combos:', Object.keys(groups).length);
  console.log('Combos with duplicates:', duplicateGroups.length);

  let totalDuplicateDocs = 0;
  const idsToRemove: string[] = [];

  for (const [key, docs] of duplicateGroups) {
    // Sort by created_at, keep the first one
    docs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const toRemove = docs.slice(1); // All except first
    totalDuplicateDocs += toRemove.length;
    idsToRemove.push(...toRemove.map(d => d.id));
  }

  console.log('Total duplicate documents to remove:', totalDuplicateDocs);
  console.log('');

  // Show worst offenders
  console.log('WORST OFFENDERS (most duplicates):');
  const sorted = duplicateGroups.sort((a, b) => b[1].length - a[1].length).slice(0, 15);

  for (const [key, docs] of sorted) {
    const [shipmentId, docType] = key.split('|');

    // Get booking number
    const { data: ship } = await supabase
      .from('shipments')
      .select('booking_number')
      .eq('id', shipmentId)
      .single();

    console.log(`  ${(ship?.booking_number || shipmentId.slice(0,8)).padEnd(20)} | ${docType.padEnd(25)} | ${docs.length} copies (${docs.length - 1} to remove)`);
  }

  // Breakdown by document type
  console.log('');
  console.log('DUPLICATES BY DOCUMENT TYPE:');
  const byType: Record<string, number> = {};
  for (const [key, docs] of duplicateGroups) {
    const docType = key.split('|')[1];
    byType[docType] = (byType[docType] || 0) + (docs.length - 1);
  }

  const sortedByType = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  for (const [docType, count] of sortedByType) {
    console.log(`  ${docType.padEnd(30)} | ${count} duplicates`);
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('RECOMMENDATION: Run backfill to remove', totalDuplicateDocs, 'duplicate documents');

  // Output IDs for potential deletion
  if (process.argv.includes('--output-ids')) {
    console.log('');
    console.log('IDs to remove (first 50):');
    console.log(idsToRemove.slice(0, 50).join('\n'));
  }
}

main().catch(console.error);
