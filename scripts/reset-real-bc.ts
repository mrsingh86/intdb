import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find REAL Maersk booking confirmations (exact pattern, no RE: prefix, no price overview)
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, processing_status')
    .like('subject', 'Booking Confirmation : %')  // Exact Maersk pattern
    .order('received_at', { ascending: false });

  if (error) { console.error('Error:', error); return; }

  console.log('Found', emails?.length, 'Maersk Booking Confirmations\n');

  const toReset: string[] = [];

  for (const e of emails || []) {
    // Check if linked to shipment
    const { data: doc } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', e.id)
      .single();

    if (!doc) {
      console.log('NOT LINKED:', e.subject);
      toReset.push(e.id);
    }
  }

  console.log('\n---');
  console.log('Unlinked:', toReset.length);

  if (toReset.length > 0) {
    // Delete existing classifications (so they get re-classified)
    await supabase
      .from('document_classifications')
      .delete()
      .in('email_id', toReset);

    // Reset to pending
    const { error: updateError } = await supabase
      .from('raw_emails')
      .update({ processing_status: 'pending' })
      .in('id', toReset);

    if (updateError) {
      console.error('Update error:', updateError);
    } else {
      console.log('Reset', toReset.length, 'emails to pending');
    }
  }
}
main().catch(console.error);
