#!/usr/bin/env npx tsx
/**
 * Verify attachment status after backfill
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
  console.log('║      ATTACHMENT STATUS VERIFICATION                                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get ALL emails with has_attachments=true (with pagination)
  let allWithFlag: string[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data } = await supabase
      .from('raw_emails')
      .select('id')
      .eq('has_attachments', true)
      .range(offset, offset + limit - 1);

    if (!data || data.length === 0) break;
    allWithFlag.push(...data.map(e => e.id));
    offset += limit;
    if (data.length < limit) break;
  }

  console.log('1. Emails with has_attachments=true:', allWithFlag.length);

  // Get ALL emails with attachment records
  const { data: attEmails } = await supabase
    .from('raw_attachments')
    .select('email_id');

  const emailsWithAttachments = new Set((attEmails || []).map(a => a.email_id));
  console.log('2. Unique emails with raw_attachments records:', emailsWithAttachments.size);

  // Find the gap
  const missing = allWithFlag.filter(id => !emailsWithAttachments.has(id));
  console.log('3. Gap (flag=true but no record):', missing.length);

  // Count total attachments
  const { count: totalAtts } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true });
  console.log('4. Total attachment records:', totalAtts);

  // Check by document type
  console.log('\n\nATTACHMENT STATUS BY DOCUMENT TYPE:');
  console.log('─'.repeat(70));

  const documentTypes = [
    'booking_confirmation',
    'booking_amendment',
    'arrival_notice',
    'invoice',
    'si_submitted',
    'bl_draft',
    'bl_final',
    'unclassified'
  ];

  console.log('DOC TYPE                | TOTAL | HAS_ATT=TRUE | HAS_RECORD | %');
  console.log('─'.repeat(70));

  for (const docType of documentTypes) {
    // Get emails for this doc type
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id')
      .eq('document_type', docType);

    if (!classifications || classifications.length === 0) {
      console.log(`${docType.padEnd(24)}|     0 |            0 |          0 | N/A`);
      continue;
    }

    const emailIds = classifications.map(c => c.email_id);

    // Get emails with has_attachments=true
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, has_attachments')
      .in('id', emailIds);

    const total = emails?.length || 0;
    const withAttFlag = (emails || []).filter(e => e.has_attachments === true).length;

    // Check how many have records in raw_attachments
    let withRecord = 0;
    for (const e of emails || []) {
      if (emailsWithAttachments.has(e.id)) {
        withRecord++;
      }
    }

    const pct = total > 0 ? Math.round((withRecord / total) * 100) : 0;
    console.log(`${docType.padEnd(24)}| ${String(total).padStart(5)} | ${String(withAttFlag).padStart(12)} | ${String(withRecord).padStart(10)} | ${String(pct).padStart(2)}%`);
  }

  // Sample missing emails
  if (missing.length > 0) {
    console.log('\n\nSAMPLE MISSING (has_attachments=true but no raw_attachments):');
    console.log('─'.repeat(70));

    const sampleIds = missing.slice(0, 5);
    for (const id of sampleIds) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject, sender_email, has_attachments, attachment_count')
        .eq('id', id)
        .single();

      if (email) {
        console.log(`Subject: ${email.subject?.substring(0, 55)}`);
        console.log(`  Sender: ${email.sender_email}`);
        console.log(`  has_attachments: ${email.has_attachments}, attachment_count: ${email.attachment_count}`);
        console.log('');
      }
    }
  }
}

main().catch(console.error);
