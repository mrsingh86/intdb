#!/usr/bin/env npx tsx
/**
 * Analyze data completeness for DIRECT carrier emails only
 * (Not internal Intoglo forwards)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Known carrier domains (direct from shipping lines)
const CARRIER_DOMAINS = [
  'service.hlag.com',      // Hapag-Lloyd
  'hapag-lloyd.com',
  'maersk.com',            // Maersk
  'msc.com',               // MSC
  'cma-cgm.com',           // CMA CGM
  'evergreen-line.com',    // Evergreen
  'oocl.com',              // OOCL
  'cosco.com',             // COSCO
  'yangming.com',          // Yang Ming
  'one-line.com',          // ONE
  'zim.com',               // ZIM
  'hmm21.com',             // HMM
  'pilship.com',           // PIL
  'wanhai.com',            // Wan Hai
  'sitc.com',              // SITC
];

// Internal/forwarded domains to exclude
const INTERNAL_DOMAINS = [
  'intoglo.com',
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
];

async function analyze() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('DIRECT CARRIER EMAIL ANALYSIS');
  console.log('(Emails directly from shipping lines, NOT internal forwards)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all booking confirmation emails with sender info
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .eq('document_type', 'booking_confirmation');

  const emailIds = (bookingEmails || []).map(e => e.email_id);
  console.log(`Total booking confirmations: ${emailIds.length}`);

  // 2. Get sender info for each
  const directCarrierEmails: string[] = [];
  const forwardedEmails: string[] = [];
  const otherEmails: string[] = [];
  const carrierBreakdown: Record<string, string[]> = {};

  for (let i = 0; i < emailIds.length; i += 100) {
    const batch = emailIds.slice(i, i + 100);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, sender_email, subject')
      .in('id', batch);

    for (const email of emails || []) {
      const sender = email.sender_email?.toLowerCase() || '';
      const domain = sender.split('@')[1] || '';

      const isDirectCarrier = CARRIER_DOMAINS.some(d => domain.includes(d));
      const isInternal = INTERNAL_DOMAINS.some(d => domain.includes(d));

      if (isDirectCarrier) {
        directCarrierEmails.push(email.id);
        const carrierDomain = CARRIER_DOMAINS.find(d => domain.includes(d)) || domain;
        if (!carrierBreakdown[carrierDomain]) carrierBreakdown[carrierDomain] = [];
        carrierBreakdown[carrierDomain].push(email.id);
      } else if (isInternal) {
        forwardedEmails.push(email.id);
      } else {
        otherEmails.push(email.id);
      }
    }
  }

  console.log('');
  console.log('EMAIL SOURCE BREAKDOWN:');
  console.log('─'.repeat(60));
  console.log(`  Direct from carriers:   ${directCarrierEmails.length} (${Math.round(directCarrierEmails.length / emailIds.length * 100)}%)`);
  console.log(`  Internal/forwarded:     ${forwardedEmails.length} (${Math.round(forwardedEmails.length / emailIds.length * 100)}%)`);
  console.log(`  Other (shippers, etc):  ${otherEmails.length} (${Math.round(otherEmails.length / emailIds.length * 100)}%)`);
  console.log('');

  console.log('BY CARRIER:');
  console.log('─'.repeat(60));
  for (const [carrier, emails] of Object.entries(carrierBreakdown).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${carrier.padEnd(25)} ${emails.length}`);
  }
  console.log('');

  // 3. Get entity coverage for DIRECT carrier emails
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('DATA COMPLETENESS: DIRECT CARRIER EMAILS ONLY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const keyEntities = [
    'booking_number', 'bl_number', 'vessel_name', 'voyage_number',
    'port_of_loading', 'port_of_discharge', 'etd', 'eta',
    'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff',
    'shipper', 'consignee', 'container_number'
  ];

  const entityCoverage: Record<string, number> = {};
  for (const entity of keyEntities) {
    entityCoverage[entity] = 0;
  }

  // Check each direct carrier email
  for (let i = 0; i < directCarrierEmails.length; i += 100) {
    const batch = directCarrierEmails.slice(i, i + 100);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type')
      .in('email_id', batch);

    const entityByEmail = new Map<string, Set<string>>();
    for (const e of entities || []) {
      if (!entityByEmail.has(e.email_id)) {
        entityByEmail.set(e.email_id, new Set());
      }
      entityByEmail.get(e.email_id)!.add(e.entity_type);
    }

    for (const emailId of batch) {
      const emailEntities = entityByEmail.get(emailId) || new Set();
      for (const entity of keyEntities) {
        if (emailEntities.has(entity)) {
          entityCoverage[entity]++;
        }
      }
    }
  }

  console.log('ENTITY EXTRACTION COVERAGE (Direct Carrier Emails):');
  console.log('─'.repeat(60));
  const total = directCarrierEmails.length;
  const sorted = Object.entries(entityCoverage).sort((a, b) => b[1] - a[1]);

  for (const [entity, count] of sorted) {
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`  ${entity.padEnd(20)} ${bar} ${pct}% (${count}/${total})`);
  }

  // 4. Show samples of direct carrier emails WITHOUT cutoffs
  console.log('');
  console.log('');
  console.log('SAMPLE: Direct carrier emails WITHOUT cutoffs:');
  console.log('─'.repeat(60));

  const cutoffTypes = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];
  let samplesShown = 0;

  for (const emailId of directCarrierEmails) {
    if (samplesShown >= 5) break;

    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type')
      .eq('email_id', emailId)
      .in('entity_type', cutoffTypes);

    if (!entities || entities.length === 0) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject, sender_email')
        .eq('id', emailId)
        .single();

      console.log(`  Subject: ${(email?.subject || 'N/A').substring(0, 55)}`);
      console.log(`  Sender:  ${email?.sender_email}`);
      console.log('');
      samplesShown++;
    }
  }

  // 5. Compare: Direct vs Forwarded
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('COMPARISON: DIRECT vs FORWARDED');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Check cutoff coverage for forwarded emails
  let forwardedWithCutoffs = 0;
  for (let i = 0; i < forwardedEmails.length; i += 100) {
    const batch = forwardedEmails.slice(i, i + 100);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type')
      .in('email_id', batch)
      .in('entity_type', cutoffTypes);

    const emailsWithCutoffs = new Set((entities || []).map(e => e.email_id));
    forwardedWithCutoffs += emailsWithCutoffs.size;
  }

  // Check cutoff coverage for direct emails
  let directWithCutoffs = 0;
  for (let i = 0; i < directCarrierEmails.length; i += 100) {
    const batch = directCarrierEmails.slice(i, i + 100);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type')
      .in('email_id', batch)
      .in('entity_type', cutoffTypes);

    const emailsWithCutoffs = new Set((entities || []).map(e => e.email_id));
    directWithCutoffs += emailsWithCutoffs.size;
  }

  const directPct = Math.round((directWithCutoffs / directCarrierEmails.length) * 100);
  const forwardedPct = forwardedEmails.length > 0
    ? Math.round((forwardedWithCutoffs / forwardedEmails.length) * 100)
    : 0;

  console.log('CUTOFF DATA PRESENCE:');
  console.log('─'.repeat(60));
  console.log(`  Direct carrier emails:  ${directWithCutoffs}/${directCarrierEmails.length} have cutoffs (${directPct}%)`);
  console.log(`  Forwarded emails:       ${forwardedWithCutoffs}/${forwardedEmails.length} have cutoffs (${forwardedPct}%)`);
  console.log('');

  if (directPct > forwardedPct) {
    console.log(`  ✓ Direct carrier emails have ${directPct - forwardedPct}% MORE cutoff data`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

analyze().catch(console.error);
