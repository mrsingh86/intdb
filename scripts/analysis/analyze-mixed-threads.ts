/**
 * Analyze mixed-type threads to understand if they're valid
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
  console.log('ANALYZING: Are multiple doc types in one thread VALID?');
  console.log('='.repeat(80));

  // Get threads with multiple workflow doc types
  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      document_type,
      raw_emails!shipment_documents_email_id_fkey(
        thread_id,
        received_at,
        sender_email,
        subject,
        is_response,
        has_attachments
      )
    `)
    .not('email_id', 'is', null);

  const WORKFLOW_TYPES = new Set([
    'booking_confirmation', 'booking_amendment',
    'shipping_instruction', 'si_confirmation', 'si_draft',
    'vgm_confirmation', 'draft_hbl', 'hbl', 'mbl',
    'sob_confirmation', 'arrival_notice', 'delivery_order',
  ]);

  // Group by thread
  const threads = new Map<string, any[]>();
  for (const doc of allDocs || []) {
    const email = (doc as any).raw_emails;
    if (!email?.thread_id) continue;

    if (!threads.has(email.thread_id)) {
      threads.set(email.thread_id, []);
    }
    threads.get(email.thread_id)!.push({
      docType: doc.document_type,
      receivedAt: email.received_at,
      sender: email.sender_email,
      subject: email.subject,
      isResponse: email.is_response,
      hasAttachments: email.has_attachments,
    });
  }

  // Find threads with multiple workflow types
  const mixedThreads: Array<{ threadId: string; emails: any[] }> = [];

  for (const [threadId, emails] of threads) {
    const workflowTypes = [...new Set(
      emails.map(e => e.docType).filter(t => WORKFLOW_TYPES.has(t))
    )];

    if (workflowTypes.length > 1) {
      mixedThreads.push({ threadId, emails });
    }
  }

  console.log(`Found ${mixedThreads.length} threads with multiple workflow doc types\n`);

  // Analyze each mixed thread
  for (const { threadId, emails } of mixedThreads.slice(0, 5)) {
    console.log(`\nThread ${threadId.substring(0, 12)}:`);
    console.log('-'.repeat(70));

    // Sort by time
    emails.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

    for (const e of emails) {
      const time = new Date(e.receivedAt).toISOString().substring(0, 16);
      const isRe = e.isResponse ? 'RE  ' : 'ORIG';
      const hasAtt = e.hasAttachments ? '📎' : '  ';
      const sender = (e.sender || '').split('<')[0].trim().substring(0, 20).padEnd(20);
      console.log(`${time} | ${isRe} | ${hasAtt} | ${e.docType.padEnd(22)} | ${sender}`);
    }

    // Analysis
    const types = [...new Set(emails.map(e => e.docType))];
    const withAttachments = emails.filter(e => e.hasAttachments).length;
    const replies = emails.filter(e => e.isResponse).length;

    console.log(`\n  Analysis:`);
    console.log(`    Doc types: ${types.join(', ')}`);
    console.log(`    Emails with attachments: ${withAttachments}/${emails.length}`);
    console.log(`    Reply ratio: ${replies}/${emails.length}`);

    // Determine if this is valid multi-doc sharing or misclassification
    if (withAttachments >= types.length - 1) {
      console.log(`    Verdict: ✓ VALID - Multiple documents shared in conversation`);
    } else {
      console.log(`    Verdict: ⚠️ SUSPICIOUS - Multiple types but few attachments`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('CONCLUSION:');
  console.log('='.repeat(80));

  const validCount = mixedThreads.filter(({ emails }) => {
    const types = [...new Set(emails.map(e => e.docType))];
    const withAtt = emails.filter(e => e.hasAttachments).length;
    return withAtt >= types.length - 1;
  }).length;

  console.log(`\nOf ${mixedThreads.length} mixed threads:`);
  console.log(`  ${validCount} appear to be VALID multi-doc sharing`);
  console.log(`  ${mixedThreads.length - validCount} may be MISCLASSIFICATION`);
  console.log(`\nKey insight: Check has_attachments to distinguish valid from misclassified`);
}

main().catch(console.error);
