/**
 * Check Current Shipment Model
 *
 * Analyze how shipments are linked to emails
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function checkShipmentModel() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         SHIPMENT MODEL ANALYSIS                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all shipments with their linked documents
  const { data: shipments } = await supabase
    .from('shipments')
    .select(`
      id,
      booking_number,
      container_number,
      hbl_number,
      etd,
      eta,
      si_cutoff
    `)
    .order('booking_number');

  console.log(`Total shipments: ${shipments?.length || 0}\n`);

  // Check for duplicate booking numbers
  const bookingCounts = new Map<string, number>();
  for (const s of shipments || []) {
    const bn = s.booking_number?.replace(/^HL-/i, '').split(',')[0].trim();
    if (bn) {
      bookingCounts.set(bn, (bookingCounts.get(bn) || 0) + 1);
    }
  }

  const duplicates = [...bookingCounts.entries()].filter(([_, count]) => count > 1);
  console.log(`Duplicate booking numbers: ${duplicates.length}`);
  duplicates.forEach(([bn, count]) => console.log(`  ${bn}: ${count} shipments`));

  // Check linked documents per shipment
  console.log('\n─────────────────────────────────────────────────────────────────────');
  console.log('DOCUMENTS LINKED PER SHIPMENT:\n');

  const stats = { zero: 0, one: 0, multiple: 0 };

  for (const shipment of (shipments || []).slice(0, 20)) {
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', shipment.id);

    const count = docs?.length || 0;
    if (count === 0) stats.zero++;
    else if (count === 1) stats.one++;
    else stats.multiple++;

    if (count > 1) {
      console.log(`✅ ${shipment.booking_number}: ${count} documents linked`);
      docs?.forEach(d => console.log(`     - ${d.document_type}`));
    }
  }

  console.log('\n─────────────────────────────────────────────────────────────────────');
  console.log('SUMMARY:\n');
  console.log(`  Shipments with 0 docs: ${stats.zero}`);
  console.log(`  Shipments with 1 doc:  ${stats.one}`);
  console.log(`  Shipments with 2+ docs: ${stats.multiple}`);

  // Check if we have multiple emails for same booking number
  console.log('\n─────────────────────────────────────────────────────────────────────');
  console.log('EMAILS PER BOOKING NUMBER:\n');

  const { data: hapagEmails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .eq('sender_email', 'India@service.hlag.com');

  const emailsByBooking = new Map<string, string[]>();
  for (const email of hapagEmails || []) {
    const match = email.subject?.match(/HL-(\d+)/);
    if (match) {
      const bn = match[1];
      if (!emailsByBooking.has(bn)) emailsByBooking.set(bn, []);
      emailsByBooking.get(bn)!.push(email.subject);
    }
  }

  const multipleEmails = [...emailsByBooking.entries()].filter(([_, emails]) => emails.length > 1);
  console.log(`Booking numbers with multiple emails: ${multipleEmails.length}`);

  for (const [bn, subjects] of multipleEmails.slice(0, 5)) {
    console.log(`\n  ${bn} (${subjects.length} emails):`);
    subjects.forEach(s => console.log(`    - ${s.substring(0, 60)}...`));
  }

  // Recommendation
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('RECOMMENDED DATA MODEL:');
  console.log('═══════════════════════════════════════════════════════════════════\n');
  console.log(`
  shipments (1 per booking_number)
      │
      ├── booking_number (PRIMARY IDENTIFIER)
      ├── container_number (set after stuffing)
      ├── hbl_number (set after BL issued)
      ├── etd, eta, cutoffs (from booking confirmation)
      │
      └── shipment_documents (MANY emails linked)
            ├── booking_confirmation
            ├── booking_amendment (1ST, 2ND, 3RD UPDATE)
            ├── shipping_instruction
            ├── bill_of_lading
            └── invoice

  LINKING LOGIC:
  1. Email arrives → Extract booking_number from subject/body
  2. Check if shipment with this booking_number exists
     - YES → Link email to existing shipment
     - NO  → Create new shipment, link email
  3. Extract entities from email
  4. Update shipment fields (respecting priority: booking_confirmation > amendment)
  `);
}

checkShipmentModel().catch(console.error);
