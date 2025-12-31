#!/usr/bin/env npx tsx
/**
 * Verify that the true_sender_email fix improves direct carrier detection
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com', 'msc.com', 'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com', 'cosco.com', 'coscoshipping.com',
  'yangming.com', 'one-line.com', 'zim.com',
  'hmm21.com', 'pilship.com', 'wanhai.com', 'sitc.com',
];

function isDirectCarrierNew(trueSender: string | null, sender: string | null): boolean {
  // Check true_sender_email first
  if (trueSender) {
    const domain = trueSender.toLowerCase().split('@')[1] || '';
    if (DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d))) {
      return true;
    }
  }
  // Fallback to sender_email
  if (sender) {
    const domain = sender.toLowerCase().split('@')[1] || '';
    return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
  }
  return false;
}

function isDirectCarrierOld(sender: string | null): boolean {
  if (!sender) return false;
  const domain = sender.toLowerCase().split('@')[1] || '';
  return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
}

async function verify() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('VERIFICATION: Direct Carrier Detection Fix (true_sender_email)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get booking confirmations
  const { data: bookings } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  let directUsingNew = 0;
  let directUsingOld = 0;
  let sampleNew: string[] = [];
  let sampleOld: string[] = [];

  for (const b of bookings || []) {
    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email, subject')
      .eq('id', b.email_id)
      .single();

    if (!email) continue;

    const newResult = isDirectCarrierNew(email.true_sender_email, email.sender_email);
    const oldResult = isDirectCarrierOld(email.sender_email);

    if (newResult) directUsingNew++;
    if (oldResult) directUsingOld++;

    // Sample emails that NEW detects but OLD doesn't
    if (newResult && !oldResult && sampleNew.length < 5) {
      sampleNew.push(`  sender: ${email.sender_email}\n  true_sender: ${email.true_sender_email}\n  subject: ${(email.subject || '').substring(0, 50)}`);
    }
  }

  const total = bookings?.length || 0;
  const oldPct = Math.round(directUsingOld / total * 100);
  const newPct = Math.round(directUsingNew / total * 100);

  console.log(`Total booking confirmations: ${total}`);
  console.log('');
  console.log('DETECTION RESULTS:');
  console.log('─'.repeat(60));
  console.log(`  OLD method (sender_email only):       ${directUsingOld} (${oldPct}%)`);
  console.log(`  NEW method (true_sender + sender):    ${directUsingNew} (${newPct}%)`);
  console.log(`  IMPROVEMENT:                          +${directUsingNew - directUsingOld} more detected`);
  console.log('');

  if (sampleNew.length > 0) {
    console.log('EXAMPLES: Emails NEW detects but OLD missed (via ops group):');
    console.log('─'.repeat(60));
    sampleNew.forEach((s, i) => {
      console.log(`\n${i + 1}.`);
      console.log(s);
    });
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

verify().catch(console.error);
