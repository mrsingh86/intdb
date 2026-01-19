/**
 * Pipeline Fix Script
 *
 * Runs both EMAIL and DOCUMENT pipelines to fix all issues:
 * 1. Flag unflagged emails (11 emails missing flags)
 * 2. Extract pending PDFs (211 pending)
 * 3. Process emails (classification + extraction + linking)
 * 4. Create shipments from booking confirmations
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Import services
import { createFlaggingOrchestrator } from '../lib/services/flagging-orchestrator';
import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';

async function runFixes() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           INTDB PIPELINE FIX SCRIPT                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  // ============================================
  // FIX 1: Flag unflagged emails
  // ============================================
  console.log('═══ FIX 1: FLAG UNFLAGGED EMAILS ═══');

  const flaggingOrchestrator = createFlaggingOrchestrator(supabase);

  // Get unflagged emails
  const { data: unflagged } = await supabase
    .from('raw_emails')
    .select('id')
    .is('clean_subject', null)
    .limit(100);

  const unflaggedCount = unflagged?.length || 0;
  console.log('Unflagged emails found: ' + unflaggedCount);

  if (unflaggedCount > 0) {
    const flagResult = await flaggingOrchestrator.flagBatch(
      unflagged!.map(e => e.id),
      (processed, total) => {
        if (processed % 10 === 0 || processed === total) {
          console.log('  Flagging progress: ' + processed + '/' + total);
        }
      }
    );
    console.log('Flagging complete:');
    console.log('  - Success: ' + flagResult.success);
    console.log('  - Failed: ' + flagResult.failed);
    console.log('  - Business attachments found: ' + flagResult.businessAttachmentsFound);
    console.log('  - Signature images filtered: ' + flagResult.signatureImagesFiltered);
  }

  // ============================================
  // FIX 2: Check attachment extraction status
  // ============================================
  console.log('\n═══ FIX 2: CHECK PDF EXTRACTION ═══');

  const { data: pendingPdfs } = await supabase
    .from('raw_attachments')
    .select('id, filename')
    .eq('extraction_status', 'pending')
    .eq('is_business_document', true)
    .limit(50);

  console.log('Pending business document PDFs: ' + (pendingPdfs?.length || 0));

  if ((pendingPdfs?.length || 0) > 0) {
    console.log('\n⚠️ PDF extraction requires Gmail API access.');
    console.log('   Run: curl http://localhost:3000/api/cron/extract-attachments');
    console.log('   Or wait for scheduled cron job.');

    // Show first few pending
    console.log('\nSample pending PDFs:');
    pendingPdfs?.slice(0, 5).forEach(p => {
      console.log('  - ' + p.filename);
    });
  }

  // ============================================
  // FIX 3: Process emails
  // ============================================
  console.log('\n═══ FIX 3: PROCESS EMAILS ═══');

  const orchestrator = new EmailProcessingOrchestrator(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await orchestrator.initialize();

  // Get emails needing processing
  const emailIds = await orchestrator.getEmailsNeedingProcessing(50);
  console.log('Emails needing processing: ' + emailIds.length);

  if (emailIds.length > 0) {
    console.log('Processing...');
    const results = await orchestrator.processBatch(emailIds, (processed, total) => {
      if (processed % 10 === 0 || processed === total) {
        console.log('  Progress: ' + processed + '/' + total);
      }
    });

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const shipmentsLinked = results.filter(r => r.shipmentId).length;

    console.log('Processing complete:');
    console.log('  - Succeeded: ' + succeeded);
    console.log('  - Failed: ' + failed);
    console.log('  - Shipments linked: ' + shipmentsLinked);

    // Show any errors
    const errors = results.filter(r => !r.success && r.error);
    if (errors.length > 0) {
      console.log('\nErrors:');
      errors.slice(0, 5).forEach(e => {
        console.log('  - ' + e.emailId.substring(0, 8) + ': ' + e.error);
      });
    }
  }

  // ============================================
  // SUMMARY: Post-fix status
  // ============================================
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                     POST-FIX STATUS                                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  // Check email direction
  const { data: dirCheck } = await supabase
    .from('raw_emails')
    .select('email_direction');
  const nullDirCount = dirCheck?.filter(e => !e.email_direction).length || 0;
  console.log('Email direction NULL: ' + nullDirCount + ' (was 11)');

  // Check clean_subject
  const { data: flagCheck } = await supabase
    .from('raw_emails')
    .select('clean_subject');
  const nullCleanCount = flagCheck?.filter(e => !e.clean_subject).length || 0;
  console.log('clean_subject NULL: ' + nullCleanCount + ' (was 11)');

  // Check extractions
  const { count: emailExtCount } = await supabase
    .from('email_extractions')
    .select('*', { count: 'exact', head: true });
  console.log('email_extractions: ' + (emailExtCount || 0) + ' (was 9)');

  const { count: docExtCount } = await supabase
    .from('document_extractions')
    .select('*', { count: 'exact', head: true });
  console.log('document_extractions: ' + (docExtCount || 0) + ' (was 0)');

  // Check shipments
  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });
  console.log('shipments: ' + (shipmentCount || 0) + ' (was 0)');

  // Check classifications
  const { count: emailClassCount } = await supabase
    .from('email_classifications')
    .select('*', { count: 'exact', head: true });
  console.log('email_classifications: ' + (emailClassCount || 0) + ' (was 13)');

  const { count: attClassCount } = await supabase
    .from('attachment_classifications')
    .select('*', { count: 'exact', head: true });
  console.log('attachment_classifications: ' + (attClassCount || 0) + ' (was 14)');
}

runFixes().catch(console.error);
