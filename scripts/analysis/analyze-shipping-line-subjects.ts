#!/usr/bin/env npx tsx
/**
 * Deep analysis of shipping line email subjects for deterministic classification
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface EmailInfo {
  subject: string;
  sender: string;
  hasAttachments: boolean;
  attachmentNames: string[];
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      DEEP DIVE: SHIPPING LINE EMAIL SUBJECT ANALYSIS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all emails with attachments info
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email');

  // Get attachments
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, filename');

  // Group attachments by email
  const attByEmail = new Map<string, string[]>();
  for (const a of attachments || []) {
    const list = attByEmail.get(a.email_id) || [];
    list.push(a.filename);
    attByEmail.set(a.email_id, list);
  }

  // Categorize by carrier
  const carriers: Record<string, EmailInfo[]> = {
    'MAERSK': [],
    'HAPAG-LLOYD': [],
    'CMA-CGM': [],
    'COSCO': [],
    'MSC': [],
  };

  for (const e of emails || []) {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();
    const atts = attByEmail.get(e.id) || [];

    const info: EmailInfo = {
      subject: e.subject || '',
      sender,
      hasAttachments: atts.length > 0,
      attachmentNames: atts,
    };

    if (sender.includes('maersk.com')) {
      carriers['MAERSK'].push(info);
    } else if (sender.includes('hapag') || sender.includes('hlag')) {
      carriers['HAPAG-LLOYD'].push(info);
    } else if (sender.includes('cma-cgm')) {
      carriers['CMA-CGM'].push(info);
    } else if (sender.includes('coscon')) {
      carriers['COSCO'].push(info);
    } else if (sender.includes('msc.com')) {
      carriers['MSC'].push(info);
    }
  }

  // Analyze each carrier
  for (const [carrier, emailList] of Object.entries(carriers)) {
    if (emailList.length === 0) continue;

    console.log('\n' + '═'.repeat(80));
    console.log('📧 ' + carrier + ' (' + emailList.length + ' emails)');
    console.log('═'.repeat(80));

    // Group by subject prefix (first 50 chars normalized)
    const groups: Record<string, { count: number; samples: EmailInfo[] }> = {};

    for (const e of emailList) {
      // Normalize subject - remove booking numbers, dates, etc.
      let prefix = e.subject.substring(0, 60);
      prefix = prefix.replace(/[A-Z]{2,4}\d{7,}/g, 'XXX'); // Booking numbers
      prefix = prefix.replace(/\d{8,}/g, 'NNN'); // Long numbers
      prefix = prefix.replace(/HL-\d+/g, 'HL-XXX'); // Hapag booking
      prefix = prefix.replace(/COSU\d+/g, 'COSU-XXX'); // COSCO booking
      prefix = prefix.replace(/\d{2}-[A-Za-z]{3}-\d{4}/g, 'DATE'); // Dates

      if (!groups[prefix]) {
        groups[prefix] = { count: 0, samples: [] };
      }
      groups[prefix].count++;
      if (groups[prefix].samples.length < 2) {
        groups[prefix].samples.push(e);
      }
    }

    // Show patterns sorted by count
    const sorted = Object.entries(groups).sort((a, b) => b[1].count - a[1].count);

    console.log('\nSUBJECT PATTERNS (grouped):');
    console.log('─'.repeat(80));

    for (const [pattern, data] of sorted.slice(0, 25)) {
      const pdfAtts = data.samples[0]?.attachmentNames.filter(a =>
        a.toLowerCase().endsWith('.pdf')
      ) || [];

      console.log('\n[' + data.count + '] ' + pattern);
      console.log('    PDFs: ' + (pdfAtts.length > 0 ? pdfAtts.join(', ') : 'none'));

      // Show full subject sample
      if (data.samples[0]) {
        console.log('    Sample: ' + data.samples[0].subject.substring(0, 80));
      }
    }
  }

  // Summary for classification
  console.log('\n\n' + '═'.repeat(80));
  console.log('📋 CLASSIFICATION CATEGORIES TO IDENTIFY');
  console.log('═'.repeat(80));
  console.log(`
For each carrier, identify patterns for:

1. BOOKING CONFIRMATION
   - Original booking confirmed by carrier
   - Has PDF with vessel, dates, cutoffs

2. BOOKING AMENDMENT / UPDATE
   - Changes to existing booking
   - Vessel change, date change, routing change

3. BOOKING CANCELLATION
   - Booking cancelled

4. SI CONFIRMATION
   - Shipping instruction submitted/confirmed
   - SI draft received

5. BILL OF LADING (MBL)
   - Draft BL
   - Original BL
   - BL released

6. INVOICE
   - Freight invoice
   - Proforma invoice

7. ARRIVAL NOTICE (VERY IMPORTANT)
   - Cargo arrival notification
   - Pre-arrival notice
   - Discharge notification
`);
}

main().catch(console.error);
