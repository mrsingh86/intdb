import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═'.repeat(70));
  console.log('INVESTIGATING UNKNOWN CARRIER SHIPMENTS');
  console.log('═'.repeat(70));

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number, carrier_id, vessel_name, created_from_email_id');

  // Identify "unknown" ones based on booking number pattern
  const unknowns = (shipments || []).filter(s => {
    const bn = s.booking_number || '';
    // Known patterns:
    // Maersk: 9 digits or starts with MAEU
    if (/^\d{9}$/.test(bn) || bn.startsWith('MAEU')) return false;
    // Hapag: HLC or HPL prefix
    if (bn.startsWith('HLC') || bn.startsWith('HPL')) return false;
    // CMA CGM: CAD, CME prefix
    if (bn.startsWith('CAD') || bn.startsWith('CME')) return false;
    // APL (CMA CGM): AMC prefix
    if (bn.startsWith('AMC')) return false;
    // MSC: MSC prefix
    if (bn.startsWith('MSC')) return false;
    return true;
  });

  console.log(`\nFound ${unknowns.length} shipments with unrecognized booking format:\n`);

  // Group by booking number pattern
  const patterns: Record<string, string[]> = {};
  for (const s of unknowns) {
    const bn = s.booking_number || 'NULL';
    // Extract prefix pattern
    const prefix = bn.match(/^[A-Z]+/)?.[0] ||
                   (bn.match(/^\d+$/) ? `${bn.length}-digits` : 'other');
    if (!patterns[prefix]) patterns[prefix] = [];
    patterns[prefix].push(bn);
  }

  console.log('Booking number patterns:');
  for (const [pattern, bookings] of Object.entries(patterns)) {
    console.log(`  ${pattern}: ${bookings.length} shipments`);
    for (const bn of bookings.slice(0, 5)) {
      console.log(`    - ${bn}`);
    }
    if (bookings.length > 5) console.log(`    ... and ${bookings.length - 5} more`);
  }

  // Check source emails to determine carrier
  console.log('\n' + '═'.repeat(70));
  console.log('CHECKING SOURCE EMAILS FOR CARRIER DETECTION');
  console.log('═'.repeat(70));

  for (const s of unknowns.slice(0, 10)) {
    if (!s.created_from_email_id) {
      console.log(`\n${s.booking_number}: No source email`);
      continue;
    }

    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, true_sender_email, sender_email')
      .eq('id', s.created_from_email_id)
      .single();

    const sender = email?.true_sender_email || email?.sender_email || '';
    console.log(`\n${s.booking_number}:`);
    console.log(`  Sender: ${sender}`);
    console.log(`  Subject: ${email?.subject?.substring(0, 60)}...`);
    console.log(`  Current carrier_id: ${s.carrier_id}`);
  }
}

main().catch(console.error);
