/**
 * Reclassify Emails - Populate New Parallel Classification Tables
 *
 * Runs classification on emails and saves to:
 * - email_classifications (one per email - ALWAYS)
 * - attachment_classifications (one per attachment - when PDF exists)
 *
 * Usage:
 *   npx tsx scripts/reclassify-emails.ts --sample 10   # Test on 10 emails
 *   npx tsx scripts/reclassify-emails.ts --all         # Run on all emails
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  createClassificationOrchestrator,
  ClassificationOutput,
} from '../lib/services/classification';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const classificationOrchestrator = createClassificationOrchestrator();

// Document category mapping
function getDocumentCategory(documentType: string): string {
  const workflowDocs = [
    'booking_confirmation', 'booking_amendment', 'sob_confirmation',
    'mbl', 'hbl', 'draft_mbl', 'draft_hbl',
    'shipping_instruction', 'si_draft', 'si_confirmation',
    'vgm_confirmation', 'arrival_notice', 'delivery_order',
  ];
  const commercialDocs = ['invoice', 'packing_list', 'purchase_order', 'commercial_invoice'];
  const complianceDocs = ['certificate', 'permit', 'license', 'customs_declaration'];
  const operationalDocs = ['work_order', 'gate_in_confirmation', 'container_release', 'empty_return'];

  if (workflowDocs.includes(documentType)) return 'workflow';
  if (commercialDocs.includes(documentType)) return 'commercial';
  if (complianceDocs.includes(documentType)) return 'compliance';
  if (operationalDocs.includes(documentType)) return 'operational';
  return 'general';
}

interface EmailRecord {
  id: string;
  thread_id: string | null;
  subject: string | null;
  sender_email: string | null;
  sender_name: string | null;
  true_sender_email: string | null;
  body_text: string | null;
  received_at: string;
  has_attachments: boolean;
  is_response: boolean;
}

interface AttachmentRecord {
  id: string;
  filename: string;
  extracted_text: string | null;
}

async function classifyEmail(
  email: EmailRecord,
  attachments: AttachmentRecord[],
  verbose: boolean = false
): Promise<{ success: boolean; emailClass: any; attachClasses: any[] }> {
  try {
    // Build classification input
    const attachmentFilenames = attachments.map(a => a.filename).filter(Boolean);
    const pdfContent = attachments
      .filter(a => a.extracted_text && a.extracted_text.length > 50)
      .map(a => a.extracted_text)
      .join('\n\n');

    // Run classification
    const result = classificationOrchestrator.classify({
      subject: email.subject || '',
      senderEmail: email.sender_email || '',
      senderName: email.sender_name || undefined,
      trueSenderEmail: email.true_sender_email || null,
      bodyText: email.body_text || '',
      attachmentFilenames,
      pdfContent: pdfContent || undefined,
    });

    // Generate linking_id only when email has attachments
    const linkingId = email.has_attachments && attachments.length > 0 ? uuidv4() : null;

    // Determine is_original based on thread context
    const isOriginal = !result.threadContext.isReply && !result.threadContext.isForward;
    const classificationSource = isOriginal ? 'subject+content' : 'content';
    const classificationStatus = result.emailTypeConfidence >= 70 ? 'classified' :
      result.emailTypeConfidence >= 50 ? 'low_confidence' : 'unclassified';

    // 1. Save to email_classifications
    const emailClassData = {
      email_id: email.id,
      thread_id: email.thread_id,
      linking_id: linkingId,
      email_type: result.emailType,
      email_category: result.emailCategory,
      sender_category: result.senderCategory,
      sentiment: result.sentiment,
      is_original: isOriginal,
      classification_source: classificationSource,
      classification_status: classificationStatus,
      confidence: result.emailTypeConfidence / 100,
      email_workflow_state: result.documentWorkflowState,
      received_at: email.received_at,
      classified_at: new Date().toISOString(),
    };

    const { data: emailClass, error: emailError } = await supabase
      .from('email_classifications')
      .upsert(emailClassData, { onConflict: 'email_id' })
      .select()
      .single();

    if (emailError) {
      throw new Error(`Email classification error: ${emailError.message}`);
    }

    // 2. Save to attachment_classifications (only when attachments exist)
    const attachClasses: any[] = [];

    if (email.has_attachments && attachments.length > 0) {
      const wasClassifiedFromContent = result.documentMethod === 'pdf_content';
      const docClassificationStatus = wasClassifiedFromContent
        ? (result.documentConfidence >= 70 ? 'classified' : 'low_confidence')
        : 'unclassified';
      const documentCategory = wasClassifiedFromContent ? getDocumentCategory(result.documentType) : null;

      for (const attachment of attachments) {
        const attachClassData = {
          email_id: email.id,
          attachment_id: attachment.id,
          thread_id: email.thread_id,
          linking_id: linkingId,
          document_type: wasClassifiedFromContent ? result.documentType : null,
          document_category: documentCategory,
          sender_category: result.senderCategory,
          classification_method: 'content',
          classification_status: docClassificationStatus,
          confidence: wasClassifiedFromContent ? result.documentConfidence / 100 : null,
          matched_markers: result.documentMatchedMarkers
            ? { markers: result.documentMatchedMarkers }
            : null,
          document_workflow_state: wasClassifiedFromContent ? result.documentWorkflowState : null,
          received_at: email.received_at,
          classified_at: new Date().toISOString(),
        };

        const { data: attachClass, error: attachError } = await supabase
          .from('attachment_classifications')
          .upsert(attachClassData, { onConflict: 'attachment_id' })
          .select()
          .single();

        if (attachError) {
          console.error(`  Attachment error for ${attachment.id}: ${attachError.message}`);
        } else {
          attachClasses.push(attachClass);
        }
      }
    }

    if (verbose) {
      console.log(`  ✓ Email: ${result.emailType} (${result.emailTypeConfidence}%)`);
      if (attachClasses.length > 0) {
        console.log(`  ✓ Document: ${result.documentType} (${result.documentConfidence}%)`);
      }
    }

    return { success: true, emailClass, attachClasses };
  } catch (error) {
    console.error(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    return { success: false, emailClass: null, attachClasses: [] };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const sampleMode = args.includes('--sample');
  const allMode = args.includes('--all');
  const sampleSize = sampleMode ? parseInt(args[args.indexOf('--sample') + 1] || '10') : 10;

  console.log('RECLASSIFY EMAILS - PARALLEL CLASSIFICATION TABLES');
  console.log('='.repeat(70));

  if (!sampleMode && !allMode) {
    console.log('\nUsage:');
    console.log('  npx tsx scripts/reclassify-emails.ts --sample 10   # Test on 10 emails');
    console.log('  npx tsx scripts/reclassify-emails.ts --all         # Run on all emails');
    return;
  }

  // Get emails to process
  let query = supabase
    .from('raw_emails')
    .select('id, thread_id, subject, sender_email, sender_name, true_sender_email, body_text, received_at, has_attachments, is_response')
    .order('received_at', { ascending: false });

  if (sampleMode) {
    query = query.limit(sampleSize);
    console.log(`\nProcessing ${sampleSize} sample emails...\n`);
  } else {
    console.log('\nProcessing ALL emails...\n');
  }

  const { data: emails, error: emailError } = await query;

  if (emailError) {
    console.error('Failed to fetch emails:', emailError.message);
    return;
  }

  console.log(`Found ${emails?.length || 0} emails to process\n`);

  let processed = 0;
  let success = 0;
  let failed = 0;
  const stats = {
    emailTypes: new Map<string, number>(),
    documentTypes: new Map<string, number>(),
    withAttachments: 0,
    original: 0,
    replies: 0,
  };

  for (const email of emails || []) {
    processed++;

    // Get attachments for this email
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('id, filename, extracted_text')
      .eq('email_id', email.id);

    const prefix = `[${processed}/${emails?.length}]`;
    const isRe = email.is_response ? 'RE' : 'ORIG';
    const hasAtt = email.has_attachments ? '📎' : '  ';

    console.log(`${prefix} ${isRe} ${hasAtt} ${email.subject?.substring(0, 50) || '-'}`);

    const result = await classifyEmail(email, attachments || [], true);

    if (result.success) {
      success++;

      // Track stats
      const emailType = result.emailClass?.email_type || 'unknown';
      stats.emailTypes.set(emailType, (stats.emailTypes.get(emailType) || 0) + 1);

      if (result.attachClasses.length > 0) {
        stats.withAttachments++;
        const docType = result.attachClasses[0]?.document_type || 'unclassified';
        stats.documentTypes.set(docType, (stats.documentTypes.get(docType) || 0) + 1);
      }

      if (result.emailClass?.is_original) {
        stats.original++;
      } else {
        stats.replies++;
      }
    } else {
      failed++;
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  console.log(`\nProcessed: ${processed}`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);

  console.log(`\nOriginal emails: ${stats.original}`);
  console.log(`Reply emails: ${stats.replies}`);
  console.log(`With attachments: ${stats.withAttachments}`);

  console.log('\nEmail Types:');
  for (const [type, count] of [...stats.emailTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log('\nDocument Types:');
  for (const [type, count] of [...stats.documentTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Verify data in tables
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION');
  console.log('='.repeat(70));

  const { count: emailClassCount } = await supabase
    .from('email_classifications')
    .select('*', { count: 'exact', head: true });

  const { count: attachClassCount } = await supabase
    .from('attachment_classifications')
    .select('*', { count: 'exact', head: true });

  console.log(`\nemail_classifications: ${emailClassCount} records`);
  console.log(`attachment_classifications: ${attachClassCount} records`);
}

main().catch(console.error);
