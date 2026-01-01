import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find CMA CGM booking confirmation emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, processing_status')
    .or('sender_email.ilike.%CMA CGM%,subject.ilike.%CMA CGM%Booking confirmation%')
    .ilike('subject', '%Booking confirmation%')
    .order('received_at', { ascending: false });
  
  if (error) { console.error('Error:', error); return; }
  
  console.log('Found', emails?.length, 'CMA CGM booking confirmation emails\n');
  
  // Check which ones don't have shipments
  const toReprocess: string[] = [];
  
  for (const email of emails || []) {
    // Check if already linked to a shipment
    const { data: linked } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', email.id)
      .single();
    
    if (!linked) {
      console.log('Not linked:', email.subject?.substring(0, 60));
      toReprocess.push(email.id);
    } else {
      console.log('Already linked:', email.subject?.substring(0, 60));
    }
  }
  
  console.log('\n---');
  console.log('Total to reprocess:', toReprocess.length);
  
  if (toReprocess.length > 0) {
    // Reset status to pending
    const { error: updateError } = await supabase
      .from('raw_emails')
      .update({ processing_status: 'pending' })
      .in('id', toReprocess);
    
    if (updateError) {
      console.error('Update error:', updateError);
    } else {
      console.log('Reset', toReprocess.length, 'emails to pending status');
    }
  }
}
main().catch(console.error);
