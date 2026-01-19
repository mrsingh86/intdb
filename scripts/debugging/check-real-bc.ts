import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Find REAL booking confirmations (exclude price overview)
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject, processing_status, has_attachments')
    .ilike('subject', 'Booking Confirmation :%')  // Maersk format
    .not('subject', 'ilike', '%price overview%')
    .order('received_at', { ascending: false })
    .limit(20);

  if (error) { console.error('Error:', error); return; }

  console.log('Real Booking Confirmations (Maersk format):\n');

  for (const e of emails || []) {
    // Check if linked
    const { data: doc } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', e.id)
      .single();

    // Check classification
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type, confidence_score')
      .eq('email_id', e.id)
      .single();

    const linked = doc ? 'LINKED' : 'NOT LINKED';
    const docType = classification?.document_type || 'no classification';
    const conf = classification?.confidence_score || 0;
    const attach = e.has_attachments ? 'has PDF' : 'no PDF';

    console.log('- ' + (e.subject || '').substring(0, 40));
    console.log('  Status: ' + e.processing_status + ' | ' + linked + ' | ' + attach);
    console.log('  Classification: ' + docType + ' (' + conf + '%)');
    console.log('');
  }
}
main().catch(console.error);
