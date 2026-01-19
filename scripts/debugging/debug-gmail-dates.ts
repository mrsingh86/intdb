/**
 * Debug Gmail Dates
 * Check what dates Gmail API is returning
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createChronicleGmailService } from '../lib/chronicle';

async function debug() {
  console.log('=== DEBUG GMAIL DATES ===\n');

  const gmailService = createChronicleGmailService();
  await gmailService.testConnection();

  // Fetch 5 recent emails
  const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  const emails = await gmailService.fetchEmailsByTimestamp({
    after: oneDayAgo,
    maxResults: 5,
  });

  console.log(`Fetched ${emails.length} emails\n`);

  for (const email of emails) {
    console.log('Email:');
    console.log('  Gmail ID:', email.gmailMessageId);
    console.log('  Subject:', email.subject?.substring(0, 60));
    console.log('  receivedAt:', email.receivedAt);
    console.log('  receivedAt (ISO):', email.receivedAt.toISOString());
    console.log('');
  }

  // Now check what's in chronicle
  console.log('=== CHECKING CHRONICLE TABLE ===\n');

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: chronicleRecords } = await supabase
    .from('chronicle')
    .select('gmail_message_id, subject, occurred_at')
    .order('occurred_at', { ascending: false })
    .limit(5);

  if (chronicleRecords) {
    for (const record of chronicleRecords) {
      console.log('Chronicle Record:');
      console.log('  Gmail ID:', record.gmail_message_id);
      console.log('  Subject:', record.subject?.substring(0, 60));
      console.log('  occurred_at:', record.occurred_at);
      console.log('');
    }
  }

  // Compare - find a matching email
  if (emails.length > 0 && chronicleRecords && chronicleRecords.length > 0) {
    const firstEmail = emails[0];
    const matchingChronicle = chronicleRecords.find(c => c.gmail_message_id === firstEmail.gmailMessageId);

    if (matchingChronicle) {
      console.log('=== COMPARISON ===');
      console.log('Gmail receivedAt:', firstEmail.receivedAt.toISOString());
      console.log('Chronicle occurred_at:', matchingChronicle.occurred_at);
      console.log('Match:', firstEmail.receivedAt.toISOString() === matchingChronicle.occurred_at);
    }
  }
}

debug()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
