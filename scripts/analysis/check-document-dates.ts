import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function check() {
  // Get a shipment with many documents
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log('Checking shipment:', shipment?.booking_number);

  // Get its documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('id, email_id, document_type')
    .eq('shipment_id', shipment?.id)
    .limit(15);

  if (!docs) return;

  // Get email dates
  const emailIds = docs.map(d => d.email_id);
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, received_at, internal_date, sender_email')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e]));

  console.log('\nDocuments with email dates:');
  docs.forEach((d, i) => {
    const email = emailMap.get(d.email_id);
    const received = email?.received_at ? email.received_at.substring(0, 10) : 'NULL';
    const sender = email?.sender_email ? email.sender_email.substring(0, 35) : 'NULL';
    console.log(`[${i + 1}] ${(d.document_type || 'unknown').padEnd(25)} | ${received} | ${sender}`);
  });

  // Check for unique dates
  const uniqueDates = new Set(emails?.map(e => e.received_at?.substring(0, 10)).filter(Boolean));
  console.log('\nUnique received dates:', uniqueDates.size);
  uniqueDates.forEach(d => console.log('  ', d));
}

check();
