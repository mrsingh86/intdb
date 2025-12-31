#!/usr/bin/env npx tsx
/**
 * Check cutoff field coverage on shipments
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com', 'maersk.com', 'msc.com',
  'cma-cgm.com', 'evergreen-line.com', 'oocl.com', 'cosco.com',
  'yangming.com', 'one-line.com', 'zim.com', 'hmm21.com',
  'pilship.com', 'wanhai.com', 'sitc.com',
];

async function checkCutoffs() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SHIPMENT CUTOFF COVERAGE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get all shipments with cutoff fields
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, doc_cutoff, created_from_email_id');

  const total = shipments?.length || 0;
  let hasSI = 0, hasVGM = 0, hasCargo = 0, hasGate = 0, hasDoc = 0;
  let hasAnyCutoff = 0;
  let hasAllCutoffs = 0;

  for (const s of shipments || []) {
    if (s.si_cutoff) hasSI++;
    if (s.vgm_cutoff) hasVGM++;
    if (s.cargo_cutoff) hasCargo++;
    if (s.gate_cutoff) hasGate++;
    if (s.doc_cutoff) hasDoc++;

    const cutoffs = [s.si_cutoff, s.vgm_cutoff, s.cargo_cutoff, s.gate_cutoff, s.doc_cutoff];
    if (cutoffs.some(c => c)) hasAnyCutoff++;
    if (cutoffs.filter(c => c).length >= 3) hasAllCutoffs++;
  }

  console.log('CUTOFF FIELD COVERAGE:');
  console.log('─'.repeat(60));
  console.log(`  si_cutoff:    ${hasSI}/${total} (${Math.round(hasSI/total*100)}%)`);
  console.log(`  vgm_cutoff:   ${hasVGM}/${total} (${Math.round(hasVGM/total*100)}%)`);
  console.log(`  cargo_cutoff: ${hasCargo}/${total} (${Math.round(hasCargo/total*100)}%)`);
  console.log(`  gate_cutoff:  ${hasGate}/${total} (${Math.round(hasGate/total*100)}%)`);
  console.log(`  doc_cutoff:   ${hasDoc}/${total} (${Math.round(hasDoc/total*100)}%)`);
  console.log('');
  console.log(`  Has ANY cutoff:  ${hasAnyCutoff}/${total} (${Math.round(hasAnyCutoff/total*100)}%)`);
  console.log(`  Has 3+ cutoffs:  ${hasAllCutoffs}/${total} (${Math.round(hasAllCutoffs/total*100)}%)`);
  console.log('');

  // Compare direct carrier shipments vs forwarded
  let directWithCutoffs = 0, directTotal = 0;
  let forwardWithCutoffs = 0, forwardTotal = 0;

  for (const s of shipments || []) {
    if (!s.created_from_email_id) continue;

    const { data: email } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email')
      .eq('id', s.created_from_email_id)
      .single();

    if (!email) continue;

    // Check true_sender_email first (for emails via ops group), then sender_email
    const trueDomain = email.true_sender_email?.toLowerCase().split('@')[1] || '';
    const senderDomain = email.sender_email?.toLowerCase().split('@')[1] || '';
    const isDirect = DIRECT_CARRIER_DOMAINS.some(d => trueDomain.includes(d) || senderDomain.includes(d));
    const hasCutoffs = s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff || s.gate_cutoff;

    if (isDirect) {
      directTotal++;
      if (hasCutoffs) directWithCutoffs++;
    } else {
      forwardTotal++;
      if (hasCutoffs) forwardWithCutoffs++;
    }
  }

  console.log('CUTOFF COVERAGE BY SOURCE:');
  console.log('─'.repeat(60));
  const directPct = directTotal > 0 ? Math.round(directWithCutoffs/directTotal*100) : 0;
  const forwardPct = forwardTotal > 0 ? Math.round(forwardWithCutoffs/forwardTotal*100) : 0;
  console.log(`  Direct carrier shipments:  ${directWithCutoffs}/${directTotal} with cutoffs (${directPct}%)`);
  console.log(`  Forwarded shipments:       ${forwardWithCutoffs}/${forwardTotal} with cutoffs (${forwardPct}%)`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

checkCutoffs().catch(console.error);
