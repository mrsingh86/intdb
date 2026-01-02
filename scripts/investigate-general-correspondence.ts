/**
 * Investigate general_correspondence - find misclassified valuable documents
 */
import { supabase, fetchAll, fetchByIds, isIntoglo } from './lib/supabase';

// Patterns that suggest a specific document type
const VALUABLE_PATTERNS: Array<{ pattern: RegExp; suggestedType: string }> = [
  // SI Draft
  { pattern: /\bchecklist\s+(for\s+)?(approval|review)/i, suggestedType: 'si_draft' },
  { pattern: /\bSIL\s*&\s*VGM/i, suggestedType: 'si_draft' },
  { pattern: /\bSI\s+draft/i, suggestedType: 'si_draft' },
  // HBL Draft
  { pattern: /\bBL\s+DRAFT/i, suggestedType: 'hbl_draft' },
  { pattern: /\bdraft\s+(HBL|B\/L|BL)\b/i, suggestedType: 'hbl_draft' },
  // SOB
  { pattern: /\bSOB\s+CONFIRM/i, suggestedType: 'sob_confirmation' },
  { pattern: /\bshipped\s+on\s+board/i, suggestedType: 'sob_confirmation' },
  // Arrival Notice
  { pattern: /\barrival\s+notice\b/i, suggestedType: 'arrival_notice' },
  { pattern: /\bPRE-?ALERT/i, suggestedType: 'arrival_notice' },
  // Bill of Lading
  { pattern: /\bBL\s+(Release|Copy|Surrender)/i, suggestedType: 'bill_of_lading' },
  { pattern: /\bHBL\s*#/i, suggestedType: 'bill_of_lading' },
  { pattern: /\bMBL\s*#/i, suggestedType: 'bill_of_lading' },
  // Booking
  { pattern: /\bbooking\s+confirm/i, suggestedType: 'booking_confirmation' },
  { pattern: /\b(1st|2nd|3rd|\d+th)\s+UPDATE\b/i, suggestedType: 'booking_amendment' },
  // Delivery Order
  { pattern: /\bdelivery\s+order\b/i, suggestedType: 'delivery_order' },
  { pattern: /\bNEED\s+D\.?O\.?\s+URGENT/i, suggestedType: 'delivery_order' },
  { pattern: /\bD\.?O\.?\s+REQUEST/i, suggestedType: 'delivery_order' },
  // VGM
  { pattern: /\bVGM\s+(confirm|submit|accept)/i, suggestedType: 'vgm_submission' },
  // Invoice
  { pattern: /\bfreight\s+invoice\b/i, suggestedType: 'invoice' },
  { pattern: /\binvoice\s*#/i, suggestedType: 'invoice' },
  // Customs
  { pattern: /\bcustoms?\s+(clear|release|hold)/i, suggestedType: 'customs_document' },
  { pattern: /\bCUSTOM\s+HOLD/i, suggestedType: 'customs_document' },
  // Work Order (operational)
  { pattern: /\bWork\s+Order\s*:/i, suggestedType: 'shipment_notice' },
];

async function main() {
  console.log('═'.repeat(70));
  console.log('INVESTIGATING GENERAL_CORRESPONDENCE');
  console.log('═'.repeat(70));

  // Get general_correspondence emails
  const gcDocs = await fetchAll<{ email_id: string }>(
    'document_classifications',
    'email_id',
    { column: 'document_type', op: 'eq', value: 'general_correspondence' }
  );

  console.log('\nTotal general_correspondence:', gcDocs.length);

  // Get email details
  const emailIds = gcDocs.map(d => d.email_id);
  const emails = await fetchByIds<{ id: string; subject: string; sender_email: string }>(
    'raw_emails',
    'id, subject, sender_email',
    'id',
    emailIds
  );

  console.log('Emails fetched:', emails.length);

  // Check for valuable patterns
  const potentialMisclassifications: Array<{
    emailId: string;
    subject: string;
    sender: string;
    suggestedType: string;
    pattern: string;
  }> = [];

  for (const email of emails) {
    if (!email.subject) continue;

    for (const { pattern, suggestedType } of VALUABLE_PATTERNS) {
      if (pattern.test(email.subject)) {
        potentialMisclassifications.push({
          emailId: email.id,
          subject: email.subject,
          sender: email.sender_email || '',
          suggestedType,
          pattern: pattern.toString(),
        });
        break; // Only first match
      }
    }
  }

  // Group by suggested type
  const byType: Record<string, typeof potentialMisclassifications> = {};
  for (const m of potentialMisclassifications) {
    if (!byType[m.suggestedType]) byType[m.suggestedType] = [];
    byType[m.suggestedType].push(m);
  }

  console.log('\n📊 POTENTIAL MISCLASSIFICATIONS IN general_correspondence:');
  console.log('─'.repeat(70));

  const sortedTypes = Object.entries(byType).sort((a, b) => b[1].length - a[1].length);

  for (const [type, items] of sortedTypes) {
    console.log(`\n[${type}] - ${items.length} emails`);
    items.slice(0, 3).forEach(item => {
      const dir = isIntoglo(item.sender) ? '[OUT]' : '[IN]';
      console.log(`  ${dir} ${item.subject.substring(0, 55)}...`);
    });
    if (items.length > 3) {
      console.log(`  ... and ${items.length - 3} more`);
    }
  }

  // Summary
  const totalMisclassified = potentialMisclassifications.length;
  const noPattern = emails.length - totalMisclassified;

  console.log('\n═'.repeat(70));
  console.log('SUMMARY');
  console.log('─'.repeat(70));
  console.log('Total general_correspondence:', emails.length);
  console.log('Potentially misclassified:', totalMisclassified);
  console.log('True general correspondence:', noPattern);
  console.log('═'.repeat(70));

  // Show some true general correspondence samples
  console.log('\n📧 SAMPLES OF TRUE GENERAL CORRESPONDENCE (no pattern match):');
  console.log('─'.repeat(70));

  const trueGC = emails.filter(e =>
    !potentialMisclassifications.some(m => m.emailId === e.id)
  );

  trueGC.slice(0, 10).forEach((e, i) => {
    const dir = isIntoglo(e.sender_email) ? '[OUT]' : '[IN]';
    console.log(`${i + 1}. ${dir} ${(e.subject || 'No subject').substring(0, 60)}`);
  });
}

main().catch(console.error);
