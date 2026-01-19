import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function analyzeSenders() {
  // Check table count first
  const { count: emailCount } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  console.log('Total raw_emails:', emailCount);

  // Get all unique senders
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('sender_email, recipient_emails, subject')
    .not('sender_email', 'is', null);

  if (error) {
    console.error('Error fetching emails:', error);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('No emails found');
    return;
  }

  console.log('Fetched emails:', emails.length);

  // Count by sender domain
  const senderDomains = new Map<string, { count: number; examples: string[] }>();

  for (const email of emails) {
    const domain = email.sender_email.split('@')[1]?.toLowerCase() || 'unknown';
    if (!senderDomains.has(domain)) {
      senderDomains.set(domain, { count: 0, examples: [] });
    }
    const entry = senderDomains.get(domain)!;
    entry.count++;
    if (entry.examples.length < 3) {
      entry.examples.push(email.sender_email);
    }
  }

  // Sort by count
  const sorted = [...senderDomains.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log('\n=== SENDER DOMAINS ===\n');
  for (const [domain, info] of sorted.slice(0, 30)) {
    console.log(`${domain}: ${info.count} emails`);
    console.log(`  Examples: ${info.examples.join(', ')}`);
  }

  // Analyze recipients too
  const recipientDomains = new Map<string, number>();
  for (const email of emails) {
    if (email.recipient_emails) {
      const recipients = Array.isArray(email.recipient_emails)
        ? email.recipient_emails
        : [email.recipient_emails];
      for (const r of recipients) {
        if (typeof r === 'string') {
          const domain = r.split('@')[1]?.toLowerCase() || 'unknown';
          recipientDomains.set(domain, (recipientDomains.get(domain) || 0) + 1);
        }
      }
    }
  }

  console.log('\n=== RECIPIENT DOMAINS ===\n');
  const sortedRecipients = [...recipientDomains.entries()].sort((a, b) => b[1] - a[1]);
  for (const [domain, count] of sortedRecipients.slice(0, 20)) {
    console.log(`${domain}: ${count} emails`);
  }
}

analyzeSenders().catch(console.error);
