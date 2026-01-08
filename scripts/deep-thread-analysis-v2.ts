/**
 * Deep Thread Analysis V2
 *
 * Focuses on threads with CLASSIFIED documents to understand behavior.
 * Finds threads that have multiple different document types.
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
  console.log('DEEP THREAD ANALYSIS V2 - CLASSIFIED DOCUMENTS ONLY');
  console.log('='.repeat(80));

  // Step 1: Get all shipment_documents with email thread info
  console.log('Step 1: Finding threads with classified documents...');

  const { data: docs, error } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      document_type,
      email_id,
      shipment_id,
      shipments!shipment_documents_shipment_id_fkey(booking_number),
      raw_emails!shipment_documents_email_id_fkey(
        id,
        thread_id,
        received_at,
        subject,
        sender_email,
        sender_name,
        true_sender_email,
        is_response,
        has_attachments,
        email_direction
      )
    `)
    .not('email_id', 'is', null);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  // Group by thread_id
  const threads = new Map<string, any[]>();
  for (const doc of docs || []) {
    const email = (doc as any).raw_emails;
    if (!email?.thread_id) continue;

    if (!threads.has(email.thread_id)) {
      threads.set(email.thread_id, []);
    }
    threads.get(email.thread_id)!.push({
      ...doc,
      email,
      shipment: (doc as any).shipments,
    });
  }

  // Find threads with multiple document types
  const WORKFLOW_TYPES = new Set([
    'booking_confirmation', 'booking_amendment',
    'shipping_instruction', 'si_confirmation', 'si_draft',
    'vgm_confirmation', 'draft_hbl', 'hbl', 'draft_mbl', 'mbl',
    'sob_confirmation', 'arrival_notice', 'delivery_order',
  ]);

  const mixedThreads: Array<{ threadId: string; docs: any[]; docTypes: string[] }> = [];

  for (const [threadId, threadDocs] of threads) {
    const uniqueWorkflowTypes = [...new Set(
      threadDocs.map(d => d.document_type).filter(t => WORKFLOW_TYPES.has(t))
    )];

    if (uniqueWorkflowTypes.length > 1) {
      mixedThreads.push({
        threadId,
        docs: threadDocs,
        docTypes: uniqueWorkflowTypes,
      });
    }
  }

  console.log(`  Found ${mixedThreads.length} threads with multiple workflow doc types`);
  console.log('');

  // Step 2: Get classifications for these threads
  for (const { threadId, docs, docTypes } of mixedThreads.slice(0, 5)) {
    const emailIds = docs.map(d => d.email?.id).filter(Boolean);

    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id, document_type, email_type, sender_category, sentiment, document_direction, confidence')
      .in('email_id', emailIds);

    const classMap = new Map<string, any>();
    for (const c of classifications || []) {
      classMap.set(c.email_id, c);
    }

    // Sort docs by timestamp
    docs.sort((a, b) =>
      new Date(a.email.received_at).getTime() - new Date(b.email.received_at).getTime()
    );

    console.log('─'.repeat(80));
    console.log(`📧 THREAD: ${threadId}`);
    console.log(`   Workflow Types: ${docTypes.join(', ')}`);
    console.log(`   Emails in thread: ${docs.length}`);
    console.log('─'.repeat(80));

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const email = doc.email;
      const classification = classMap.get(email.id);

      const time = new Date(email.received_at).toISOString().substring(0, 16);
      const isRe = email.is_response ? 'RE  ' : 'ORIG';
      const hasAtt = email.has_attachments ? '📎' : '  ';

      // Sender info
      const trueSender = email.true_sender_email || email.sender_email || '';
      const senderShort = trueSender.split('@')[0].substring(0, 18).padEnd(18);
      const senderDomain = trueSender.split('@')[1]?.substring(0, 20) || '';

      // Classification info
      const docType = classification?.document_type || doc.document_type || '-';
      const shipDocType = doc.document_type;
      const emailType = classification?.email_type || '-';
      const senderCat = classification?.sender_category || '-';
      const sentiment = classification?.sentiment || '-';
      const direction = classification?.document_direction || email.email_direction || '-';
      const booking = doc.shipment?.booking_number || '-';

      console.log(`\n  [${i + 1}] ${time} | ${isRe} | ${hasAtt}`);
      console.log(`      Subject: ${email.subject?.substring(0, 55) || '-'}`);
      console.log(`      Sender: ${senderShort} @ ${senderDomain}`);
      console.log(`      Sender Category: ${senderCat.padEnd(18)} | Sentiment: ${sentiment}`);
      console.log(`      Direction: ${direction.padEnd(10)}`);
      console.log(`      Doc Type (shipment_docs): ${shipDocType}`);
      console.log(`      Doc Type (classification): ${docType}`);
      console.log(`      Email Type: ${emailType}`);
      console.log(`      Booking: ${booking}`);
    }

    // Analysis
    console.log('\n\n📊 THREAD PATTERN ANALYSIS:');
    console.log('-'.repeat(40));

    const originals = docs.filter(d => !d.email.is_response);
    const replies = docs.filter(d => d.email.is_response);
    const withAttachments = docs.filter(d => d.email.has_attachments);

    console.log(`  Structure: ${originals.length} ORIG, ${replies.length} RE`);
    console.log(`  With Attachments: ${withAttachments.length}/${docs.length}`);

    // Check for mismatches
    const docTypeClassMismatch = docs.filter(d => {
      const c = classMap.get(d.email.id);
      return c && c.document_type !== d.document_type;
    });

    if (docTypeClassMismatch.length > 0) {
      console.log(`\n  ⚠️ CLASSIFICATION MISMATCH: ${docTypeClassMismatch.length} docs where shipment_documents.document_type ≠ document_classifications.document_type`);
      for (const d of docTypeClassMismatch) {
        const c = classMap.get(d.email.id);
        console.log(`     - shipment_docs: ${d.document_type} | classification: ${c.document_type}`);
      }
    }

    // Check for RE emails with workflow types but no attachments
    const suspiciousREs = replies.filter(d => {
      return WORKFLOW_TYPES.has(d.document_type) && !d.email.has_attachments;
    });

    if (suspiciousREs.length > 0) {
      console.log(`\n  ⚠️ SUSPICIOUS RE EMAILS: ${suspiciousREs.length} reply emails with workflow doc type but NO attachments`);
      for (const d of suspiciousREs) {
        console.log(`     - ${d.document_type} (RE, no attachment)`);
      }
    }

    // Check for sender category mismatches
    const senderMismatches: string[] = [];
    for (const d of docs) {
      const c = classMap.get(d.email.id);
      const docType = d.document_type;
      const senderCat = c?.sender_category;

      // MBL/HBL should come from shipping_line or freight_forwarder
      if ((docType === 'mbl' || docType === 'hbl' || docType === 'draft_hbl' || docType === 'draft_mbl') &&
          senderCat && !['shipping_line', 'freight_forwarder', 'nvocc'].includes(senderCat)) {
        senderMismatches.push(`${docType} from ${senderCat}`);
      }

      // booking_confirmation should come from shipping_line
      if (docType === 'booking_confirmation' &&
          senderCat && !['shipping_line', 'freight_forwarder', 'nvocc'].includes(senderCat)) {
        senderMismatches.push(`${docType} from ${senderCat}`);
      }
    }

    if (senderMismatches.length > 0) {
      console.log(`\n  ⚠️ SENDER MISMATCH: ${[...new Set(senderMismatches)].join(', ')}`);
    }

    // Verdict
    console.log('\n  VERDICT:');
    if (withAttachments.length >= docTypes.length) {
      console.log('  ✅ VALID MULTI-DOC THREAD: Each workflow stage has an attachment');
    } else if (suspiciousREs.length > 0) {
      console.log('  ⚠️ LIKELY MISCLASSIFICATION: RE emails without attachments classified as workflow docs');
    } else {
      console.log('  ❓ NEEDS MANUAL REVIEW');
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  // Count patterns
  let validMultiDoc = 0;
  let likelyMisclass = 0;
  let needsReview = 0;

  for (const { threadId, docs, docTypes } of mixedThreads) {
    const withAttachments = docs.filter(d => d.email.has_attachments).length;
    const replies = docs.filter(d => d.email.is_response);
    const suspiciousREs = replies.filter(d => {
      return WORKFLOW_TYPES.has(d.document_type) && !d.email.has_attachments;
    });

    if (withAttachments >= docTypes.length) {
      validMultiDoc++;
    } else if (suspiciousREs.length > 0) {
      likelyMisclass++;
    } else {
      needsReview++;
    }
  }

  console.log(`\nOf ${mixedThreads.length} threads with multiple workflow doc types:`);
  console.log(`  ✅ Valid multi-doc threads: ${validMultiDoc}`);
  console.log(`  ⚠️ Likely misclassification: ${likelyMisclass}`);
  console.log(`  ❓ Needs manual review: ${needsReview}`);

  console.log(`
KEY INSIGHTS:
1. has_attachments is the KEY signal - new attachment = likely new document stage
2. RE emails WITHOUT attachments should NOT be classified as workflow documents
3. sender_category validation catches impossible sender-document combinations
4. Thread authority is WRONG approach - multiple docs in thread is VALID
5. Better approach: Classify based on:
   a) Attachment content (PDF markers)
   b) has_attachments flag
   c) sender_category validation
   d) Don't inherit classification from thread
`);
}

main().catch(console.error);
