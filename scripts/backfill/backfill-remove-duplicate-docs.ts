import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DRY_RUN = !process.argv.includes('--execute');

async function main() {
  console.log('BACKFILL: Remove Duplicate Documents from shipment_documents');
  console.log('='.repeat(70));
  console.log('Mode:', DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING');
  console.log('');

  // Get all shipment_documents with email info (paginated to get ALL)
  let allDocs: any[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: batch } = await supabase
      .from('shipment_documents')
      .select(`
        id,
        shipment_id,
        document_type,
        email_id,
        created_at,
        raw_emails!inner(is_response, subject, thread_id, received_at)
      `)
      .range(offset, offset + pageSize - 1);

    if (!batch || batch.length === 0) break;
    allDocs = allDocs.concat(batch);
    offset += pageSize;
    if (batch.length < pageSize) break;
  }

  if (!allDocs || allDocs.length === 0) {
    console.log('No documents found');
    return;
  }

  console.log('Total shipment_documents:', allDocs.length);

  // Group by shipment_id + document_type
  const groups: Record<string, Array<{
    id: string;
    emailId: string;
    createdAt: string;
    receivedAt: string;
    isResponse: boolean;
    subject: string;
    threadId: string;
  }>> = {};

  for (const d of allDocs) {
    const email = (d as any).raw_emails;
    const key = (d.shipment_id || 'null') + '|' + d.document_type;
    if (!groups[key]) groups[key] = [];
    groups[key].push({
      id: d.id,
      emailId: d.email_id,
      createdAt: d.created_at,
      receivedAt: email?.received_at || d.created_at,
      isResponse: email?.is_response || false,
      subject: email?.subject || '',
      threadId: email?.thread_id || '',
    });
  }

  // Find duplicates
  const duplicateGroups = Object.entries(groups).filter(([_, docs]) => docs.length > 1);
  console.log('Groups with duplicates:', duplicateGroups.length);

  const toRemove: Array<{
    id: string;
    docType: string;
    shipmentId: string;
    isResponse: boolean;
    subject: string;
  }> = [];

  let fromResponseEmails = 0;
  let fromSameThread = 0;

  for (const [key, docs] of duplicateGroups) {
    const [shipmentId, docType] = key.split('|');

    // Sort by received_at (keep the EARLIEST one)
    docs.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    const keeper = docs[0];
    const duplicates = docs.slice(1);

    for (const dup of duplicates) {
      toRemove.push({
        id: dup.id,
        docType,
        shipmentId,
        isResponse: dup.isResponse,
        subject: dup.subject,
      });

      if (dup.isResponse) fromResponseEmails++;
      if (dup.threadId && dup.threadId === keeper.threadId) fromSameThread++;
    }
  }

  console.log('');
  console.log('Documents to remove:', toRemove.length);
  console.log('  - From RE:/FW: emails (is_response=true):', fromResponseEmails);
  console.log('  - From same thread as keeper:', fromSameThread);
  console.log('');

  // Show sample of what will be removed
  console.log('SAMPLE (first 20 to remove):');
  for (const doc of toRemove.slice(0, 20)) {
    const responseFlag = doc.isResponse ? '[RE/FW]' : '[ORIG]';
    console.log(`  ${responseFlag} ${doc.docType.padEnd(25)} | ${doc.subject.substring(0, 40)}`);
  }

  if (DRY_RUN) {
    console.log('');
    console.log('='.repeat(70));
    console.log('DRY RUN COMPLETE. Run with --execute to remove duplicates.');
    return;
  }

  // Execute removal
  console.log('');
  console.log('Removing duplicates...');

  const idsToRemove = toRemove.map(d => d.id);
  const batchSize = 100;
  let removed = 0;

  for (let i = 0; i < idsToRemove.length; i += batchSize) {
    const batch = idsToRemove.slice(i, i + batchSize);
    const { error } = await supabase
      .from('shipment_documents')
      .delete()
      .in('id', batch);

    if (error) {
      console.error('Error removing batch:', error);
    } else {
      removed += batch.length;
      console.log(`  Removed ${removed}/${idsToRemove.length}`);
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('BACKFILL COMPLETE. Removed', removed, 'duplicate documents.');
}

main().catch(console.error);
