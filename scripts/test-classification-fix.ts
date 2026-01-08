/**
 * Test Classification Fix - Elaborate Thread Analysis
 *
 * Analyzes real threads to compare OLD vs NEW classification behavior.
 * Shows impact of removing subject-based classification for RE:/FW: emails.
 *
 * Usage: npx tsx scripts/test-classification-fix.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { createEmailContentClassificationService } from '../lib/services/classification/email-content-classification-service';
import { createThreadContextService } from '../lib/services/classification/thread-context-service';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const emailClassifier = createEmailContentClassificationService();
const threadContextService = createThreadContextService();

// Simulate OLD classification behavior (subject used for all emails)
function classifyOldBehavior(
  subject: string,
  bodyText: string,
  senderEmail: string,
  attachmentFilenames: string[]
): { type: string | null; source: string } {
  const threadContext = threadContextService.extract({ subject, bodyText, senderEmail });

  // OLD: Always try attachment, subject, then body (regardless of reply status)
  // Simulate by checking subject patterns directly
  const SUBJECT_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /\barrival\s+notice\b/i, type: 'arrival_notice' },
    { pattern: /\bPRE-ALERT\b/i, type: 'arrival_notice' },
    { pattern: /\bSOB\s+CONFIRM/i, type: 'sob_confirmation' },
    { pattern: /\bshipped\s+on\s+board/i, type: 'sob_confirmation' },
    { pattern: /\bVGM\s+(confirm|submit)/i, type: 'vgm_confirmation' },
    { pattern: /\bBL\s+DRAFT/i, type: 'draft_hbl' },
    { pattern: /\bdraft\s+BL/i, type: 'draft_hbl' },
    { pattern: /\bMBL\b/i, type: 'mbl' },
    { pattern: /\bHBL\b/i, type: 'hbl' },
    { pattern: /\bbooking.*confirm/i, type: 'booking_confirmation' },
    { pattern: /\bSI\s+draft/i, type: 'si_draft' },
    { pattern: /\bWork\s+Order/i, type: 'work_order' },
  ];

  for (const { pattern, type } of SUBJECT_PATTERNS) {
    if (pattern.test(threadContext.cleanSubject)) {
      return { type, source: 'subject' };
    }
  }

  return { type: null, source: 'none' };
}

// NEW classification behavior (subject only for original emails)
function classifyNewBehavior(
  subject: string,
  bodyText: string,
  senderEmail: string,
  attachmentFilenames: string[]
): { type: string | null; source: string } {
  const threadContext = threadContextService.extract({ subject, bodyText, senderEmail });
  const result = emailClassifier.classify({ threadContext, attachmentFilenames });

  if (result) {
    return { type: result.documentType, source: result.source };
  }
  return { type: null, source: 'none' };
}

interface EmailData {
  id: string;
  subject: string;
  bodyText: string;
  senderEmail: string;
  isResponse: boolean;
  hasAttachments: boolean;
  receivedAt: string;
  currentDocType: string;
  attachmentFilenames: string[];
}

async function main() {
  console.log('ELABORATE CLASSIFICATION TEST - OLD vs NEW BEHAVIOR');
  console.log('='.repeat(80));
  console.log('');

  // Get threads with workflow documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      document_type,
      email_id,
      raw_emails!shipment_documents_email_id_fkey(
        id,
        thread_id,
        subject,
        body_text,
        sender_email,
        is_response,
        has_attachments,
        received_at
      )
    `)
    .in('document_type', [
      'arrival_notice', 'mbl', 'hbl', 'draft_hbl', 'vgm_confirmation',
      'sob_confirmation', 'booking_confirmation', 'si_draft', 'work_order'
    ])
    .not('email_id', 'is', null)
    .limit(100);

  // Group by thread
  const threads = new Map<string, EmailData[]>();

  for (const doc of docs || []) {
    const email = (doc as any).raw_emails;
    if (!email?.thread_id) continue;

    if (!threads.has(email.thread_id)) {
      threads.set(email.thread_id, []);
    }

    // Get attachment filenames
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename')
      .eq('email_id', email.id);

    threads.get(email.thread_id)!.push({
      id: email.id,
      subject: email.subject || '',
      bodyText: email.body_text || '',
      senderEmail: email.sender_email || '',
      isResponse: email.is_response || false,
      hasAttachments: email.has_attachments || false,
      receivedAt: email.received_at,
      currentDocType: doc.document_type,
      attachmentFilenames: attachments?.map(a => a.filename).filter(Boolean) || [],
    });
  }

  // Analyze threads with multiple emails
  const multiEmailThreads = [...threads.entries()]
    .filter(([_, emails]) => emails.length >= 2)
    .slice(0, 10);

  console.log(`Analyzing ${multiEmailThreads.length} threads with 2+ workflow docs\n`);

  let totalEmails = 0;
  let changedClassifications = 0;
  let fixedMisclassifications = 0;
  const changesByType = new Map<string, number>();

  for (const [threadId, emails] of multiEmailThreads) {
    // Sort by time
    emails.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

    console.log('─'.repeat(80));
    console.log(`📧 THREAD: ${threadId.substring(0, 16)}`);
    console.log(`   Emails: ${emails.length}`);
    console.log('─'.repeat(80));

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      totalEmails++;

      const time = new Date(email.receivedAt).toISOString().substring(0, 16);
      const isRe = email.isResponse ? 'RE  ' : 'ORIG';
      const hasAtt = email.hasAttachments ? '📎' : '  ';

      // Get OLD and NEW classification
      const oldClass = classifyOldBehavior(
        email.subject,
        email.bodyText,
        email.senderEmail,
        email.attachmentFilenames
      );
      const newClass = classifyNewBehavior(
        email.subject,
        email.bodyText,
        email.senderEmail,
        email.attachmentFilenames
      );

      const changed = oldClass.type !== newClass.type;
      const changeMarker = changed ? '⚡' : '  ';

      // Track if this is a FIX (RE email without attachment that was misclassified)
      const isFix = changed && email.isResponse && !email.hasAttachments && oldClass.type !== null;
      if (isFix) {
        fixedMisclassifications++;
        const key = oldClass.type || 'unknown';
        changesByType.set(key, (changesByType.get(key) || 0) + 1);
      }
      if (changed) changedClassifications++;

      console.log(`\n  [${i + 1}] ${time} | ${isRe} | ${hasAtt} ${changeMarker}`);
      console.log(`      Subject: ${email.subject?.substring(0, 55) || '-'}`);
      console.log(`      Current DB type: ${email.currentDocType}`);
      console.log(`      OLD classification: ${oldClass.type || 'null'} (${oldClass.source})`);
      console.log(`      NEW classification: ${newClass.type || 'null'} (${newClass.source})`);

      if (changed) {
        if (isFix) {
          console.log(`      ✅ FIX: RE email without attachment no longer gets workflow type`);
        } else if (email.isResponse) {
          console.log(`      📝 CHANGE: Reply email classification changed`);
        } else {
          console.log(`      ⚠️ UNEXPECTED: Original email classification changed`);
        }
      }
    }

    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  console.log(`\nTotal emails analyzed: ${totalEmails}`);
  console.log(`Classifications changed: ${changedClassifications}`);
  console.log(`Misclassifications fixed: ${fixedMisclassifications}`);

  if (changesByType.size > 0) {
    console.log('\nFixed misclassifications by type:');
    for (const [type, count] of [...changesByType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }

  // Additional analysis: Find all RE emails without attachments that have workflow types
  console.log('\n' + '─'.repeat(80));
  console.log('ADDITIONAL: All RE emails without attachments with workflow types');
  console.log('─'.repeat(80));

  const { data: problematicDocs } = await supabase
    .from('shipment_documents')
    .select(`
      document_type,
      raw_emails!shipment_documents_email_id_fkey(
        subject,
        is_response,
        has_attachments
      )
    `)
    .in('document_type', [
      'arrival_notice', 'mbl', 'hbl', 'draft_hbl', 'draft_mbl',
      'vgm_confirmation', 'sob_confirmation', 'booking_confirmation',
      'si_draft', 'si_confirmation'
    ])
    .not('email_id', 'is', null);

  const problematic = (problematicDocs || []).filter(d => {
    const email = (d as any).raw_emails;
    return email?.is_response === true && email?.has_attachments === false;
  });

  const byType = new Map<string, number>();
  for (const d of problematic) {
    byType.set(d.document_type, (byType.get(d.document_type) || 0) + 1);
  }

  console.log(`\nTotal problematic docs (RE + no attachment + workflow type): ${problematic.length}`);
  console.log('\nBy document type:');
  for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log(`
KEY INSIGHT:
These ${problematic.length} documents are RE:/FW: emails WITHOUT attachments that got
classified as workflow document types. This is incorrect because:
- RE:/FW: emails inherit the original subject
- Without an attachment, there's no actual document
- They're just replies DISCUSSING the document, not containing it

The NEW classification logic would return 'null' for these, preventing misclassification.
`);
}

main().catch(console.error);
