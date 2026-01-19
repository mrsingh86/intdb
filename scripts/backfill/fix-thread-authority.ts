/**
 * Fix Thread Authority Issues
 *
 * Problem: RE: emails in a thread are classified independently,
 * leading to mixed document types within the same thread.
 *
 * Solution: Apply Thread Authority Rule
 * - First ORIGINAL email in thread sets the "thread document type"
 * - RE: emails should be general_correspondence unless they have new attachments
 *
 * Usage:
 *   npx tsx scripts/fix-thread-authority.ts              # Dry run
 *   npx tsx scripts/fix-thread-authority.ts --execute    # Apply fixes
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DRY_RUN = !process.argv.includes('--execute');

// Document types that carry workflow significance
const WORKFLOW_DOC_TYPES = new Set([
  'booking_confirmation', 'booking_amendment', 'booking_cancellation',
  'shipping_instruction', 'si_confirmation', 'si_draft',
  'vgm_confirmation',
  'draft_hbl', 'draft_mbl', 'hbl', 'mbl',
  'sob_confirmation',
  'arrival_notice', 'delivery_order',
  'gate_in_confirmation', 'pod_confirmation',
  'isf_filing', 'us_customs_7501', 'us_customs_3461',
]);

interface ThreadEmail {
  emailId: string;
  docId: string;
  threadId: string;
  receivedAt: string;
  isResponse: boolean;
  documentType: string;
  senderEmail: string;
  subject: string;
  hasAttachments: boolean;
}

interface ThreadFix {
  threadId: string;
  authorityType: string;
  authorityEmailId: string;
  fixes: Array<{
    docId: string;
    emailId: string;
    currentType: string;
    newType: string;
    reason: string;
  }>;
}

async function main() {
  console.log('FIX THREAD AUTHORITY ISSUES');
  console.log('='.repeat(80));
  console.log('Mode:', DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING');
  console.log('');

  // Step 1: Find all threads with multiple document types
  console.log('Step 1: Finding threads with mixed document types...');

  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      document_type,
      email_id,
      raw_emails!shipment_documents_email_id_fkey(
        id,
        thread_id,
        received_at,
        is_response,
        sender_email,
        subject,
        has_attachments
      )
    `)
    .not('email_id', 'is', null);

  // Group by thread
  const threadMap = new Map<string, ThreadEmail[]>();

  for (const doc of allDocs || []) {
    const email = (doc as any).raw_emails;
    if (!email?.thread_id) continue;

    const threadId = email.thread_id;
    if (!threadMap.has(threadId)) {
      threadMap.set(threadId, []);
    }

    threadMap.get(threadId)!.push({
      emailId: email.id,
      docId: doc.id,
      threadId,
      receivedAt: email.received_at,
      isResponse: email.is_response,
      documentType: doc.document_type,
      senderEmail: email.sender_email || '',
      subject: email.subject || '',
      hasAttachments: email.has_attachments,
    });
  }

  // Find threads with issues
  const problematicThreads: ThreadFix[] = [];

  for (const [threadId, emails] of threadMap) {
    // Sort by received_at to find authority (first email)
    emails.sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());

    // Find authority email (first ORIGINAL, or just first if all are RE)
    const originals = emails.filter(e => !e.isResponse);
    const authority = originals.length > 0 ? originals[0] : emails[0];

    // Get unique workflow doc types in thread
    const workflowTypes = [...new Set(
      emails
        .map(e => e.documentType)
        .filter(t => WORKFLOW_DOC_TYPES.has(t))
    )];

    // If thread has multiple workflow doc types, it's problematic
    if (workflowTypes.length > 1) {
      const fixes: ThreadFix['fixes'] = [];

      for (const email of emails) {
        // Skip the authority email
        if (email.emailId === authority.emailId) continue;

        // Skip non-workflow types
        if (!WORKFLOW_DOC_TYPES.has(email.documentType)) continue;

        // Check if this RE email should be reclassified
        if (email.isResponse) {
          // RE email with different workflow type than authority
          if (email.documentType !== authority.documentType) {
            // If it's general_correspondence, skip
            if (email.documentType === 'general_correspondence') continue;

            // If authority is general_correspondence, the RE might be correct
            // Only fix if authority has a workflow type
            if (!WORKFLOW_DOC_TYPES.has(authority.documentType)) continue;

            fixes.push({
              docId: email.docId,
              emailId: email.emailId,
              currentType: email.documentType,
              newType: 'general_correspondence',
              reason: `RE: email in thread where authority is ${authority.documentType}`,
            });
          }
        }
      }

      if (fixes.length > 0) {
        problematicThreads.push({
          threadId,
          authorityType: authority.documentType,
          authorityEmailId: authority.emailId,
          fixes,
        });
      }
    }
  }

  console.log(`  Found ${problematicThreads.length} threads with authority issues`);
  console.log('');

  // Step 2: Show fixes grouped by authority type
  console.log('Step 2: Planned fixes');
  console.log('-'.repeat(80));

  let totalFixes = 0;
  const byAuthority = new Map<string, ThreadFix[]>();

  for (const thread of problematicThreads) {
    const key = thread.authorityType;
    if (!byAuthority.has(key)) {
      byAuthority.set(key, []);
    }
    byAuthority.get(key)!.push(thread);
    totalFixes += thread.fixes.length;
  }

  for (const [authorityType, threads] of [...byAuthority.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const fixCount = threads.reduce((sum, t) => sum + t.fixes.length, 0);
    console.log(`\nAuthority: ${authorityType} (${threads.length} threads, ${fixCount} fixes)`);

    for (const thread of threads.slice(0, 3)) {
      console.log(`  Thread ${thread.threadId.substring(0, 12)}:`);
      for (const fix of thread.fixes.slice(0, 3)) {
        console.log(`    ${fix.currentType} → ${fix.newType}`);
        console.log(`      Reason: ${fix.reason}`);
      }
      if (thread.fixes.length > 3) {
        console.log(`    ... and ${thread.fixes.length - 3} more fixes`);
      }
    }
    if (threads.length > 3) {
      console.log(`  ... and ${threads.length - 3} more threads`);
    }
  }

  console.log('');
  console.log(`Total fixes needed: ${totalFixes}`);

  // Step 3: Apply fixes
  if (!DRY_RUN && totalFixes > 0) {
    console.log('\nStep 3: Applying fixes...');
    let fixed = 0;
    let errors = 0;

    for (const thread of problematicThreads) {
      for (const fix of thread.fixes) {
        // Update shipment_documents
        const { error: docError } = await supabase
          .from('shipment_documents')
          .update({ document_type: fix.newType })
          .eq('id', fix.docId);

        // Also update document_classifications
        await supabase
          .from('document_classifications')
          .update({ document_type: fix.newType })
          .eq('email_id', fix.emailId);

        if (!docError) {
          fixed++;
        } else {
          errors++;
          console.error(`  Error fixing ${fix.docId}: ${docError.message}`);
        }
      }
    }

    console.log(`  Fixed: ${fixed}`);
    console.log(`  Errors: ${errors}`);
  }

  // Summary
  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total threads analyzed: ${threadMap.size}`);
  console.log(`Threads with authority issues: ${problematicThreads.length}`);
  console.log(`Total fixes needed: ${totalFixes}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN - No changes made. Run with --execute to apply.');
  }
}

main().catch(console.error);
