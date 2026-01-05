/**
 * Fix Misclassifications - Targeted reclassification
 * Fixes emails where subject pattern clearly indicates correct type
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Pattern → Correct Type mapping (ORDER MATTERS - most specific FIRST)
const PATTERNS: Array<{ pattern: RegExp; correctType: string }> = [
  // SI DRAFT (from shipper for approval) - HIGHEST PRIORITY
  { pattern: /\bchecklist\s+(for\s+)?(approval|review)/i, correctType: 'si_draft' },
  { pattern: /\bSIL\s*&\s*VGM/i, correctType: 'si_draft' },
  { pattern: /\bSI\s+draft/i, correctType: 'si_draft' },
  { pattern: /\bdraft\s+SI\b/i, correctType: 'si_draft' },
  { pattern: /\bSI\s+for\s+(approval|review)/i, correctType: 'si_draft' },
  // HBL DRAFT (to shipper for approval)
  { pattern: /\bBL\s+DRAFT\s+FOR\b/i, correctType: 'hbl_draft' },
  { pattern: /\bARRANGE\s+BL\s+DRAFT/i, correctType: 'hbl_draft' },
  { pattern: /\bHBL\s+draft/i, correctType: 'hbl_draft' },
  { pattern: /\bdraft\s+(HBL|B\/L|BL)\b/i, correctType: 'hbl_draft' },
  { pattern: /\bBL\s+for\s+(your\s+)?(approval|review)/i, correctType: 'hbl_draft' },
  { pattern: /\bmodification.*draft\s+BL/i, correctType: 'hbl_draft' },
  // EXPLICIT DOCUMENT NAMES
  { pattern: /\barrival\s+notice\b/i, correctType: 'arrival_notice' },
  { pattern: /\bnotice\s+of\s+arrival\b/i, correctType: 'arrival_notice' },
  { pattern: /\bPRE-?ALERT\b/i, correctType: 'arrival_notice' },
  { pattern: /\bSOB\s+CONFIRM/i, correctType: 'sob_confirmation' },
  { pattern: /\bSOB\s+for\b/i, correctType: 'sob_confirmation' },
  { pattern: /\bshipped\s+on\s+board/i, correctType: 'sob_confirmation' },
  { pattern: /\bon\s*board\s+confirm/i, correctType: 'sob_confirmation' },
  // BILL OF LADING (release/copy - NOT draft)
  { pattern: /Seaway\s+BL\s+Release/i, correctType: 'bill_of_lading' },
  { pattern: /\bBL\s+(Release|Copy|Surrender)/i, correctType: 'bill_of_lading' },
  { pattern: /\bHBL\s*#/i, correctType: 'bill_of_lading' },
  { pattern: /\bMBL\s*#/i, correctType: 'bill_of_lading' },
  { pattern: /\bbill\s+of\s+lading\b/i, correctType: 'bill_of_lading' },
  { pattern: /\bB\/L\s+(release|copy)/i, correctType: 'bill_of_lading' },
  // Delivery Order
  { pattern: /\bdelivery\s+order\b/i, correctType: 'delivery_order' },
  { pattern: /\bD\.?O\.?\s+(Release|Issued)/i, correctType: 'delivery_order' },
  { pattern: /\bNEED\s+D\.?O\.?\s+URGENT/i, correctType: 'delivery_order' },
  // Shipment Notice (operational)
  { pattern: /\bWork\s+Order\s*:/i, correctType: 'shipment_notice' },
  // VGM
  { pattern: /\bVGM\s+(confirm|accept|submission)/i, correctType: 'vgm_confirmation' },
  // Booking Amendment
  { pattern: /\b(1st|2nd|3rd|\d+th)\s+UPDATE\b/i, correctType: 'booking_amendment' },
  { pattern: /\brollover\b/i, correctType: 'booking_amendment' },
  // Booking Cancellation
  { pattern: /\bbooking.*cancel/i, correctType: 'booking_cancellation' },
  { pattern: /\bcancel.*booking/i, correctType: 'booking_cancellation' },
  // Invoice (only clear patterns)
  { pattern: /\bfreight\s+invoice\b/i, correctType: 'invoice' },
  { pattern: /\binvoice\s*#\s*[A-Z0-9-]+/i, correctType: 'invoice' },
  // Shipping Instruction
  { pattern: /\bSI\s+(submission|confirm|draft|approved)/i, correctType: 'shipping_instruction' },
  { pattern: /\bshipping\s+instruction/i, correctType: 'shipping_instruction' },
];

function getCorrectType(subject: string): string | null {
  for (const { pattern, correctType } of PATTERNS) {
    if (pattern.test(subject)) {
      return correctType;
    }
  }
  return null;
}

const PAGE_SIZE = 1000;

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await supabase.from(table).select(select).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data && data.length > 0) {
      all = all.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return all;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              FIX MISCLASSIFICATIONS (Round 1)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Fetch data
  console.log('Fetching data...');
  const [emails, classifications] = await Promise.all([
    fetchAll<{ id: string; subject: string }>('raw_emails', 'id, subject'),
    fetchAll<{ email_id: string; document_type: string }>('document_classifications', 'email_id, document_type'),
  ]);

  const classMap = new Map(classifications.map(c => [c.email_id, c.document_type]));
  console.log(`Emails: ${emails.length}, Classifications: ${classifications.length}\n`);

  // Find and fix misclassifications
  let fixed = 0;
  const changes: Record<string, number> = {};

  for (const email of emails) {
    if (!email.subject) continue;

    const correctType = getCorrectType(email.subject);
    if (!correctType) continue;

    const currentType = classMap.get(email.id);
    if (!currentType || currentType === correctType) continue;

    // Fix it
    const { error } = await supabase
      .from('document_classifications')
      .update({
        document_type: correctType,
        confidence_score: 95,
        model_name: 'deterministic',
        model_version: 'v3|pattern_fix',
        classification_reason: `Subject pattern fix: was ${currentType}`,
        classified_at: new Date().toISOString(),
      })
      .eq('email_id', email.id);

    if (!error) {
      // Also update shipment_documents
      await supabase
        .from('shipment_documents')
        .update({ document_type: correctType })
        .eq('email_id', email.id);

      fixed++;
      const key = `${currentType} → ${correctType}`;
      changes[key] = (changes[key] || 0) + 1;
    }
  }

  // Report
  console.log('Changes made:');
  console.log('─'.repeat(60));
  Object.entries(changes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([change, count]) => console.log(`  ${change}: ${count}`));

  console.log(`\n✓ Fixed ${fixed} misclassifications`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
