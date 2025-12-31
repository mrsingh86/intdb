#!/usr/bin/env npx tsx
/**
 * Investigate why attachments are missing for 2,422 emails
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      ATTACHMENT EXTRACTION GAP INVESTIGATION                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // 1. Timeline Analysis
  console.log('1. TIMELINE ANALYSIS:');
  console.log('─'.repeat(80));

  const { data: oldestEmail } = await supabase
    .from('raw_emails')
    .select('created_at, received_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  const { data: newestEmail } = await supabase
    .from('raw_emails')
    .select('created_at, received_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log('Oldest email created_at:', oldestEmail?.created_at);
  console.log('Newest email created_at:', newestEmail?.created_at);

  const { data: oldestAtt } = await supabase
    .from('raw_attachments')
    .select('created_at')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  const { data: newestAtt } = await supabase
    .from('raw_attachments')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log('Oldest attachment created_at:', oldestAtt?.created_at);
  console.log('Newest attachment created_at:', newestAtt?.created_at);

  // 2. Emails by ingestion date
  console.log('\n2. EMAILS INGESTED BY DATE:');
  console.log('─'.repeat(80));

  const { data: emailDates } = await supabase
    .from('raw_emails')
    .select('created_at')
    .order('created_at', { ascending: true });

  const dateGroups: Record<string, number> = {};
  for (const e of emailDates || []) {
    const date = e.created_at?.substring(0, 10) || 'unknown';
    dateGroups[date] = (dateGroups[date] || 0) + 1;
  }

  for (const [date, count] of Object.entries(dateGroups)) {
    console.log(`  ${date}: ${count} emails`);
  }

  // 3. Attachments by date
  console.log('\n3. ATTACHMENTS SAVED BY DATE:');
  console.log('─'.repeat(80));

  const { data: attDates } = await supabase
    .from('raw_attachments')
    .select('created_at')
    .order('created_at', { ascending: true });

  const attDateGroups: Record<string, number> = {};
  for (const a of attDates || []) {
    const date = a.created_at?.substring(0, 10) || 'unknown';
    attDateGroups[date] = (attDateGroups[date] || 0) + 1;
  }

  for (const [date, count] of Object.entries(attDateGroups)) {
    console.log(`  ${date}: ${count} attachments`);
  }

  // 4. Missing attachments by date
  console.log('\n4. EMAILS WITH has_attachments=true BUT NO raw_attachments RECORD:');
  console.log('─'.repeat(80));

  const { data: withFlag } = await supabase
    .from('raw_emails')
    .select('id, created_at, has_attachments')
    .eq('has_attachments', true);

  const { data: allAtts } = await supabase
    .from('raw_attachments')
    .select('email_id');

  const emailsWithAtts = new Set((allAtts || []).map(a => a.email_id));

  const missingByDate: Record<string, number> = {};
  let totalMissing = 0;
  for (const e of withFlag || []) {
    if (!emailsWithAtts.has(e.id)) {
      const date = e.created_at?.substring(0, 10) || 'unknown';
      missingByDate[date] = (missingByDate[date] || 0) + 1;
      totalMissing++;
    }
  }

  for (const [date, count] of Object.entries(missingByDate)) {
    console.log(`  ${date}: ${count} emails missing attachments`);
  }
  console.log(`\nTotal missing: ${totalMissing}`);

  // 5. Check processing_logs for any errors
  console.log('\n5. PROCESSING LOGS (EmailIngestionAgent runs):');
  console.log('─'.repeat(80));

  const { data: logs } = await supabase
    .from('processing_logs')
    .select('*')
    .eq('agent_name', 'EmailIngestionAgent')
    .order('started_at', { ascending: false })
    .limit(10);

  if (logs && logs.length > 0) {
    for (const log of logs) {
      console.log(`\nRun ID: ${log.run_id}`);
      console.log(`  Started: ${log.started_at}`);
      console.log(`  Status: ${log.status}`);
      console.log(`  Emails processed: ${log.emails_processed}`);
      console.log(`  Emails failed: ${log.emails_failed}`);
      if (log.error_details) {
        console.log(`  Error: ${JSON.stringify(log.error_details).substring(0, 100)}`);
      }
    }
  } else {
    console.log('No processing logs found for EmailIngestionAgent');
  }

  // 6. Check a sample missing email to understand why
  console.log('\n6. SAMPLE MISSING EMAILS (first 5):');
  console.log('─'.repeat(80));

  let count = 0;
  for (const e of withFlag || []) {
    if (!emailsWithAtts.has(e.id) && count < 5) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('id, gmail_message_id, subject, sender_email, true_sender_email, has_attachments, attachment_count, created_at')
        .eq('id', e.id)
        .single();

      if (email) {
        console.log(`\nEmail ID: ${email.id}`);
        console.log(`  Gmail ID: ${email.gmail_message_id}`);
        console.log(`  Subject: ${email.subject?.substring(0, 60)}`);
        console.log(`  Sender: ${email.sender_email || email.true_sender_email}`);
        console.log(`  has_attachments: ${email.has_attachments}`);
        console.log(`  attachment_count: ${email.attachment_count}`);
        console.log(`  created_at: ${email.created_at}`);
      }
      count++;
    }
  }
}

main().catch(console.error);
