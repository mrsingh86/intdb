import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get CMA CGM emails via pricing@intoglo.com
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject')
    .or('sender_email.ilike.%pricing@intoglo.com%,sender_email.ilike.%cma%')
    .order('received_at', { ascending: false })
    .limit(15);
  
  if (error) { console.error('Error:', error); return; }
  
  console.log('CMA CGM related emails:\n');
  
  for (const email of emails || []) {
    console.log('---');
    console.log('Full Sender:', email.sender_email);
    console.log('Subject:', email.subject?.substring(0, 70));
  }
}
main().catch(console.error);
