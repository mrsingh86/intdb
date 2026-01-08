/**
 * Fix Sender-Based Misclassifications
 *
 * Finds and fixes documents where the sender type doesn't match expectedSenders.
 * e.g., MBL from a shipper (should be from shipping_line only)
 *
 * Usage:
 *   npx tsx scripts/fix-sender-misclassifications.ts              # Dry run
 *   npx tsx scripts/fix-sender-misclassifications.ts --execute    # Apply fixes
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  identifySenderTypeFull,
  validateSenderForDocumentType,
  getDocumentConfig,
  SenderType,
} from '../lib/config/content-classification-config';
import { extractTrueSender } from '../lib/services/direction-detection/true-sender-extractor';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DRY_RUN = !process.argv.includes('--execute');

// Document types that should be validated (high-value types with strict expectedSenders)
const VALIDATE_TYPES = [
  'mbl',
  'draft_mbl',
  'hbl',
  'draft_hbl',
  'booking_confirmation',
  'booking_amendment',
  'booking_cancellation',
  'arrival_notice',
  'delivery_order',
  'sob_confirmation',
  'isf_filing',
  'us_customs_7501',
  'us_customs_3461',
  'india_shipping_bill',
  'india_leo',
];

interface SenderMismatch {
  docId: string;
  emailId: string;
  shipmentBooking: string;
  currentType: string;
  senderEmail: string;
  senderName: string;
  senderType: SenderType;
  expectedSenders: string[];
  reason: string;
}

async function main() {
  console.log('FIX SENDER-BASED MISCLASSIFICATIONS');
  console.log('='.repeat(70));
  console.log('Mode:', DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING');
  console.log('');

  // Step 1: Get all documents of types that need validation
  console.log('Step 1: Loading documents to validate...');
  const { data: docs, error } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      document_type,
      email_id,
      shipment_id,
      shipments!shipment_documents_shipment_id_fkey(booking_number),
      raw_emails!shipment_documents_email_id_fkey(
        sender_email,
        sender_name,
        true_sender_email,
        subject
      )
    `)
    .in('document_type', VALIDATE_TYPES)
    .not('shipment_id', 'is', null)
    .not('email_id', 'is', null);

  if (error) {
    console.error('Error loading documents:', error.message);
    return;
  }

  console.log(`  Loaded ${docs?.length || 0} documents to validate`);
  console.log('');

  // Step 2: Find sender mismatches
  console.log('Step 2: Checking sender types...');
  const mismatches: SenderMismatch[] = [];

  for (const doc of docs || []) {
    const email = (doc as any).raw_emails;
    const shipment = (doc as any).shipments;

    if (!email) continue;

    // Use the same true sender extraction logic as the classification pipeline
    const trueSenderResult = extractTrueSender(
      email.sender_email || '',
      email.sender_name,
      {} // No headers available in this query
    );

    // If true_sender_email is already populated and different, prefer that
    const trueSender = email.true_sender_email && email.true_sender_email !== email.sender_email
      ? email.true_sender_email
      : trueSenderResult.trueSender;

    // For sender type identification:
    // 1. First try the extracted trueSender (handles forwarded carrier emails)
    // 2. Then try the original sender_email with display name (handles direct emails)
    let senderType = identifySenderTypeFull(trueSender, email.sender_name);

    // If still unknown, try with original sender_email (for display name extraction)
    if (senderType === 'unknown' && email.sender_email && email.sender_email !== trueSender) {
      senderType = identifySenderTypeFull(email.sender_email, email.sender_name);
    }
    const validation = validateSenderForDocumentType(doc.document_type, senderType);

    if (!validation.valid) {
      const config = getDocumentConfig(doc.document_type);
      mismatches.push({
        docId: doc.id,
        emailId: doc.email_id,
        shipmentBooking: shipment?.booking_number || 'unknown',
        currentType: doc.document_type,
        senderEmail: trueSender,
        senderName: email.sender_name || '',
        senderType,
        expectedSenders: config?.expectedSenders || [],
        reason: validation.reason || 'Sender mismatch',
      });
    }
  }

  console.log(`  Found ${mismatches.length} sender mismatches`);
  console.log('');

  // Step 3: Show mismatches grouped by type
  if (mismatches.length > 0) {
    console.log('Step 3: Misclassifications by document type');
    console.log('-'.repeat(70));

    // Group by document type
    const byType = new Map<string, SenderMismatch[]>();
    for (const m of mismatches) {
      const existing = byType.get(m.currentType) || [];
      existing.push(m);
      byType.set(m.currentType, existing);
    }

    for (const [docType, items] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const config = getDocumentConfig(docType);
      console.log(`\n${docType} (${items.length} docs) - Expected senders: [${config?.expectedSenders?.join(', ')}]`);

      for (const item of items.slice(0, 5)) {
        console.log(`  ${item.shipmentBooking} | ${item.senderType} | ${item.senderEmail}`);
        console.log(`    Name: ${item.senderName}`);
      }
      if (items.length > 5) {
        console.log(`  ... and ${items.length - 5} more`);
      }
    }
    console.log('');
  }

  // Step 4: Apply fixes (reclassify to general_correspondence)
  if (!DRY_RUN && mismatches.length > 0) {
    console.log('Step 4: Applying fixes...');
    let fixed = 0;
    let errors = 0;

    for (const m of mismatches) {
      // Update shipment_documents
      const { error: docError } = await supabase
        .from('shipment_documents')
        .update({ document_type: 'general_correspondence' })
        .eq('id', m.docId);

      // Also update document_classifications if exists
      await supabase
        .from('document_classifications')
        .update({ document_type: 'general_correspondence' })
        .eq('email_id', m.emailId);

      if (!docError) {
        fixed++;
      } else {
        errors++;
        console.error(`  Error fixing ${m.docId}: ${docError.message}`);
      }
    }

    console.log(`  Fixed: ${fixed}`);
    console.log(`  Errors: ${errors}`);
  }

  // Summary
  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total documents validated: ${docs?.length || 0}`);
  console.log(`Sender mismatches found: ${mismatches.length}`);

  // Count by sender type
  const bySenderType = new Map<string, number>();
  for (const m of mismatches) {
    bySenderType.set(m.senderType, (bySenderType.get(m.senderType) || 0) + 1);
  }

  if (bySenderType.size > 0) {
    console.log('\nBy sender type:');
    for (const [type, count] of [...bySenderType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN - No changes made. Run with --execute to apply.');
  }
}

main().catch(console.error);
