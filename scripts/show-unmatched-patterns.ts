#!/usr/bin/env npx tsx
/**
 * Show unmatched email patterns to identify missing rules
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const RULES = [
  // MAERSK
  { carrier: 'maersk', pattern: /^Booking Confirmation\s*[:\-]/i },
  { carrier: 'maersk', pattern: /^Price overview - booking confirmation/i },
  { carrier: 'maersk', pattern: /^Booking Amendment\s*[:\-]/i },
  { carrier: 'maersk', pattern: /^Arrival notice/i },
  { carrier: 'maersk', pattern: /^New invoice/i },
  { carrier: 'maersk', pattern: /^Maersk Customer Advisory/i },

  // HAPAG-LLOYD
  { carrier: 'hapag', pattern: /^HL-\d+\s+[A-Z]{5}/i },
  { carrier: 'hapag', pattern: /^\[Update\] Booking/i },
  { carrier: 'hapag', pattern: /^Shipping Instruction Submitted/i },
  { carrier: 'hapag', pattern: /^BL HLCL Sh#/i },
  { carrier: 'hapag', pattern: /^SW HLCL Sh#/i },
  { carrier: 'hapag', pattern: /^HLCL Sh#/i },
  { carrier: 'hapag', pattern: /^\d+ INTOG[LO] 001 HLCU/i },

  // CMA CGM
  { carrier: 'cma', pattern: /^CMA CGM - Booking confirmation available/i },
  { carrier: 'cma', pattern: /^CMA CGM - Shipping instruction submitted/i },
  { carrier: 'cma', pattern: /^CMA CGM - Arrival notice/i },
  { carrier: 'cma', pattern: /^CMA-CGM Freight Invoice/i },

  // COSCO
  { carrier: 'cosco', pattern: /^Cosco Shipping Line Booking Confirmation/i },
  { carrier: 'cosco', pattern: /^Cosco Shipping Line -Shipment Notice/i },
  { carrier: 'cosco', pattern: /^COSCO Arrival Notice/i },
  { carrier: 'cosco', pattern: /^COSCON - (Proforma |Copy )?Bill of Lading/i },
  { carrier: 'cosco', pattern: /^PROD_Invoice/i },
];

async function main() {
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email');

  const unmatched: Record<string, string[]> = {
    'Maersk': [],
    'Hapag-Lloyd': [],
    'CMA CGM': [],
    'COSCO': [],
  };

  for (const e of emails || []) {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();
    const subject = e.subject || '';

    let carrier = '';
    let carrierName = '';
    if (sender.includes('maersk.com')) { carrier = 'maersk'; carrierName = 'Maersk'; }
    else if (sender.includes('hapag') || sender.includes('hlag')) { carrier = 'hapag'; carrierName = 'Hapag-Lloyd'; }
    else if (sender.includes('cma-cgm')) { carrier = 'cma'; carrierName = 'CMA CGM'; }
    else if (sender.includes('coscon')) { carrier = 'cosco'; carrierName = 'COSCO'; }
    else continue;

    // Check if matches any rule
    const matched = RULES.some(r => r.carrier === carrier && r.pattern.test(subject));
    if (!matched) {
      unmatched[carrierName].push(subject);
    }
  }

  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║            UNMATCHED EMAIL SUBJECTS BY CARRIER                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  for (const [carrier, subjects] of Object.entries(unmatched)) {
    console.log('\n' + '═'.repeat(70));
    console.log(carrier + ' - UNMATCHED (' + subjects.length + ')');
    console.log('═'.repeat(70));

    // Group similar subjects
    const groups: Record<string, number> = {};
    for (const s of subjects) {
      // Normalize - remove booking numbers
      let norm = s.substring(0, 50);
      norm = norm.replace(/[A-Z0-9]{8,}/g, 'XXX');
      norm = norm.replace(/\d{6,}/g, 'NNN');
      groups[norm] = (groups[norm] || 0) + 1;
    }

    // Show top groups
    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 20);
    for (const [pattern, count] of sorted) {
      console.log('  [' + count + '] ' + pattern);
    }
  }
}

main().catch(console.error);
