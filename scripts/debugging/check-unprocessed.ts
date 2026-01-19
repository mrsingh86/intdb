import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find all booking confirmation emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, processing_status, received_at')
    .or('subject.ilike.%booking confirmation%,subject.ilike.%booking confirmed%')
    .order('received_at', { ascending: false });

  if (error) { console.error('Error:', error); return; }

  console.log('Found', emails?.length, 'booking confirmation emails\n');

  const unlinked: any[] = [];
  const linked: any[] = [];

  for (const email of emails || []) {
    // Check if linked to a shipment
    const { data: doc } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', email.id)
      .single();

    if (!doc) {
      unlinked.push(email);
    } else {
      linked.push(email);
    }
  }

  console.log('=== UNLINKED Booking Confirmations ===\n');
  for (const e of unlinked) {
    const date = e.received_at ? e.received_at.split('T')[0] : '';
    // Extract carrier hint from sender
    const sender = e.sender_email || '';
    let carrier = 'Unknown';
    if (sender.toLowerCase().includes('maersk')) carrier = 'Maersk';
    else if (sender.toLowerCase().includes('hapag') || sender.toLowerCase().includes('hlag')) carrier = 'Hapag-Lloyd';
    else if (sender.toLowerCase().includes('cma')) carrier = 'CMA CGM';
    else if (sender.toLowerCase().includes('msc')) carrier = 'MSC';
    else if (sender.toLowerCase().includes('cosco')) carrier = 'COSCO';
    else if (sender.toLowerCase().includes('evergreen')) carrier = 'Evergreen';
    else if (sender.toLowerCase().includes('one-line')) carrier = 'ONE';
    
    console.log('- [' + carrier + '] ' + date + ': ' + (e.subject || '').substring(0, 65));
  }

  console.log('\n---');
  console.log('Linked:', linked.length);
  console.log('Unlinked:', unlinked.length);
  
  if (unlinked.length > 0) {
    console.log('\nResetting', unlinked.length, 'emails to pending...');
    const ids = unlinked.map(e => e.id);
    const { error: updateError } = await supabase
      .from('raw_emails')
      .update({ processing_status: 'pending' })
      .in('id', ids);
    
    if (updateError) {
      console.error('Update error:', updateError);
    } else {
      console.log('Done! Run process-emails to create shipments.');
    }
  }
}
main().catch(console.error);
