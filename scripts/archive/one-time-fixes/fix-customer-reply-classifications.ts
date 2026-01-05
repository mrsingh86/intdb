/**
 * Fix Customer Reply Classifications
 *
 * Reclassifies thread replies (RE:/FW:) from non-carriers that were
 * incorrectly classified as booking_confirmation.
 *
 * These are customer/partner emails replying to booking threads,
 * NOT actual booking confirmation documents from carriers.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Carrier domains - only these can send booking_confirmation
const CARRIER_DOMAINS = [
  'maersk.com',
  'sealand.com',
  'hapag-lloyd.com',
  'hlag.com',
  'hlag.cloud',
  'service.hlag.com',
  'cma-cgm.com',
  'cmacgm-group.com',
  'apl.com',
  'coscon.com',
  'oocl.com',
  'msc.com',
  'evergreen-line.com',
  'one-line.com',
  'yangming.com',
  'zim.com',
  'smartmode.net',
];

// Intoglo domains (outbound, not misclassified)
const INTOGLO_DOMAINS = ['intoglo.com', 'intoglo.in'];

function isCarrierSender(email: string | null): boolean {
  if (!email) return false;
  const sender = email.toLowerCase();
  return CARRIER_DOMAINS.some(d => sender.includes(d));
}

function isIntogloSender(email: string | null): boolean {
  if (!email) return false;
  const sender = email.toLowerCase();
  return INTOGLO_DOMAINS.some(d => sender.includes(d));
}

function isThreadReply(subject: string | null): boolean {
  if (!subject) return false;
  return /^(re|fw|fwd):\s/i.test(subject);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('     FIX CUSTOMER REPLY CLASSIFICATIONS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Get all booking_confirmation and booking_amendment documents
  const { data: classifications, error: classError } = await supabase
    .from('document_classifications')
    .select('id, email_id, document_type, workflow_state')
    .in('document_type', ['booking_confirmation', 'booking_amendment']);

  if (classError) throw classError;
  console.log('Total booking documents:', classifications?.length || 0);

  if (!classifications?.length) return;

  // Get email details in batches (to avoid URL length limits)
  const emailIds = classifications.map(c => c.email_id);
  const BATCH_SIZE = 100;
  const emailMap = new Map<string, { id: string; subject: string; sender_email: string; true_sender_email: string }>();

  for (let i = 0; i < emailIds.length; i += BATCH_SIZE) {
    const batchIds = emailIds.slice(i, i + BATCH_SIZE);
    const { data: emails, error: emailError } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, true_sender_email')
      .in('id', batchIds);

    if (emailError) throw emailError;
    emails?.forEach(e => emailMap.set(e.id, e));

    if ((i / BATCH_SIZE + 1) % 5 === 0) {
      process.stdout.write(`  Fetched ${Math.min(i + BATCH_SIZE, emailIds.length)}/${emailIds.length} emails...\r`);
    }
  }
  console.log(`Fetched ${emailMap.size} email details`);

  // Find misclassified documents
  const toFix: Array<{
    classificationId: string;
    emailId: string;
    subject: string;
    sender: string;
    currentType: string;
  }> = [];

  for (const c of classifications) {
    const email = emailMap.get(c.email_id);
    if (!email) continue;

    const sender = email.true_sender_email || email.sender_email;
    const subject = email.subject;

    // Check if this is a thread reply from non-carrier, non-Intoglo sender
    if (isThreadReply(subject) && !isCarrierSender(sender) && !isIntogloSender(sender)) {
      toFix.push({
        classificationId: c.id,
        emailId: c.email_id,
        subject: subject || '',
        sender: sender || '',
        currentType: c.document_type,
      });
    }
  }

  console.log('Misclassified thread replies to fix:', toFix.length);

  if (toFix.length === 0) {
    console.log('\nNo misclassified documents found.');
    return;
  }

  // Show sample of what will be fixed
  console.log('\n─────────────────────────────────────────────────────────────────────');
  console.log('SAMPLE (first 10):');
  console.log('─────────────────────────────────────────────────────────────────────');

  for (const item of toFix.slice(0, 10)) {
    console.log(`\n  Type: ${item.currentType}`);
    console.log(`  Subject: ${item.subject.substring(0, 60)}...`);
    console.log(`  From: ${item.sender}`);
    console.log(`  → Will change to: general_correspondence`);
  }

  // Group by sender domain for summary
  const byDomain: Record<string, number> = {};
  toFix.forEach(item => {
    const domain = item.sender.split('@')[1] || 'unknown';
    byDomain[domain] = (byDomain[domain] || 0) + 1;
  });

  console.log('\n─────────────────────────────────────────────────────────────────────');
  console.log('BY SENDER DOMAIN:');
  console.log('─────────────────────────────────────────────────────────────────────');
  Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([domain, count]) => {
      console.log(`  ${domain.padEnd(35)} ${count}`);
    });

  // Apply fixes
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('APPLYING FIXES...');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  let fixed = 0;
  let errors = 0;

  for (const item of toFix) {
    const { error } = await supabase
      .from('document_classifications')
      .update({
        document_type: 'general_correspondence',
        workflow_state: null,  // general_correspondence has no workflow state
        classification_reason: `Reclassified: Thread reply (RE:/FW:) from non-carrier (${item.sender.split('@')[1]})`,
        model_version: 'v2|fix-customer-replies',
      })
      .eq('id', item.classificationId);

    if (error) {
      console.error(`Error fixing ${item.emailId}:`, error.message);
      errors++;
    } else {
      fixed++;
    }

    if (fixed % 50 === 0) {
      process.stdout.write(`  Fixed ${fixed}/${toFix.length}...\r`);
    }
  }

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`Documents fixed: ${fixed}`);
  console.log(`Errors: ${errors}`);
  console.log('\nThese customer/partner thread replies are now classified as');
  console.log('general_correspondence instead of booking_confirmation.');
}

main().catch(console.error);
