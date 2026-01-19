#!/usr/bin/env npx tsx
/**
 * Verify actual attachment counts by document type
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
  console.log('║      CORRECT ATTACHMENT ANALYSIS BY DOCUMENT TYPE                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  const documentTypes = [
    'booking_confirmation',
    'booking_amendment',
    'arrival_notice',
    'invoice',
    'si_submitted',
    'bl_draft',
    'bl_final'
  ];

  console.log('DOCUMENT TYPE           | TOTAL | WITH ATT | % WITH ATT');
  console.log('─'.repeat(65));

  for (const docType of documentTypes) {
    // Get emails for this document type from document_classifications
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id')
      .eq('document_type', docType);

    if (!classifications || classifications.length === 0) {
      console.log(`${docType.padEnd(23)} |     0 |        0 |    N/A`);
      continue;
    }

    const emailIds = classifications.map(c => c.email_id);

    // Get emails with has_attachments = true
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, has_attachments, attachment_count')
      .in('id', emailIds);

    const total = emails?.length || 0;
    const withAttachments = (emails || []).filter(e => e.has_attachments === true).length;
    const pct = total > 0 ? Math.round((withAttachments / total) * 100) : 0;

    console.log(`${docType.padEnd(23)} | ${String(total).padStart(5)} | ${String(withAttachments).padStart(8)} | ${String(pct).padStart(5)}%`);
  }

  // Now investigate the gap: why 386 has_attachments but only 224 in raw_attachments
  console.log('\n\n');
  console.log('GAP INVESTIGATION: has_attachments vs raw_attachments records');
  console.log('═'.repeat(80));

  // Count emails with has_attachments=true
  const { count: flagCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('has_attachments', true);

  // Count unique emails in raw_attachments
  const { data: attEmails } = await supabase
    .from('raw_attachments')
    .select('email_id');

  const uniqueEmailsWithAttachments = new Set((attEmails || []).map(a => a.email_id));

  console.log('Emails with has_attachments=true:', flagCount);
  console.log('Unique emails in raw_attachments:', uniqueEmailsWithAttachments.size);
  console.log('Gap:', (flagCount || 0) - uniqueEmailsWithAttachments.size);

  // Sample emails with flag but no record
  console.log('\nSample emails with has_attachments=true but NO raw_attachments record:');
  console.log('─'.repeat(80));

  const { data: withFlag } = await supabase
    .from('raw_emails')
    .select('id, subject, has_attachments, attachment_count')
    .eq('has_attachments', true)
    .limit(200);

  let missing = 0;
  for (const email of withFlag || []) {
    if (!uniqueEmailsWithAttachments.has(email.id)) {
      if (missing < 5) {
        console.log('Subject:', email.subject?.substring(0, 60));
        console.log('  has_attachments:', email.has_attachments);
        console.log('  attachment_count:', email.attachment_count);
        console.log('');
      }
      missing++;
    }
  }
  console.log('Total missing in sample of 200:', missing);
}

main().catch(console.error);
