#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyze() {
  // Get count first
  const { count: totalCount } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  console.log('TOTAL EMAILS IN DB:', totalCount);

  // Get ALL email IDs (increase limit)
  const { data: allEmails } = await supabase.from('raw_emails').select('id, subject, sender_email').limit(5000);

  // Get classified email IDs
  const { data: classifications } = await supabase.from('document_classifications').select('email_id').limit(5000);
  const classifiedIds = new Set(classifications?.map(c => c.email_id) || []);

  // Find unclassified
  const unclassified = allEmails?.filter(e => classifiedIds.has(e.id) === false) || [];

  console.log('TOTAL EMAILS:', allEmails?.length);
  console.log('CLASSIFIED:', classifiedIds.size);
  console.log('UNCLASSIFIED:', unclassified.length);

  // Sample unclassified subjects
  console.log('\nSAMPLE UNCLASSIFIED EMAIL SUBJECTS:');
  unclassified.slice(0, 20).forEach(e => {
    console.log('  -', (e.subject || '[NO SUBJECT]').substring(0, 70));
  });

  // Check sender patterns for unclassified
  console.log('\nUNCLASSIFIED BY SENDER DOMAIN:');
  const byDomain: Record<string, number> = {};
  unclassified.forEach(e => {
    const domain = e.sender_email?.split('@')[1] || 'unknown';
    byDomain[domain] = (byDomain[domain] || 0) + 1;
  });

  Object.entries(byDomain)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([domain, count]) => console.log('  ' + domain + ': ' + count));

  // Check for booking-related in unclassified
  const bookingUnclassified = unclassified.filter(e => {
    const subj = (e.subject || '').toLowerCase();
    return subj.includes('booking') || subj.includes('confirmation') || subj.includes('amendment');
  });

  console.log('\nUNCLASSIFIED WITH BOOKING/CONFIRMATION IN SUBJECT:', bookingUnclassified.length);
  bookingUnclassified.slice(0, 10).forEach(e => {
    console.log('  -', e.subject?.substring(0, 70));
  });
}

analyze().catch(console.error);
