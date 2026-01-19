import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get ALL booking confirmation emails (Maersk format)
  const { data: bcEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, processing_status')
    .like('subject', 'Booking Confirmation : %')
    .order('received_at', { ascending: false });

  console.log('Total Maersk BC emails:', bcEmails?.length);

  // Extract unique booking numbers
  const bookingNumbers = new Set<string>();
  for (const e of bcEmails || []) {
    const match = e.subject?.match(/Booking Confirmation\s*:\s*(\d{9})/i);
    if (match) {
      bookingNumbers.add(match[1]);
    }
  }

  console.log('Unique Maersk booking numbers:', bookingNumbers.size);

  // Check how many have shipments
  let found = 0;
  let missing = 0;
  const missingList: string[] = [];

  for (const bn of bookingNumbers) {
    const { data } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bn)
      .single();

    if (data) {
      found++;
    } else {
      missing++;
      missingList.push(bn);
    }
  }

  console.log('\nShipments found:', found);
  console.log('Shipments missing:', missing);

  if (missingList.length > 0) {
    console.log('\nMissing booking numbers:');
    missingList.forEach(bn => console.log('  - ' + bn));
  }

  // Also check CMA CGM
  const { data: cmaEmails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .ilike('subject', '%CMA CGM%Booking confirmation%');

  console.log('\nCMA CGM BC emails:', cmaEmails?.length);

  // Check all carriers total
  const { count: allBCClassified } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true })
    .eq('document_type', 'booking_confirmation')
    .gte('confidence_score', 90);

  console.log('High-confidence booking_confirmation classifications:', allBCClassified);
}
main().catch(console.error);
