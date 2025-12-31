/**
 * Check Non-Hapag Shipments
 *
 * Identifies shipments that are NOT from Hapag-Lloyd
 * and checks if they have matching booking confirmation emails.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function checkNonHapagShipments() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         NON-HAPAG SHIPMENT ANALYSIS                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff')
    .not('booking_number', 'is', null);

  // Get Hapag booking numbers
  const hapagBookings = new Set<string>();
  const { data: hapagEmails } = await supabase
    .from('raw_emails')
    .select('subject')
    .eq('sender_email', 'India@service.hlag.com')
    .ilike('subject', 'HL-%');

  hapagEmails?.forEach(e => {
    const match = e.subject?.match(/HL-(\d+)/);
    if (match) hapagBookings.add(match[1]);
  });

  console.log(`Hapag-Lloyd booking numbers found: ${hapagBookings.size}`);
  console.log(`Total shipments: ${shipments?.length || 0}\n`);

  // Categorize shipments
  const hapagShipments: any[] = [];
  const nonHapagShipments: any[] = [];

  for (const shipment of shipments || []) {
    const normalized = shipment.booking_number.replace(/^HL-/i, '').split(',')[0].trim();
    if (hapagBookings.has(normalized)) {
      hapagShipments.push(shipment);
    } else {
      nonHapagShipments.push(shipment);
    }
  }

  console.log(`Hapag-Lloyd shipments: ${hapagShipments.length}`);
  console.log(`Non-Hapag shipments: ${nonHapagShipments.length}\n`);

  // Analyze non-Hapag shipments
  console.log('NON-HAPAG SHIPMENTS:\n');

  for (const shipment of nonHapagShipments) {
    // Get linked documents
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', shipment.id);

    const emailIds = linkedDocs?.map(d => d.email_id) || [];

    // Get sender info
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('sender_email, subject')
      .in('id', emailIds);

    const senders = [...new Set(emails?.map(e => e.sender_email) || [])];
    const subjects = emails?.map(e => e.subject?.substring(0, 40)) || [];

    // Determine carrier
    let carrier = 'Unknown';
    for (const sender of senders) {
      const s = sender?.toLowerCase() || '';
      if (s.includes('maersk')) carrier = 'Maersk';
      else if (s.includes('msc') || s.includes('medlog')) carrier = 'MSC';
      else if (s.includes('cma')) carrier = 'CMA CGM';
      else if (s.includes('intoglo')) carrier = 'Intoglo Internal';
    }

    const status = shipment.si_cutoff ? '✅' : (shipment.etd ? '⚠️ ' : '❌');

    console.log(`${status} ${shipment.booking_number}`);
    console.log(`   Carrier: ${carrier}`);
    console.log(`   ETD: ${shipment.etd || 'NULL'}, ETA: ${shipment.eta || 'NULL'}, Cutoffs: ${shipment.si_cutoff ? 'YES' : 'NO'}`);
    if (subjects.length > 0) {
      console.log(`   Linked: ${subjects[0]}...`);
    }
    console.log('');
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));

  const byCarrier: Record<string, { total: number; withCutoffs: number }> = {};

  for (const shipment of nonHapagShipments) {
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', shipment.id)
      .limit(1);

    if (linkedDocs && linkedDocs.length > 0) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('sender_email')
        .eq('id', linkedDocs[0].email_id)
        .single();

      const s = email?.sender_email?.toLowerCase() || '';
      let carrier = 'Other';
      if (s.includes('maersk')) carrier = 'Maersk';
      else if (s.includes('msc')) carrier = 'MSC';
      else if (s.includes('intoglo')) carrier = 'Intoglo';

      if (!byCarrier[carrier]) byCarrier[carrier] = { total: 0, withCutoffs: 0 };
      byCarrier[carrier].total++;
      if (shipment.si_cutoff) byCarrier[carrier].withCutoffs++;
    }
  }

  console.log('\nNon-Hapag Shipments by Source:');
  Object.entries(byCarrier).forEach(([carrier, stats]) => {
    console.log(`  ${carrier}: ${stats.total} shipments (${stats.withCutoffs} with cutoffs)`);
  });

  console.log('\n📝 To get cutoffs for non-Hapag shipments, you need to forward:');
  console.log('   - Actual Maersk booking confirmation emails (with deadline tables)');
  console.log('   - Actual MSC booking confirmation emails (with schedule details)');
  console.log('   - Not internal forwards or contract amendments');
}

checkNonHapagShipments().catch(console.error);
