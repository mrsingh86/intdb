/**
 * Fix Document Misclassifications
 *
 * Updates document classifications based on subject line analysis.
 * Focuses on common misclassification patterns identified by the LLM judge.
 *
 * Usage:
 *   npx tsx scripts/fix-misclassifications.ts              # Dry run
 *   npx tsx scripts/fix-misclassifications.ts --execute    # Apply fixes
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

// Misclassification rules: [current_type, subject_pattern, correct_type, reason]
const RECLASSIFICATION_RULES: Array<{
  currentType: string;
  subjectPattern: RegExp;
  correctType: string;
  reason: string;
}> = [
  // Gate-in misclassified as shipment_notice
  {
    currentType: 'shipment_notice',
    subjectPattern: /gate[d\-\s]*in|gated\s+in/i,
    correctType: 'gate_in_confirmation',
    reason: 'Subject mentions gate-in, not departure',
  },
  // COSCO Shipment Notice with booking info → booking_confirmation
  {
    currentType: 'shipment_notice',
    subjectPattern: /Shipping Line.*Shipment Notice.*Booking|Booking.*Confirmation/i,
    correctType: 'booking_confirmation',
    reason: 'COSCO Shipment Notice with booking info is a booking confirmation',
  },
  // Arrival notice that's really a booking update
  {
    currentType: 'arrival_notice',
    subjectPattern: /cut\s*off|booking.*request|need.*cut\s*off/i,
    correctType: 'booking_amendment',
    reason: 'Subject mentions cutoff - likely booking update',
  },
  // Delivery order that's really a booking request
  {
    currentType: 'delivery_order',
    subjectPattern: /request.*for.*booking|booking.*request/i,
    correctType: 'booking_confirmation',
    reason: 'Subject mentions booking request, not delivery',
  },
  // Draft approval emails are SI drafts, not delivery orders
  {
    currentType: 'delivery_order',
    subjectPattern: /draft\s+for\s+approval/i,
    correctType: 'si_draft',
    reason: 'Draft approval emails are SI drafts',
  },
  // SOB confirmation misclassified
  {
    currentType: 'sob_confirmation',
    subjectPattern: /arrival|arrival\s+notice|arrived/i,
    correctType: 'arrival_notice',
    reason: 'Subject mentions arrival, not departure',
  },
  // Invoice misclassified as arrival notice
  {
    currentType: 'arrival_notice',
    subjectPattern: /invoice|payment|quote/i,
    correctType: 'invoice',
    reason: 'Subject mentions invoice/payment/quote',
  },
  // VGM copy/submission
  {
    currentType: 'general_correspondence',
    subjectPattern: /vgm\s+copy|vgm\s+submission|vgm\s+confirmation/i,
    correctType: 'vgm_confirmation',
    reason: 'Subject mentions VGM submission',
  },
  // BL draft
  {
    currentType: 'general_correspondence',
    subjectPattern: /hbl.*draft|draft.*hbl|bl\s+draft/i,
    correctType: 'hbl_draft',
    reason: 'Subject mentions HBL/BL draft',
  },
];

interface ReclassificationFix {
  docId: string;
  emailId: string;
  shipmentBooking: string;
  currentType: string;
  newType: string;
  subject: string;
  reason: string;
}

async function main() {
  console.log('FIX DOCUMENT MISCLASSIFICATIONS');
  console.log('='.repeat(70));
  console.log('Mode:', DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING');
  console.log('');

  // Step 1: Load all shipment documents with email subjects
  console.log('Step 1: Loading shipment documents...');
  const { data: docs, error } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      document_type,
      email_id,
      shipment_id,
      shipments!shipment_documents_shipment_id_fkey(booking_number),
      raw_emails!shipment_documents_email_id_fkey(subject)
    `)
    .not('shipment_id', 'is', null)
    .not('email_id', 'is', null);

  if (error) {
    console.error('Error loading documents:', error.message);
    return;
  }

  console.log(`  Loaded ${docs?.length || 0} documents`);
  console.log('');

  // Step 2: Find misclassifications
  console.log('Step 2: Finding misclassifications...');
  const fixes: ReclassificationFix[] = [];

  for (const doc of docs || []) {
    const email = (doc as any).raw_emails;
    const shipment = (doc as any).shipments;
    const subject = email?.subject || '';

    for (const rule of RECLASSIFICATION_RULES) {
      if (doc.document_type === rule.currentType && rule.subjectPattern.test(subject)) {
        fixes.push({
          docId: doc.id,
          emailId: doc.email_id,
          shipmentBooking: shipment?.booking_number || 'unknown',
          currentType: doc.document_type,
          newType: rule.correctType,
          subject: subject.substring(0, 60),
          reason: rule.reason,
        });
        break; // Only apply first matching rule
      }
    }
  }

  console.log(`  Found ${fixes.length} misclassifications`);
  console.log('');

  // Step 3: Show fixes
  if (fixes.length > 0) {
    console.log('Step 3: Reclassifications to apply');
    console.log('-'.repeat(70));

    // Group by type change
    const byChange = new Map<string, ReclassificationFix[]>();
    for (const fix of fixes) {
      const key = `${fix.currentType} → ${fix.newType}`;
      const existing = byChange.get(key) || [];
      existing.push(fix);
      byChange.set(key, existing);
    }

    for (const [change, items] of byChange) {
      console.log(`\n${change} (${items.length} docs):`);
      for (const fix of items.slice(0, 5)) {
        console.log(`  ${fix.shipmentBooking} | ${fix.subject}...`);
        console.log(`    Reason: ${fix.reason}`);
      }
      if (items.length > 5) {
        console.log(`  ... and ${items.length - 5} more`);
      }
    }
    console.log('');
  }

  // Step 4: Apply fixes
  if (!DRY_RUN && fixes.length > 0) {
    console.log('Step 4: Applying fixes...');
    let fixed = 0;

    for (const fix of fixes) {
      // Update shipment_documents
      const { error: docError } = await supabase
        .from('shipment_documents')
        .update({ document_type: fix.newType })
        .eq('id', fix.docId);

      // Also update document_classifications if exists
      await supabase
        .from('document_classifications')
        .update({ document_type: fix.newType })
        .eq('email_id', fix.emailId);

      if (!docError) {
        fixed++;
      } else {
        console.error(`  Error fixing ${fix.docId}: ${docError.message}`);
      }
    }

    console.log(`  Fixed ${fixed}/${fixes.length} documents`);
  }

  // Summary
  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Misclassifications found: ${fixes.length}`);

  // Count by type change
  const typeCounts = new Map<string, number>();
  for (const fix of fixes) {
    const key = `${fix.currentType} → ${fix.newType}`;
    typeCounts.set(key, (typeCounts.get(key) || 0) + 1);
  }

  console.log('\nBy type change:');
  for (const [change, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${change}: ${count}`);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN - No changes made. Run with --execute to apply.');
  }
}

main().catch(console.error);
