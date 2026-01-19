/**
 * Show raw email data for a shipment
 * Usage: npx tsx scripts/show-raw-data.ts <booking_number>
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const bookingNumber = process.argv[2] || '34864426';

  // Get shipment
  const { data: ship } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .eq('booking_number', bookingNumber)
    .single();

  if (!ship) {
    console.log('Shipment not found:', bookingNumber);
    return;
  }

  // Get documents with emails
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select(`
      document_type,
      email_id,
      raw_emails!shipment_documents_email_id_fkey(
        id,
        received_at,
        subject,
        is_response,
        thread_id,
        sender_email
      )
    `)
    .eq('shipment_id', ship.id);

  console.log('SHIPMENT:', ship.booking_number);
  console.log('Data source: shipment_documents JOIN raw_emails');
  console.log('='.repeat(120));
  console.log('');

  // Sort by received_at
  const sorted = (docs || []).sort((a, b) => {
    const aDate = (a as any).raw_emails?.received_at || '';
    const bDate = (b as any).raw_emails?.received_at || '';
    return aDate.localeCompare(bDate);
  });

  console.log('RECEIVED_AT           | DOCUMENT_TYPE          | ORIG/RE | SENDER                          | SUBJECT');
  console.log('-'.repeat(120));

  for (const d of sorted) {
    const e = (d as any).raw_emails;
    if (!e) continue;
    const dt = new Date(e.received_at);
    const dateStr = dt.toISOString().substring(0, 19).replace('T', ' ');
    const resp = e.is_response ? 'RE' : 'ORIG';
    const sender = (e.sender_email || '').substring(0, 30).padEnd(30);
    const subject = (e.subject || '').substring(0, 50);
    console.log(`${dateStr} | ${d.document_type.padEnd(22)} | ${resp.padEnd(7)} | ${sender} | ${subject}`);
  }

  console.log('');
  console.log('Total documents:', sorted.length);
}

main().catch(console.error);
