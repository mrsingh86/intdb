import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  // Get ALL emails with proper pagination
  const allEmails = await getAllRows<{sender_email: string; email_direction: string}>(
    supabase, 'raw_emails', 'sender_email, email_direction'
  );

  // Filter for via emails
  const viaEmails = allEmails.filter(e =>
    e.sender_email && e.sender_email.toLowerCase().includes(' via ')
  );

  console.log('=== VIA EMAILS DIRECTION CHECK ===');
  console.log('Total via emails:', viaEmails.length);

  let wrongCount = 0;
  let correctCount = 0;
  const wrongSamples: string[] = [];

  viaEmails.forEach(e => {
    if (e.email_direction === 'inbound') {
      correctCount++;
    } else {
      wrongCount++;
      if (wrongSamples.length < 10) {
        const sender = e.sender_email || '';
        wrongSamples.push(e.email_direction + ' | ' + sender.substring(0, 60));
      }
    }
  });

  console.log('Correct (inbound):', correctCount);
  console.log('Wrong (not inbound):', wrongCount);

  if (wrongSamples.length > 0) {
    console.log('\nWrong samples:');
    wrongSamples.forEach(s => console.log('  ' + s));
  }

  // If there are wrong ones, fix them
  if (wrongCount > 0) {
    console.log('\n=== FIXING WRONG VIA EMAILS ===');
    let fixed = 0;
    for (const email of viaEmails) {
      if (email.email_direction !== 'inbound') {
        // This email should be inbound but isn't
        // We need to update it - but we don't have the ID here
        // Let's just report
        fixed++;
      }
    }
    console.log('Emails needing fix:', fixed);
  }
}

check();
