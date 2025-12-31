import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DIRECT_CARRIER_DOMAINS = [
  'maersk', 'hlag', 'hapag', 'cma-cgm', 'cmacgm', 'msc.com',
  'coscon', 'cosco', 'oocl', 'one-line', 'evergreen', 'yangming',
  'hmm21', 'zim.com', 'paborlines', 'namsung', 'sinokor',
  'heung-a', 'kmtc', 'wanhai', 'tslines', 'sitc'
];

function isDirectCarrier(trueSenderEmail: string | null, senderEmail: string | null): boolean {
  const emailToCheck = trueSenderEmail || senderEmail || '';
  const domain = emailToCheck.toLowerCase().split('@')[1] || '';
  return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
}

async function audit() {
  console.log('='.repeat(70));
  console.log('EXHAUSTIVE AUDIT: 471 BOOKING CONFIRMATIONS → 105 SHIPMENTS');
  console.log('='.repeat(70));

  // Get ALL booking confirmations with email details
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select(`
      email_id,
      raw_emails!inner (
        id,
        sender_email,
        true_sender_email,
        subject
      )
    `)
    .eq('document_type', 'booking_confirmation');

  console.log(`\nTotal booking_confirmation emails: ${bookingEmails?.length || 0}`);

  // Split into direct carrier vs non-carrier
  const directCarrierEmails: any[] = [];
  const nonCarrierEmails: any[] = [];

  for (const email of bookingEmails || []) {
    const rawEmail = email.raw_emails as any;
    if (isDirectCarrier(rawEmail.true_sender_email, rawEmail.sender_email)) {
      directCarrierEmails.push({ ...email, rawEmail });
    } else {
      nonCarrierEmails.push({ ...email, rawEmail });
    }
  }

  console.log(`\n📊 SOURCE BREAKDOWN:`);
  console.log(`   Direct carrier emails: ${directCarrierEmails.length}`);
  console.log(`   Non-carrier emails (forwards/replies): ${nonCarrierEmails.length}`);

  // For direct carrier emails, check booking number extraction
  console.log(`\n📋 DIRECT CARRIER EMAILS ANALYSIS (${directCarrierEmails.length}):`);

  let withBookingNumber = 0;
  let withoutBookingNumber = 0;
  const uniqueBookingNumbers = new Set<string>();
  const emailsPerBooking: Record<string, number> = {};

  for (const email of directCarrierEmails) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.email_id)
      .eq('entity_type', 'booking_number');

    const bookingNumber = entities?.[0]?.entity_value;

    if (bookingNumber) {
      withBookingNumber++;
      uniqueBookingNumbers.add(bookingNumber);
      emailsPerBooking[bookingNumber] = (emailsPerBooking[bookingNumber] || 0) + 1;
    } else {
      withoutBookingNumber++;
    }
  }

  console.log(`   With booking_number extracted: ${withBookingNumber}`);
  console.log(`   Without booking_number: ${withoutBookingNumber}`);
  console.log(`   Unique booking numbers: ${uniqueBookingNumbers.size}`);

  // Show duplicates
  const duplicates = Object.entries(emailsPerBooking).filter(([_, count]) => count > 1);
  if (duplicates.length > 0) {
    console.log(`\n📌 BOOKING NUMBERS WITH MULTIPLE EMAILS (updates/amendments):`);
    duplicates.slice(0, 10).forEach(([bn, count]) => {
      console.log(`   ${bn}: ${count} emails`);
    });
    if (duplicates.length > 10) {
      console.log(`   ... and ${duplicates.length - 10} more`);
    }
  }

  // Check shipments created
  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  console.log(`\n🚢 SHIPMENTS CREATED: ${shipmentCount}`);
  console.log(`   Expected (unique booking#s from direct carrier): ${uniqueBookingNumbers.size}`);

  if (shipmentCount !== uniqueBookingNumbers.size) {
    console.log(`\n⚠️  GAP: ${uniqueBookingNumbers.size - (shipmentCount || 0)} shipments missing`);

    // Find which booking numbers don't have shipments
    const { data: existingShipments } = await supabase
      .from('shipments')
      .select('booking_number');

    const existingBookings = new Set(existingShipments?.map(s => s.booking_number) || []);
    const missingBookings = [...uniqueBookingNumbers].filter(bn => !existingBookings.has(bn));

    console.log(`\n📋 MISSING BOOKING NUMBERS (no shipment created):`);
    missingBookings.slice(0, 10).forEach(bn => {
      console.log(`   - ${bn}`);
    });
    if (missingBookings.length > 10) {
      console.log(`   ... and ${missingBookings.length - 10} more`);
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total emails: 3,480`);
  console.log(`Classified as booking_confirmation: 471`);
  console.log(`  → From direct carriers: ${directCarrierEmails.length}`);
  console.log(`  → From internal/forwards: ${nonCarrierEmails.length}`);
  console.log(`Direct carrier emails with booking#: ${withBookingNumber}`);
  console.log(`Unique booking numbers: ${uniqueBookingNumbers.size}`);
  console.log(`Shipments created: ${shipmentCount}`);
}

audit().catch(console.error);
