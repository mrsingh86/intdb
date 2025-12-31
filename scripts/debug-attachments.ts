import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import {
  classifyEmail as classifyDeterministic,
} from '../lib/config/shipping-line-patterns';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function debug() {
  // Get attachments with extracted text
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, filename, extracted_text')
    .not('extracted_text', 'is', null)
    .limit(200);

  console.log('Attachments found:', attachments?.length);

  // Group by email
  const byEmail = new Map<string, { filenames: string[]; content: string }>();
  for (const att of attachments || []) {
    if (!byEmail.has(att.email_id)) {
      byEmail.set(att.email_id, { filenames: [], content: '' });
    }
    const entry = byEmail.get(att.email_id)!;
    entry.filenames.push(att.filename);
    entry.content += att.extracted_text?.substring(0, 2000) || '';
  }

  console.log('Unique emails with attachments:', byEmail.size);

  // Get email details
  const emailIds = Array.from(byEmail.keys());
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, true_sender_email, subject')
    .in('id', emailIds);

  console.log('Emails found:', emails?.length);

  // Test classification on a few samples
  console.log('\n=== SAMPLE CLASSIFICATIONS ===\n');

  let count = 0;
  for (const email of emails || []) {
    const sender = (email.true_sender_email || email.sender_email || '').toLowerCase();

    // Only test carrier emails
    if (!sender.includes('hlag') && !sender.includes('maersk') && !sender.includes('cma-cgm') && !sender.includes('coscon')) {
      continue;
    }

    if (count >= 10) break;
    count++;

    const attData = byEmail.get(email.id);
    if (!attData) continue;

    const hasBookingHeading = /BOOKING CONFIRMATION/i.test(attData.content);

    const result = classifyDeterministic(
      email.subject || '',
      email.true_sender_email || email.sender_email || '',
      attData.filenames,
      attData.content
    );

    console.log(`Subject: ${email.subject?.substring(0, 50)}`);
    console.log(`Sender: ${sender}`);
    console.log(`Files: ${attData.filenames.join(', ')}`);
    console.log(`Has BOOKING CONFIRMATION: ${hasBookingHeading}`);
    console.log(`Result: ${result?.documentType || 'NO_MATCH'} (${result?.matchedPattern || 'none'})`);
    console.log('---');
  }
}

debug().catch(console.error);
