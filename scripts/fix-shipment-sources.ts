#!/usr/bin/env npx tsx
/**
 * Fix shipments created from forwarded emails
 *
 * Problem: ~67% of shipments were created from Intoglo forwards instead of
 * direct carrier emails. This means they may have incomplete data.
 *
 * Solution:
 * 1. Find shipments created from forwards
 * 2. Check if a direct carrier email exists for that booking
 * 3. If yes: update shipment with data from direct carrier email
 * 4. If no: leave as-is (may need to wait for direct carrier email)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Direct carrier domains
const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com',
  'msc.com',
  'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com',
  'cosco.com', 'coscoshipping.com',
  'yangming.com',
  'one-line.com',
  'zim.com',
  'hmm21.com',
  'pilship.com',
  'wanhai.com',
  'sitc.com',
];

function isDirectCarrier(trueSenderEmail: string | null, senderEmail: string | null): boolean {
  // Check true_sender_email first (for emails via ops group)
  if (trueSenderEmail) {
    const domain = trueSenderEmail.toLowerCase().split('@')[1] || '';
    if (DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d))) {
      return true;
    }
  }
  // Fallback to sender_email
  if (senderEmail) {
    const domain = senderEmail.toLowerCase().split('@')[1] || '';
    return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
  }
  return false;
}

async function fix() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('FIXING SHIPMENT SOURCES');
  console.log('Ensuring shipments are based on direct carrier emails');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all shipments with their creation email
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id')
    .order('created_at', { ascending: false });

  console.log(`Total shipments: ${shipments?.length || 0}`);

  let fromDirect = 0;
  let fromForward = 0;
  let noCreationEmail = 0;
  let fixed = 0;
  let cannotFix = 0;

  for (const shipment of shipments || []) {
    if (!shipment.created_from_email_id) {
      noCreationEmail++;
      continue;
    }

    // Get creation email sender (including true_sender_email for forwarded emails)
    const { data: creationEmail } = await supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email')
      .eq('id', shipment.created_from_email_id)
      .single();

    if (!creationEmail) {
      noCreationEmail++;
      continue;
    }

    if (isDirectCarrier(creationEmail.true_sender_email, creationEmail.sender_email)) {
      fromDirect++;
      continue;
    }

    // This shipment was created from a forward
    fromForward++;

    if (!shipment.booking_number) {
      cannotFix++;
      continue;
    }

    // Check if a direct carrier email exists for this booking
    const { data: directEmails } = await supabase
      .from('entity_extractions')
      .select('email_id')
      .eq('entity_type', 'booking_number')
      .eq('entity_value', shipment.booking_number);

    let foundDirectEmail: any = null;
    for (const e of directEmails || []) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('id, sender_email, true_sender_email')
        .eq('id', e.email_id)
        .single();

      if (email && isDirectCarrier(email.true_sender_email, email.sender_email)) {
        foundDirectEmail = email;
        break;
      }
    }

    if (foundDirectEmail) {
      // Update shipment to reference the direct carrier email
      await supabase
        .from('shipments')
        .update({
          created_from_email_id: foundDirectEmail.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', shipment.id);

      // Link both emails to shipment
      await supabase
        .from('shipment_documents')
        .upsert([
          {
            email_id: foundDirectEmail.id,
            shipment_id: shipment.id,
            document_type: 'booking_confirmation',
            is_source_of_truth: true,
            created_at: new Date().toISOString()
          },
          {
            email_id: shipment.created_from_email_id,
            shipment_id: shipment.id,
            document_type: 'booking_confirmation',
            is_source_of_truth: false,
            created_at: new Date().toISOString()
          }
        ], { onConflict: 'email_id,shipment_id' });

      fixed++;
      console.log(`  ✓ Fixed: ${shipment.booking_number} → direct carrier email`);
    } else {
      cannotFix++;
    }
  }

  console.log('');
  console.log('RESULTS:');
  console.log('─'.repeat(60));
  console.log(`  Already from direct carrier: ${fromDirect}`);
  console.log(`  From forwards:               ${fromForward}`);
  console.log(`    → Fixed (found direct):    ${fixed}`);
  console.log(`    → Cannot fix (no direct):  ${cannotFix}`);
  console.log(`  No creation email:           ${noCreationEmail}`);
  console.log('');

  // 2. Now link orphaned emails with cutoffs to their shipments
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('LINKING ORPHANED EMAILS WITH CUTOFFS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get emails with cutoffs that are not linked
  const cutoffTypes = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];
  const emailsWithCutoffs = new Set<string>();

  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('entity_extractions')
      .select('email_id')
      .in('entity_type', cutoffTypes)
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    data.forEach(e => emailsWithCutoffs.add(e.email_id));
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Get linked emails
  const linkedEmails = new Set<string>();
  offset = 0;
  while (true) {
    const { data } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .range(offset, offset + 999);

    if (!data || data.length === 0) break;
    data.forEach(l => linkedEmails.add(l.email_id));
    offset += 1000;
    if (data.length < 1000) break;
  }

  // Find orphaned emails with cutoffs
  const orphanedWithCutoffs: string[] = [];
  for (const emailId of emailsWithCutoffs) {
    if (!linkedEmails.has(emailId)) {
      orphanedWithCutoffs.push(emailId);
    }
  }

  console.log(`Emails with cutoffs but not linked: ${orphanedWithCutoffs.length}`);

  let linkedFromOrphans = 0;

  // Process in batches
  for (let i = 0; i < orphanedWithCutoffs.length; i += 100) {
    const batch = orphanedWithCutoffs.slice(i, i + 100);

    for (const emailId of batch) {
      // Get booking number from this email
      const { data: booking } = await supabase
        .from('entity_extractions')
        .select('entity_value')
        .eq('email_id', emailId)
        .eq('entity_type', 'booking_number')
        .single();

      if (!booking?.entity_value) continue;

      // Find matching shipment
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id')
        .eq('booking_number', booking.entity_value)
        .single();

      if (!shipment) continue;

      // Link email to shipment
      await supabase
        .from('shipment_documents')
        .upsert({
          email_id: emailId,
          shipment_id: shipment.id,
          document_type: 'cutoff_notification',
          created_at: new Date().toISOString()
        }, { onConflict: 'email_id,shipment_id' });

      linkedFromOrphans++;
    }
  }

  console.log(`  → Newly linked: ${linkedFromOrphans}`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('DONE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

fix().catch(console.error);
