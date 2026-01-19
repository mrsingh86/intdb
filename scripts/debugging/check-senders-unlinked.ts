import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get pending booking confirmations
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject')
    .eq('processing_status', 'pending')
    .or('subject.ilike.%booking confirmation%,subject.ilike.%booking confirmed%')
    .limit(10);

  if (error) { console.error('Error:', error); return; }

  console.log('Sample pending booking confirmations:\n');

  for (const e of emails || []) {
    console.log('Subject:', (e.subject || '').substring(0, 50));
    console.log('Sender:', e.sender_email);
    console.log('---');
  }
}
main().catch(console.error);
