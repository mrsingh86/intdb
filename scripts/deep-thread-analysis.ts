/**
 * Deep Thread Analysis
 *
 * Analyzes thread behavior to understand:
 * - Valid multi-document sharing patterns
 * - Misclassification patterns
 * - How timestamps, direction, and document types correlate
 *
 * Usage: npx tsx scripts/deep-thread-analysis.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface ThreadEmail {
  emailId: string;
  threadId: string;
  receivedAt: string;
  subject: string;
  senderEmail: string;
  senderName: string;
  trueSenderEmail: string | null;
  isResponse: boolean;
  hasAttachments: boolean;
  emailDirection: string;
  // From document_classifications
  documentType: string;
  emailType: string;
  senderCategory: string;
  sentiment: string;
  classificationDirection: string;
  confidence: number;
  // From shipment_documents
  shipmentBooking: string | null;
}

async function main() {
  console.log('DEEP THREAD ANALYSIS');
  console.log('='.repeat(80));
  console.log('Analyzing thread behavior to understand multi-document patterns');
  console.log('');

  // Step 1: Get threads with multiple emails
  console.log('Step 1: Finding threads with 4+ emails...');

  const { data: allEmails, error } = await supabase
    .from('raw_emails')
    .select(`
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
    `)
    .not('thread_id', 'is', null)
    .order('received_at', { ascending: true });

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  // Group by thread_id
  const threads = new Map<string, any[]>();
  for (const email of allEmails || []) {
    if (!threads.has(email.thread_id)) {
      threads.set(email.thread_id, []);
    }
    threads.get(email.thread_id)!.push(email);
  }

  // Find threads with 4+ emails
  const deepThreads = [...threads.entries()]
    .filter(([_, emails]) => emails.length >= 4)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  console.log(`  Found ${deepThreads.length} deep threads with 4+ emails`);
  console.log('');

  // Step 2: Get classifications and document links for these threads
  for (const [threadId, emails] of deepThreads) {
    console.log('─'.repeat(80));
    console.log(`📧 THREAD: ${threadId}`);
    console.log(`   Total emails: ${emails.length}`);
    console.log(`   Timespan: ${emails[0].received_at.substring(0, 10)} → ${emails[emails.length-1].received_at.substring(0, 10)}`);
    console.log('─'.repeat(80));

    // Get all classifications for emails in this thread
    const emailIds = emails.map((e: any) => e.id);

    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id, document_type, email_type, sender_category, sentiment, document_direction, confidence')
      .in('email_id', emailIds);

    const classMap = new Map<string, any>();
    for (const c of classifications || []) {
      classMap.set(c.email_id, c);
    }

    // Get shipment documents
    const { data: shipDocs } = await supabase
      .from('shipment_documents')
      .select(`
        email_id,
        document_type,
        shipments!shipment_documents_shipment_id_fkey(booking_number)
      `)
      .in('email_id', emailIds);

    const docMap = new Map<string, any>();
    for (const d of shipDocs || []) {
      docMap.set(d.email_id, d);
    }

    // Display each email in thread
    console.log('\nCHRONOLOGICAL THREAD FLOW:');
    console.log('-'.repeat(80));

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      const classification = classMap.get(email.id);
      const shipDoc = docMap.get(email.id);

      const time = new Date(email.received_at).toISOString().substring(0, 16);
      const isRe = email.is_response ? 'RE  ' : 'ORIG';
      const hasAtt = email.has_attachments ? '📎' : '  ';

      // Sender info
      const trueSender = email.true_sender_email || email.sender_email || '';
      const senderShort = trueSender.split('@')[0].substring(0, 15).padEnd(15);

      // Classification info
      const docType = classification?.document_type || shipDoc?.document_type || 'not_classified';
      const emailType = classification?.email_type || '-';
      const senderCat = classification?.sender_category || '-';
      const sentiment = classification?.sentiment || '-';
      const direction = classification?.document_direction || email.email_direction || '-';
      const confidence = classification?.confidence ? `${Math.round(classification.confidence * 100)}%` : '-';

      // Shipment info
      const booking = (shipDoc?.shipments as any)?.booking_number || '-';

      console.log(`\n  [${i + 1}] ${time} | ${isRe} | ${hasAtt}`);
      console.log(`      Subject: ${email.subject?.substring(0, 60) || '-'}`);
      console.log(`      Sender: ${senderShort} | Category: ${senderCat}`);
      console.log(`      Direction: ${direction.padEnd(8)} | Sentiment: ${sentiment}`);
      console.log(`      Doc Type: ${docType.padEnd(25)} | Email Type: ${emailType}`);
      console.log(`      Confidence: ${confidence} | Booking: ${booking}`);
    }

    // Thread Analysis
    console.log('\n\nTHREAD ANALYSIS:');
    console.log('-'.repeat(40));

    const docTypes = [...new Set(emails.map((e: any) => {
      const c = classMap.get(e.id);
      const d = docMap.get(e.id);
      return c?.document_type || d?.document_type || 'not_classified';
    }).filter((t: string) => t !== 'not_classified'))];

    const emailTypes = [...new Set(emails.map((e: any) => {
      const c = classMap.get(e.id);
      return c?.email_type || 'not_classified';
    }).filter((t: string) => t !== 'not_classified'))];

    const directions = [...new Set(emails.map((e: any) => {
      const c = classMap.get(e.id);
      return c?.document_direction || e.email_direction || 'unknown';
    }).filter((d: string) => d !== 'unknown'))];

    const senderCategories = [...new Set(emails.map((e: any) => {
      const c = classMap.get(e.id);
      return c?.sender_category || 'unknown';
    }).filter((s: string) => s !== 'unknown'))];

    const sentiments = [...new Set(emails.map((e: any) => {
      const c = classMap.get(e.id);
      return c?.sentiment || 'neutral';
    }))];

    const originalCount = emails.filter((e: any) => !e.is_response).length;
    const replyCount = emails.filter((e: any) => e.is_response).length;
    const withAttachments = emails.filter((e: any) => e.has_attachments).length;

    console.log(`  Document Types (${docTypes.length}): ${docTypes.join(', ')}`);
    console.log(`  Email Types (${emailTypes.length}): ${emailTypes.join(', ')}`);
    console.log(`  Directions: ${directions.join(', ')}`);
    console.log(`  Sender Categories: ${senderCategories.join(', ')}`);
    console.log(`  Sentiments: ${sentiments.join(', ')}`);
    console.log(`  Original/Reply: ${originalCount} ORIG, ${replyCount} RE`);
    console.log(`  With Attachments: ${withAttachments}/${emails.length}`);

    // Pattern Detection
    console.log('\nPATTERN DETECTION:');

    // Check if it's valid multi-doc workflow
    const workflowTypes = new Set(['booking_confirmation', 'shipping_instruction', 'si_confirmation',
      'vgm_confirmation', 'draft_hbl', 'hbl', 'draft_mbl', 'mbl', 'sob_confirmation']);

    const hasMultipleWorkflowDocs = docTypes.filter(t => workflowTypes.has(t)).length > 1;
    const hasMultipleParties = senderCategories.length > 1;
    const hasInboundAndOutbound = directions.includes('inbound') && directions.includes('outbound');

    if (hasMultipleWorkflowDocs && withAttachments >= docTypes.length - 1) {
      console.log('  ✅ VALID MULTI-DOC WORKFLOW: Multiple document stages shared in thread');
    }

    if (hasMultipleParties && hasInboundAndOutbound) {
      console.log('  ✅ VALID CONVERSATION: Multiple parties exchanging messages');
    }

    // Check for potential issues
    const reEmails = emails.filter((e: any) => e.is_response);
    const reWithDifferentType = reEmails.filter((e: any) => {
      const c = classMap.get(e.id);
      const origEmails = emails.filter((o: any) => !o.is_response);
      if (origEmails.length === 0) return false;
      const origClass = classMap.get(origEmails[0].id);
      return c?.document_type !== origClass?.document_type &&
             workflowTypes.has(c?.document_type) &&
             workflowTypes.has(origClass?.document_type);
    });

    if (reWithDifferentType.length > 0 && withAttachments < docTypes.length) {
      console.log(`  ⚠️ POTENTIAL MISCLASSIFICATION: ${reWithDifferentType.length} RE emails with different workflow type but no attachments`);
    }

    // Check for sender mismatch
    const suspiciousSenderDocs: string[] = [];
    for (const email of emails) {
      const c = classMap.get(email.id);
      const docType = c?.document_type;
      const senderCat = c?.sender_category;

      // MBL/HBL should come from shipping_line or freight_forwarder
      if ((docType === 'mbl' || docType === 'hbl') &&
          senderCat && !['shipping_line', 'freight_forwarder'].includes(senderCat)) {
        suspiciousSenderDocs.push(`${docType} from ${senderCat}`);
      }

      // booking_confirmation should come from shipping_line
      if (docType === 'booking_confirmation' &&
          senderCat && senderCat !== 'shipping_line') {
        suspiciousSenderDocs.push(`${docType} from ${senderCat}`);
      }
    }

    if (suspiciousSenderDocs.length > 0) {
      console.log(`  ⚠️ SENDER MISMATCH: ${[...new Set(suspiciousSenderDocs)].join(', ')}`);
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('OVERALL INSIGHTS');
  console.log('='.repeat(80));
  console.log(`
Key Observations:
1. VALID MULTI-DOC THREADS: Email threads in shipping legitimately contain multiple
   document types as the workflow progresses (booking → SI → VGM → BL → SOB).

2. PATTERN INDICATORS:
   - has_attachments = TRUE often indicates genuine new document
   - is_response = FALSE (ORIG) typically starts a new workflow stage
   - is_response = TRUE (RE) with NO attachments = acknowledgement/follow-up

3. CLASSIFICATION APPROACH:
   - Don't blindly inherit thread authority
   - Check for attachments: new attachment = potentially new document stage
   - Use sender_category + document_type validation (MBL must come from carrier)
   - RE emails without attachments should likely be general_correspondence

4. DIRECTION FLOW:
   - Valid threads often show bidirectional flow (inbound + outbound)
   - Carrier → Forwarder → Shipper communication chain
`);
}

main().catch(console.error);
