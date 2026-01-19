#!/usr/bin/env npx tsx
/**
 * Coverage analysis segmented by shipment source
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, carrier_id, si_cutoff, vgm_cutoff, cargo_cutoff, workflow_state');

  // Get classifications for source emails
  const emailIds = shipments?.map(s => s.created_from_email_id).filter(Boolean) || [];
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('email_id', emailIds);

  const docTypeMap = new Map(classifications?.map(c => [c.email_id, c.document_type]));

  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    COVERAGE BY SHIPMENT SOURCE                                 ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Categorize shipments
  const categories: Record<string, typeof shipments> = {
    'From Booking Confirmation': [],
    'From SI/SI Draft': [],
    'From Arrival Notice': [],
    'From BL': [],
    'From Invoice/Other': [],
  };

  for (const s of shipments || []) {
    const docType = docTypeMap.get(s.created_from_email_id) || 'unknown';

    if (docType === 'booking_confirmation' || docType === 'booking_amendment') {
      categories['From Booking Confirmation'].push(s);
    } else if (docType === 'shipping_instruction' || docType === 'si_draft') {
      categories['From SI/SI Draft'].push(s);
    } else if (docType === 'arrival_notice') {
      categories['From Arrival Notice'].push(s);
    } else if (docType === 'bill_of_lading') {
      categories['From BL'].push(s);
    } else {
      categories['From Invoice/Other'].push(s);
    }
  }

  console.log('Source Category'.padEnd(30) + '| Count | All 3 | Rate  | Cutoffs Relevant?');
  console.log('─'.repeat(85));

  const relevance: Record<string, string> = {
    'From Booking Confirmation': '✅ YES - cutoffs in BC',
    'From SI/SI Draft': '⚠️ Maybe - may have BC too',
    'From Arrival Notice': '❌ NO - ship already sailed',
    'From BL': '❌ NO - post departure',
    'From Invoice/Other': '❌ NO - post shipment',
  };

  for (const [category, list] of Object.entries(categories)) {
    const total = list.length;
    const allThree = list.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;
    const rate = total > 0 ? Math.round((allThree / total) * 100) : 0;

    console.log(
      category.padEnd(30) + '| ' +
      String(total).padEnd(6) + '| ' +
      String(allThree).padEnd(6) + '| ' +
      (rate + '%').padEnd(6) + '| ' +
      relevance[category]
    );
  }

  // Focus on BC-originated shipments
  console.log('\n═══ FOCUS: SHIPMENTS FROM BOOKING CONFIRMATIONS ═══\n');

  const bcShipments = categories['From Booking Confirmation'];
  console.log('Total:', bcShipments.length);

  const bcByCarrier: Record<string, { total: number; allThree: number }> = {};
  for (const s of bcShipments) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (!bcByCarrier[carrier]) {
      bcByCarrier[carrier] = { total: 0, allThree: 0 };
    }
    bcByCarrier[carrier].total++;
    if (s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff) bcByCarrier[carrier].allThree++;
  }

  console.log('\nCarrier'.padEnd(20) + '| Total | All 3 | Rate');
  console.log('─'.repeat(50));

  const sorted = Object.entries(bcByCarrier).sort((a, b) => b[1].total - a[1].total);
  for (const [carrier, stats] of sorted) {
    const rate = Math.round((stats.allThree / stats.total) * 100);
    console.log(
      carrier.substring(0, 19).padEnd(20) + '| ' +
      String(stats.total).padEnd(6) + '| ' +
      String(stats.allThree).padEnd(6) + '| ' +
      rate + '%'
    );
  }

  const bcAll3 = bcShipments.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;
  console.log('─'.repeat(50));
  console.log(
    'TOTAL'.padEnd(20) + '| ' +
    String(bcShipments.length).padEnd(6) + '| ' +
    String(bcAll3).padEnd(6) + '| ' +
    Math.round((bcAll3 / bcShipments.length) * 100) + '%'
  );

  // Check if SI/SI Draft shipments also have BCs
  console.log('\n═══ SI-ORIGINATED SHIPMENTS: DO THEY HAVE BC EMAILS? ═══\n');

  const siShipments = categories['From SI/SI Draft'];
  let siWithBC = 0;

  // Get BC emails
  const { data: bcClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');
  const bcEmailIds = new Set(bcClassifications?.map(c => c.email_id));

  // Get BC email bodies to match
  const { data: bcEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .in('id', [...bcEmailIds]);

  for (const s of siShipments) {
    const bn = s.booking_number || '';
    if (bn.length < 6) continue;

    const searchTerm = bn.substring(0, 10);
    const hasBC = bcEmails?.some(e => {
      const subject = e.subject || '';
      const body = (e.body_text || '').substring(0, 5000);
      return subject.includes(searchTerm) || body.includes(searchTerm);
    });

    if (hasBC) siWithBC++;
  }

  console.log('SI-originated shipments:', siShipments.length);
  console.log('Also have BC email:', siWithBC);
  console.log('No BC email found:', siShipments.length - siWithBC);

  // Final summary
  console.log('\n═══ CORRECTED COVERAGE METRICS ═══\n');

  const relevantShipments = bcShipments.length + siWithBC;
  const relevantAll3 = bcAll3 + categories['From SI/SI Draft']
    .filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length;

  console.log('Shipments where cutoffs ARE relevant:');
  console.log('  BC-originated: ' + bcShipments.length);
  console.log('  SI with BC: ~' + siWithBC);
  console.log('');
  console.log('Shipments where cutoffs are NOT relevant:');
  console.log('  Arrival Notice (ship sailed): ' + categories['From Arrival Notice'].length);
  console.log('  BL (post departure): ' + categories['From BL'].length);
  console.log('  Invoice/Other: ' + categories['From Invoice/Other'].length);
}

main().catch(console.error);
