require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log('='.repeat(100));
  console.log('SEARCHING FOR CUSTOMS BROKER EMAILS');
  console.log('='.repeat(100));

  // Get unique sender domains
  const { data: senders } = await supabase
    .from('raw_emails')
    .select('sender_email')
    .order('received_at', { ascending: false })
    .limit(3000);

  const domains = new Map();
  for (const s of senders || []) {
    if (!s.sender_email) continue;
    const match = s.sender_email.match(/@([a-zA-Z0-9.-]+)/);
    if (match) {
      const domain = match[1].toLowerCase();
      domains.set(domain, (domains.get(domain) || 0) + 1);
    }
  }

  // Filter for potential brokers
  console.log('\n📋 POTENTIAL CUSTOMS BROKER DOMAINS\n');
  const brokerKeywords = ['customs', 'broker', 'clearance', 'artimus', 'seven', 'seas', 'jmd', 'entry', 'portside'];
  const brokerDomains = [...domains.entries()]
    .filter(([domain]) => brokerKeywords.some(kw => domain.includes(kw)))
    .sort((a, b) => b[1] - a[1]);

  for (const [domain, count] of brokerDomains) {
    console.log(`  ${domain}: ${count} emails`);
  }

  // List top domains
  console.log('\n📋 TOP 40 EMAIL DOMAINS (to find brokers)\n');
  const topDomains = [...domains.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40);

  for (const [domain, count] of topDomains) {
    console.log(`  ${domain}: ${count}`);
  }

  // Check JMD Customs (appears to be a broker)
  console.log('\n📋 JMD CUSTOMS EMAILS\n');
  const { data: jmd } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .ilike('sender_email', '%jmdcustoms%')
    .order('received_at', { ascending: false })
    .limit(15);

  console.log(`Found ${jmd?.length || 0} JMD Customs emails\n`);
  for (const e of jmd || []) {
    console.log(`Subject: ${(e.subject || '').substring(0, 80)}`);
  }
}

check().catch(console.error);
