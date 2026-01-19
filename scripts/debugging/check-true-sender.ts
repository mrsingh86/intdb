import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function check() {
  // Check true_sender vs sender for carrier emails
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('sender_email.ilike.%maersk%,sender_email.ilike.%hapag%,sender_email.ilike.%cma%,sender_email.ilike.%hlag%,true_sender_email.ilike.%maersk%,true_sender_email.ilike.%hapag%,true_sender_email.ilike.%cma%,true_sender_email.ilike.%hlag%')
    .limit(20);

  console.log('=== CARRIER EMAILS: sender vs true_sender ===\n');
  emails?.forEach(e => {
    console.log('Subject:', e.subject?.substring(0, 50));
    console.log('  sender_email:', e.sender_email?.substring(0, 60));
    console.log('  true_sender:', e.true_sender_email || 'NULL');
    console.log('');
  });

  // Count how many have true_sender populated
  const { data: all } = await supabase
    .from('raw_emails')
    .select('true_sender_email');

  const withTrue = all?.filter(e => e.true_sender_email !== null && e.true_sender_email !== undefined).length || 0;
  const withoutTrue = (all?.length || 0) - withTrue;

  console.log('=== TRUE_SENDER STATS ===');
  console.log('With true_sender:', withTrue);
  console.log('Without true_sender (NULL):', withoutTrue);

  // Check emails forwarded via ops@intoglo.com
  const { data: forwarded } = await supabase
    .from('raw_emails')
    .select('subject, sender_email, true_sender_email')
    .ilike('sender_email', '%ops@intoglo.com%')
    .limit(10);

  console.log('\n=== EMAILS VIA OPS@INTOGLO.COM ===');
  forwarded?.forEach(e => {
    console.log('Subject:', e.subject?.substring(0, 50));
    console.log('  true_sender:', e.true_sender_email || 'NOT EXTRACTED');
    console.log('');
  });
}

check().catch(console.error);
