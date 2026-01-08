/**
 * Check how no-attachment docs got classified
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const WORKFLOW_TYPES = ['mbl', 'hbl', 'draft_hbl', 'draft_mbl', 'booking_confirmation', 'sob_confirmation', 'vgm_confirmation', 'arrival_notice'];

  const { data: docs } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      document_type,
      email_id,
      raw_emails!shipment_documents_email_id_fkey(
        id,
        has_attachments,
        subject,
        is_response
      )
    `)
    .in('document_type', WORKFLOW_TYPES)
    .not('email_id', 'is', null);

  const noAtt = (docs || []).filter(d => {
    const email = (d as any).raw_emails;
    return email && email.has_attachments === false;
  });

  console.log('NO-ATTACHMENT WORKFLOW DOCS - CLASSIFICATION SOURCE ANALYSIS');
  console.log('='.repeat(70));
  console.log(`Total: ${noAtt.length} docs`);
  console.log('');

  // Get classifications for these
  const emailIds = noAtt.map(d => d.email_id);
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, classification_source, classification_method, confidence')
    .in('email_id', emailIds);

  const classMap = new Map<string, any>();
  for (const c of classifications || []) {
    classMap.set(c.email_id, c);
  }

  // Analyze
  const bySource = new Map<string, number>();
  const byMethod = new Map<string, number>();

  for (const doc of noAtt) {
    const classification = classMap.get(doc.email_id);
    const source = classification?.classification_source || 'NOT_IN_CLASSIFICATIONS';
    const method = classification?.classification_method || 'unknown';

    bySource.set(source, (bySource.get(source) || 0) + 1);
    byMethod.set(method, (byMethod.get(method) || 0) + 1);
  }

  console.log('BY CLASSIFICATION SOURCE:');
  for (const [source, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`);
  }

  console.log('');
  console.log('BY CLASSIFICATION METHOD:');
  for (const [method, count] of [...byMethod.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${method}: ${count}`);
  }

  // Show examples
  console.log('');
  console.log('EXAMPLES:');
  console.log('-'.repeat(70));

  for (const doc of noAtt.slice(0, 8)) {
    const email = (doc as any).raw_emails;
    const classification = classMap.get(doc.email_id);

    console.log('');
    console.log(`Doc Type: ${doc.document_type}`);
    console.log(`Subject: ${email?.subject?.substring(0, 60)}`);
    console.log(`is_response: ${email?.is_response}`);
    console.log(`Classification Source: ${classification?.classification_source || 'NOT FOUND'}`);
    console.log(`Classification Method: ${classification?.classification_method || '-'}`);
    console.log(`Confidence: ${classification?.confidence || '-'}`);
  }

  // Diagnosis
  console.log('');
  console.log('='.repeat(70));
  console.log('DIAGNOSIS:');
  console.log('='.repeat(70));
  console.log(`
The problem: ${noAtt.length} emails WITHOUT attachments are classified as workflow document types.

This happens because classification uses:
- Subject line patterns ("PRE-ALERT" → arrival_notice)
- Body text patterns
- But IGNORES the fact that there's no actual document attached

FIX REQUIRED:
Workflow document types (mbl, hbl, booking_confirmation, etc.) should ONLY be assigned
when has_attachments = TRUE. Without an attachment, the email is just correspondence
ABOUT the document, not the document itself.
`);
}

main().catch(console.error);
