#!/usr/bin/env npx tsx
/**
 * Analyze BC-type email volumes and classification
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
  console.log('║                    BC-TYPE EMAIL VOLUME ANALYSIS                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all classifications
  const { data: allCls } = await supabase
    .from('document_classifications')
    .select('email_id, document_type');

  const clsMap = new Map(allCls?.map(c => [c.email_id, c.document_type]));

  // Get all emails with BC-related keywords in subject
  const { data: bcKeywordEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('subject.ilike.%booking confirm%,subject.ilike.%booking amendment%,subject.ilike.%bkg conf%,subject.ilike.%update%booking%,subject.ilike.%revised%booking%');

  console.log('=== EMAILS WITH BC KEYWORDS IN SUBJECT ===');
  console.log('Total:', bcKeywordEmails?.length);

  // How are they classified?
  const byType: Record<string, number> = {};
  for (const e of bcKeywordEmails || []) {
    const type = clsMap.get(e.id) || 'unclassified';
    byType[type] = (byType[type] || 0) + 1;
  }

  console.log('\nClassification breakdown:');
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('  ' + k + ': ' + v));

  // Get BC emails by shipping line
  const bcTypes = ['booking_confirmation', 'booking_amendment'];
  const bcEmailIds = allCls?.filter(c => bcTypes.includes(c.document_type)).map(c => c.email_id) || [];

  const { data: bcEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .in('id', bcEmailIds);

  console.log('\n=== BC EMAILS BY SHIPPING LINE ===');
  console.log('Total BC-type:', bcEmails?.length);

  const shippingLines: Record<string, { total: number; samples: string[] }> = {
    'maersk.com': { total: 0, samples: [] },
    'hapag-lloyd.com/hlag.com': { total: 0, samples: [] },
    'cma-cgm.com': { total: 0, samples: [] },
    'coscon.com': { total: 0, samples: [] },
    'msc.com': { total: 0, samples: [] },
    'one-line.com': { total: 0, samples: [] },
    'internal/forward': { total: 0, samples: [] },
  };

  for (const e of bcEmails || []) {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();
    const subject = e.subject || '';

    if (sender.includes('maersk.com')) {
      shippingLines['maersk.com'].total++;
      if (shippingLines['maersk.com'].samples.length < 2) {
        shippingLines['maersk.com'].samples.push(subject.substring(0, 50));
      }
    } else if (sender.includes('hapag') || sender.includes('hlag')) {
      shippingLines['hapag-lloyd.com/hlag.com'].total++;
      if (shippingLines['hapag-lloyd.com/hlag.com'].samples.length < 2) {
        shippingLines['hapag-lloyd.com/hlag.com'].samples.push(subject.substring(0, 50));
      }
    } else if (sender.includes('cma-cgm')) {
      shippingLines['cma-cgm.com'].total++;
      if (shippingLines['cma-cgm.com'].samples.length < 2) {
        shippingLines['cma-cgm.com'].samples.push(subject.substring(0, 50));
      }
    } else if (sender.includes('coscon')) {
      shippingLines['coscon.com'].total++;
      if (shippingLines['coscon.com'].samples.length < 2) {
        shippingLines['coscon.com'].samples.push(subject.substring(0, 50));
      }
    } else if (sender.includes('msc.com')) {
      shippingLines['msc.com'].total++;
      if (shippingLines['msc.com'].samples.length < 2) {
        shippingLines['msc.com'].samples.push(subject.substring(0, 50));
      }
    } else if (sender.includes('one-line')) {
      shippingLines['one-line.com'].total++;
    } else {
      shippingLines['internal/forward'].total++;
      if (shippingLines['internal/forward'].samples.length < 3) {
        shippingLines['internal/forward'].samples.push(sender.substring(0, 30) + ' | ' + subject.substring(0, 40));
      }
    }
  }

  let shippingLineTotal = 0;
  for (const [line, data] of Object.entries(shippingLines)) {
    if (line !== 'internal/forward') {
      shippingLineTotal += data.total;
    }
    console.log('\n' + line + ': ' + data.total);
    data.samples.forEach(s => console.log('  - ' + s));
  }

  console.log('\n─────────────────────────────────────────');
  console.log('Total from shipping lines: ' + shippingLineTotal);
  console.log('Total internal/forward: ' + shippingLines['internal/forward'].total);

  // Check if there are booking-related emails classified as something else
  console.log('\n\n=== POTENTIALLY MISCLASSIFIED BC EMAILS ===');

  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email');

  const shippingDomains = ['maersk.com', 'hapag', 'hlag', 'cma-cgm', 'coscon', 'msc.com', 'one-line'];

  const shippingLineEmails = allEmails?.filter(e => {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();
    return shippingDomains.some(d => sender.includes(d));
  }) || [];

  console.log('Total emails from shipping lines: ' + shippingLineEmails.length);

  // Check subjects for BC keywords
  const bcKeywords = ['booking', 'confirmation', 'confirmed', 'amendment', 'update', 'revised'];
  const potentialBCs = shippingLineEmails.filter(e => {
    const subject = (e.subject || '').toLowerCase();
    return bcKeywords.some(kw => subject.includes(kw));
  });

  console.log('With BC keywords in subject: ' + potentialBCs.length);

  // How many are NOT classified as BC?
  const notClassifiedAsBC = potentialBCs.filter(e => {
    const type = clsMap.get(e.id);
    return type !== 'booking_confirmation' && type !== 'booking_amendment';
  });

  console.log('NOT classified as BC: ' + notClassifiedAsBC.length);

  if (notClassifiedAsBC.length > 0) {
    console.log('\nSamples:');
    for (const e of notClassifiedAsBC.slice(0, 10)) {
      const type = clsMap.get(e.id);
      console.log('  [' + type + '] ' + e.subject?.substring(0, 60));
    }
  }
}

main().catch(console.error);
