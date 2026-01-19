/**
 * Analyze Gmail mailbox - investigate email counts and senders
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createChronicleGmailService } from '../lib/chronicle';

async function analyzeMailbox() {
  const gmail = createChronicleGmailService();

  console.log('='.repeat(60));
  console.log('GMAIL MAILBOX ANALYSIS');
  console.log('='.repeat(60));

  // Check different date ranges
  const ranges = [
    { name: 'Dec 1-7', after: '2025-12-01', before: '2025-12-08' },
    { name: 'Dec 8-14', after: '2025-12-08', before: '2025-12-15' },
    { name: 'Dec 15-21', after: '2025-12-15', before: '2025-12-22' },
    { name: 'Dec 22-31', after: '2025-12-22', before: '2026-01-01' },
    { name: 'Jan 1-5', after: '2026-01-01', before: '2026-01-06' },
    { name: 'Jan 6-10', after: '2026-01-06', before: '2026-01-11' },
  ];

  console.log('\n📊 EMAIL COUNTS BY WEEK:');
  console.log('-'.repeat(40));

  for (const range of ranges) {
    const afterTs = Math.floor(new Date(range.after).getTime() / 1000);
    const beforeTs = Math.floor(new Date(range.before).getTime() / 1000);
    const query = `after:${afterTs} before:${beforeTs}`;

    let count = 0;
    let pageToken: string | undefined;

    do {
      const response = await gmail['gmail'].users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
        pageToken,
      });

      count += response.data.messages?.length || 0;
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken && count < 2000);

    const suffix = count >= 2000 ? '+' : '';
    console.log(`  ${range.name.padEnd(12)}: ${count}${suffix} emails`);
  }

  // Sample sender analysis
  console.log('\n📧 SAMPLE SENDERS (Dec 15-20):');
  console.log('-'.repeat(60));

  const sampleAfter = Math.floor(new Date('2025-12-15').getTime() / 1000);
  const sampleBefore = Math.floor(new Date('2025-12-20').getTime() / 1000);
  const sampleQuery = `after:${sampleAfter} before:${sampleBefore}`;

  const sampleResponse = await gmail['gmail'].users.messages.list({
    userId: 'me',
    q: sampleQuery,
    maxResults: 30,
  });

  const senderCounts: Record<string, number> = {};

  for (const msg of sampleResponse.data.messages || []) {
    const detail = await gmail['gmail'].users.messages.get({
      userId: 'me',
      id: msg.id as string,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });

    const from = detail.data.payload?.headers?.find(h => h.name === 'From')?.value || 'unknown';
    const subject = detail.data.payload?.headers?.find(h => h.name === 'Subject')?.value || '';
    const date = detail.data.payload?.headers?.find(h => h.name === 'Date')?.value || '';

    // Extract domain
    const domainMatch = from.match(/@([^\s>]+)/);
    const domain = domainMatch ? domainMatch[1] : from.substring(0, 30);
    senderCounts[domain] = (senderCounts[domain] || 0) + 1;

    console.log(`  ${domain.padEnd(35)} | ${subject.substring(0, 40)}`);
  }

  console.log('\n📈 TOP SENDER DOMAINS:');
  console.log('-'.repeat(40));
  const sortedDomains = Object.entries(senderCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [domain, count] of sortedDomains) {
    console.log(`  ${domain.padEnd(35)}: ${count}`);
  }

  console.log('\n' + '='.repeat(60));
}

analyzeMailbox()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
