#!/usr/bin/env npx tsx
/**
 * Test the new Gmail query approach
 *
 * Compares old (from:carrier) vs new (to:intoglo groups) query results
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

const oauth2Client = new OAuth2Client(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

async function countMessages(query: string): Promise<number> {
  let count = 0;
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 500,
      pageToken
    });

    count += response.data.messages?.length || 0;
    pageToken = response.data.nextPageToken || undefined;

    // Cap at 2000 for testing
    if (count >= 2000) break;
  } while (pageToken);

  return count;
}

async function getSampleSubjects(query: string, limit: number = 5): Promise<string[]> {
  const response = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: limit
  });

  const subjects: string[] = [];
  for (const msg of response.data.messages || []) {
    const full = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id!,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'X-Original-Sender']
    });

    const headers = full.data.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '(no subject)';
    const from = headers.find(h => h.name === 'From')?.value || '';
    const originalSender = headers.find(h => h.name === 'X-Original-Sender')?.value || '';

    subjects.push(`${subject.substring(0, 60)}`);
    subjects.push(`  From: ${from.substring(0, 50)}`);
    if (originalSender) {
      subjects.push(`  X-Original-Sender: ${originalSender}`);
    }
    subjects.push('');
  }

  return subjects;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      GMAIL QUERY COMPARISON: OLD vs NEW APPROACH                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - 7);
  const dateFilter = `after:${afterDate.toISOString().split('T')[0]}`;

  console.log(`Date filter: ${dateFilter}\n`);

  // OLD approach: from:carrier patterns
  const oldQuery = `(from:@maersk.com OR from:@hlag.com OR from:@hapag-lloyd.com OR from:@cma-cgm.com OR from:@coscon.com OR from:@msc.com) ${dateFilter}`;

  // NEW approach: to:intoglo groups
  const newQuery = `(to:ops@intoglo.com OR to:nam@intoglo.com OR to:pricing@intoglo.com OR to:invoicing@intoglo.com) ${dateFilter}`;

  // SI-specific query (what we're missing)
  const siQuery = `subject:"SI submitted" ${dateFilter}`;

  console.log('QUERY RESULTS:');
  console.log('═'.repeat(80));

  const oldCount = await countMessages(oldQuery);
  console.log(`OLD (from:carrier):  ${String(oldCount).padStart(5)} emails`);

  const newCount = await countMessages(newQuery);
  console.log(`NEW (to:intoglo):    ${String(newCount).padStart(5)} emails`);

  const siCount = await countMessages(siQuery);
  console.log(`SI submitted only:   ${String(siCount).padStart(5)} emails`);

  const difference = newCount - oldCount;
  const pctIncrease = oldCount > 0 ? Math.round((difference / oldCount) * 100) : 0;

  console.log('─'.repeat(80));
  console.log(`DIFFERENCE:          +${difference} emails (+${pctIncrease}%)`);
  console.log('');

  // Sample SI emails to show X-Original-Sender extraction
  console.log('\nSAMPLE SI EMAILS (showing X-Original-Sender header):');
  console.log('═'.repeat(80));

  const siSamples = await getSampleSubjects(siQuery, 3);
  for (const line of siSamples) {
    console.log(line);
  }

  // Sample emails from new query
  console.log('\nSAMPLE FROM NEW QUERY:');
  console.log('═'.repeat(80));

  const newSamples = await getSampleSubjects(newQuery, 5);
  for (const line of newSamples) {
    console.log(line);
  }

  console.log('\n✅ CONCLUSION:');
  console.log('─'.repeat(80));
  if (difference > 0) {
    console.log(`New query captures ${difference} MORE emails (+${pctIncrease}%)`);
    console.log('These are emails forwarded through Google Groups (ops@intoglo.com)');
    console.log('X-Original-Sender header preserves the true carrier sender');
  } else {
    console.log('Query comparison complete');
  }
}

main().catch(console.error);
