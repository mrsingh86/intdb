/**
 * Explore HBL Draft shared with shipper
 *
 * Workflow: Intoglo creates HBL draft → shares with shipper for approval
 */
import { supabase, fetchAll, fetchByIds } from './lib/supabase';

async function main() {
  console.log('═'.repeat(80));
  console.log('HBL DRAFT SHARED WITH SHIPPER - EXPLORATION');
  console.log('═'.repeat(80));

  // Get all hbl_draft documents (with pagination)
  const hblDrafts = await fetchAll<{ email_id: string }>(
    'document_classifications',
    'email_id',
    { column: 'document_type', op: 'eq', value: 'hbl_draft' }
  );

  console.log('\nTotal hbl_draft classified:', hblDrafts.length);

  if (hblDrafts.length > 0) {
    // Get email details using shared helper
    const emailIds = hblDrafts.map(d => d.email_id);
    const emails = await fetchByIds<{ id: string; subject: string; sender_email: string; body_text: string; received_at: string }>(
      'raw_emails',
      'id, subject, sender_email, body_text, received_at',
      'id',
      emailIds
    );

    console.log('\n📧 CURRENT HBL DRAFT EMAILS:');
    console.log('─'.repeat(80));

    emails.forEach((e, i) => {
      console.log(`\n[${i + 1}] ${(e.subject || '').substring(0, 70)}`);
      console.log(`    From: ${e.sender_email}`);
      console.log(`    Date: ${e.received_at}`);
    });
  }

  // Now search for potential HBL draft patterns that might be missed
  console.log('\n\n═'.repeat(80));
  console.log('SEARCHING FOR POTENTIAL HBL DRAFT PATTERNS (may be missed)');
  console.log('═'.repeat(80));

  // Common patterns for HBL draft sharing
  const searchPatterns = [
    'BL draft',
    'draft BL',
    'HBL draft',
    'draft HBL',
    'BL for approval',
    'BL for review',
    'BL amendment',
    'BL correction',
    'please review BL',
    'attached BL',
    'BL attached',
  ];

  for (const pattern of searchPatterns) {
    const { data: matches, count } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email', { count: 'exact' })
      .ilike('subject', `%${pattern}%`)
      .limit(3);

    if (count && count > 0) {
      console.log(`\n"${pattern}" - ${count} matches:`);
      matches?.forEach(m => {
        const isIntoglo = (m.sender_email || '').toLowerCase().includes('intoglo');
        const direction = isIntoglo ? '[OUT]' : '[IN]';
        console.log(`  ${direction} ${(m.subject || '').substring(0, 60)}`);
      });
    }
  }

  // Check body text patterns
  console.log('\n\n═'.repeat(80));
  console.log('SEARCHING IN EMAIL BODY (for HBL draft keywords)');
  console.log('═'.repeat(80));

  const bodyPatterns = [
    'please review the attached BL',
    'draft BL for your approval',
    'HBL draft attached',
    'kindly approve the BL',
  ];

  for (const pattern of bodyPatterns) {
    const { count } = await supabase
      .from('raw_emails')
      .select('id', { count: 'exact', head: true })
      .ilike('body_text', `%${pattern}%`);

    console.log(`"${pattern}": ${count || 0} matches`);
  }

  // Check what Intoglo sends that contains "BL" in subject
  console.log('\n\n═'.repeat(80));
  console.log('INTOGLO OUTBOUND EMAILS WITH "BL" IN SUBJECT');
  console.log('═'.repeat(80));

  const { data: intogloBL } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .or('sender_email.ilike.%@intoglo.com%,sender_email.ilike.%@intoglo.in%')
    .ilike('subject', '%BL%')
    .limit(20);

  // Get classifications for these
  const emailIds = intogloBL?.map(e => e.id) || [];
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('email_id', emailIds);

  const classMap = new Map(classifications?.map(c => [c.email_id, c.document_type]) || []);

  console.log(`\nFound ${intogloBL?.length || 0} Intoglo emails with "BL" in subject:`);
  intogloBL?.forEach(e => {
    const docType = classMap.get(e.id) || 'unclassified';
    console.log(`  [${docType.padEnd(20)}] ${(e.subject || '').substring(0, 55)}`);
  });

  // Summary
  console.log('\n\n═'.repeat(80));
  console.log('SUMMARY & RECOMMENDATIONS');
  console.log('─'.repeat(80));
  console.log('Current hbl_draft count:', hblDrafts.length);
  console.log('\nTo improve HBL draft detection, consider adding patterns:');
  console.log('  - "please review" + "BL"');
  console.log('  - "BL for your approval"');
  console.log('  - "attached" + "BL draft"');
  console.log('  - Check email body for approval request language');
  console.log('═'.repeat(80));
}

main().catch(console.error);
