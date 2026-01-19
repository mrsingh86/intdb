#!/usr/bin/env npx tsx
/**
 * Count BC-type emails using deterministic subject pattern rules
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface ClassificationRule {
  carrier: string;
  type: string;
  pattern: RegExp;
}

const RULES: ClassificationRule[] = [
  // MAERSK
  { carrier: 'maersk', type: 'booking_confirmation', pattern: /^Booking Confirmation\s*[:\-]/i },
  { carrier: 'maersk', type: 'booking_confirmation', pattern: /^Price overview - booking confirmation/i },
  { carrier: 'maersk', type: 'booking_amendment', pattern: /^Booking Amendment\s*[:\-]/i },
  { carrier: 'maersk', type: 'arrival_notice', pattern: /^Arrival notice/i },
  { carrier: 'maersk', type: 'invoice', pattern: /^New invoice/i },
  { carrier: 'maersk', type: 'advisory', pattern: /^Maersk Customer Advisory/i },

  // HAPAG-LLOYD
  { carrier: 'hapag', type: 'booking_confirmation', pattern: /^HL-\d+\s+[A-Z]{5}/i },
  { carrier: 'hapag', type: 'booking_amendment', pattern: /^\[Update\] Booking/i },
  { carrier: 'hapag', type: 'shipping_instruction', pattern: /^Shipping Instruction Submitted/i },
  { carrier: 'hapag', type: 'bill_of_lading', pattern: /^BL HLCL Sh#/i },
  { carrier: 'hapag', type: 'bill_of_lading', pattern: /^SW HLCL Sh#/i },
  { carrier: 'hapag', type: 'bill_of_lading', pattern: /^HLCL Sh#/i },
  { carrier: 'hapag', type: 'invoice', pattern: /^\d+ INTOG[LO] 001 HLCU/i },

  // CMA CGM
  { carrier: 'cma', type: 'booking_confirmation', pattern: /^CMA CGM - Booking confirmation available/i },
  { carrier: 'cma', type: 'shipping_instruction', pattern: /^CMA CGM - Shipping instruction submitted/i },
  { carrier: 'cma', type: 'arrival_notice', pattern: /^CMA CGM - Arrival notice/i },
  { carrier: 'cma', type: 'invoice', pattern: /^CMA-CGM Freight Invoice/i },

  // COSCO
  { carrier: 'cosco', type: 'booking_confirmation', pattern: /^Cosco Shipping Line Booking Confirmation/i },
  { carrier: 'cosco', type: 'arrival_notice', pattern: /^Cosco Shipping Line -Shipment Notice/i },
  { carrier: 'cosco', type: 'arrival_notice', pattern: /^COSCO Arrival Notice/i },
  { carrier: 'cosco', type: 'bill_of_lading', pattern: /^COSCON - (Proforma |Copy )?Bill of Lading/i },
  { carrier: 'cosco', type: 'invoice', pattern: /^PROD_Invoice/i },
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║            DETERMINISTIC BC COUNT BY PATTERN                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all emails from shipping lines
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email');

  const results: Record<string, Record<string, number>> = {
    'Maersk': {},
    'Hapag-Lloyd': {},
    'CMA CGM': {},
    'COSCO': {},
    'UNMATCHED': {},
  };

  const bcEmails: any[] = [];
  const amendmentEmails: any[] = [];

  for (const e of emails || []) {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();
    const subject = e.subject || '';

    let carrier = '';
    if (sender.includes('maersk.com')) carrier = 'maersk';
    else if (sender.includes('hapag') || sender.includes('hlag')) carrier = 'hapag';
    else if (sender.includes('cma-cgm')) carrier = 'cma';
    else if (sender.includes('coscon')) carrier = 'cosco';
    else continue; // Skip non-shipping line emails

    // Find matching rule
    let matched = false;
    for (const rule of RULES) {
      if (rule.carrier === carrier && rule.pattern.test(subject)) {
        const carrierName = carrier === 'maersk' ? 'Maersk' :
          carrier === 'hapag' ? 'Hapag-Lloyd' :
            carrier === 'cma' ? 'CMA CGM' : 'COSCO';

        results[carrierName][rule.type] = (results[carrierName][rule.type] || 0) + 1;

        if (rule.type === 'booking_confirmation') {
          bcEmails.push(e);
        } else if (rule.type === 'booking_amendment') {
          amendmentEmails.push(e);
        }

        matched = true;
        break;
      }
    }

    if (!matched) {
      const carrierName = carrier === 'maersk' ? 'Maersk' :
        carrier === 'hapag' ? 'Hapag-Lloyd' :
          carrier === 'cma' ? 'CMA CGM' : 'COSCO';
      results[carrierName]['unmatched'] = (results[carrierName]['unmatched'] || 0) + 1;
    }
  }

  // Display results
  for (const [carrier, types] of Object.entries(results)) {
    if (carrier === 'UNMATCHED') continue;

    const total = Object.values(types).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    console.log('\n' + carrier + ':');
    for (const [type, count] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
      console.log('  ' + type.padEnd(25) + ': ' + count);
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));

  let totalBC = 0;
  let totalAmendment = 0;

  for (const [carrier, types] of Object.entries(results)) {
    totalBC += types['booking_confirmation'] || 0;
    totalAmendment += types['booking_amendment'] || 0;
  }

  console.log('\nBooking Confirmations (by deterministic pattern): ' + totalBC);
  console.log('Booking Amendments (by deterministic pattern): ' + totalAmendment);
  console.log('Total BC-type: ' + (totalBC + totalAmendment));

  // Compare with current classification
  const { data: currentCls } = await supabase
    .from('document_classifications')
    .select('document_type');

  const currentBC = currentCls?.filter(c => c.document_type === 'booking_confirmation').length || 0;
  const currentAmend = currentCls?.filter(c => c.document_type === 'booking_amendment').length || 0;

  console.log('\n--- Comparison with current classification ---');
  console.log('Current BC classified: ' + currentBC);
  console.log('Current Amendment classified: ' + currentAmend);
  console.log('Deterministic BC count: ' + totalBC);
  console.log('Deterministic Amendment count: ' + totalAmendment);
  console.log('\nDifference: ' + ((totalBC + totalAmendment) - (currentBC + currentAmend)));
}

main().catch(console.error);
