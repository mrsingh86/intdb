#!/usr/bin/env npx tsx
/**
 * Verify attachment stats by document type
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
  console.log('║      ATTACHMENT STATS BY DOCUMENT TYPE                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // First, get ALL emails with attachment records (using pagination)
  const emailsWithAttachments = new Set<string>();
  let offset = 0;
  while (true) {
    const { data } = await supabase
      .from('raw_attachments')
      .select('email_id')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    data.forEach(d => emailsWithAttachments.add(d.email_id));
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`Total unique emails with attachment records: ${emailsWithAttachments.size}\n`);

  // Document types to check
  const documentTypes = [
    'booking_confirmation',
    'booking_amendment',
    'arrival_notice',
    'invoice',
    'si_submitted',
    'si_draft',
    'bl_draft',
    'bl_final',
    'vgm_confirmation',
    'cargo_release',
    'delivery_order',
    'customer_support_case',
    'unclassified'
  ];

  console.log('DOCUMENT TYPE             | EMAILS | HAS_ATT | WITH REC | % COVERED');
  console.log('─'.repeat(75));

  for (const docType of documentTypes) {
    // Get all emails for this document type
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('email_id')
      .eq('document_type', docType);

    if (!classifications || classifications.length === 0) {
      continue; // Skip if no emails of this type
    }

    const emailIds = classifications.map(c => c.email_id);

    // Get email details
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, has_attachments')
      .in('id', emailIds);

    const total = emails?.length || 0;
    const withFlag = (emails || []).filter(e => e.has_attachments === true).length;

    // Count how many have attachment records
    let withRecord = 0;
    for (const e of emails || []) {
      if (emailsWithAttachments.has(e.id)) {
        withRecord++;
      }
    }

    const pct = withFlag > 0 ? Math.round((withRecord / withFlag) * 100) : 0;

    console.log(
      `${docType.padEnd(25)} | ${String(total).padStart(6)} | ${String(withFlag).padStart(7)} | ${String(withRecord).padStart(8)} | ${String(pct).padStart(3)}%`
    );
  }

  // Also show attachment type breakdown
  console.log('\n\n');
  console.log('ATTACHMENT FILE TYPES (Top 15):');
  console.log('─'.repeat(60));

  // Get attachment counts by mime type
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('mime_type, filename');

  const mimeTypeCounts: Record<string, number> = {};
  const extensionCounts: Record<string, number> = {};

  for (const att of attachments || []) {
    // Count by mime type
    const mime = att.mime_type || 'unknown';
    mimeTypeCounts[mime] = (mimeTypeCounts[mime] || 0) + 1;

    // Count by extension
    const ext = att.filename?.split('.').pop()?.toLowerCase() || 'no_ext';
    extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
  }

  // Sort and display top extensions
  const sortedExts = Object.entries(extensionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  for (const [ext, count] of sortedExts) {
    const bar = '█'.repeat(Math.min(30, Math.round(count / 500)));
    console.log(`${ext.padEnd(10)} ${String(count).padStart(6)} ${bar}`);
  }

  // Show PDF stats specifically
  console.log('\n\n');
  console.log('PDF ATTACHMENTS BY DOCUMENT TYPE:');
  console.log('─'.repeat(60));

  for (const docType of ['booking_confirmation', 'booking_amendment', 'arrival_notice', 'invoice']) {
    const { data: cls } = await supabase
      .from('document_classifications')
      .select('email_id')
      .eq('document_type', docType);

    if (!cls || cls.length === 0) continue;

    const emailIds = cls.map(c => c.email_id);

    // Get PDFs for these emails
    const { data: pdfs } = await supabase
      .from('raw_attachments')
      .select('email_id, filename')
      .in('email_id', emailIds)
      .ilike('filename', '%.pdf');

    const uniqueEmailsWithPdf = new Set((pdfs || []).map(p => p.email_id));

    console.log(`${docType}: ${uniqueEmailsWithPdf.size}/${cls.length} emails have PDF (${Math.round(uniqueEmailsWithPdf.size / cls.length * 100)}%)`);
  }
}

main().catch(console.error);
