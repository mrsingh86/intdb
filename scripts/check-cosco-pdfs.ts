#!/usr/bin/env npx tsx
/**
 * Check COSCO PDF attachments and their extraction status
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get COSCO booking confirmation emails
  const { data: bcs } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const emailIds = bcs?.map(e => e.email_id) || [];

  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .in('id', emailIds);

  const coscoEmails = emails?.filter(e =>
    e.subject?.toLowerCase().includes('cosco')
  ) || [];

  console.log('COSCO Booking Confirmation Emails:', coscoEmails.length);

  // Get their attachments
  const coscoIds = coscoEmails.map(e => e.id);
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, mime_type, file_size, extracted_text, status, content_bytes')
    .in('email_id', coscoIds);

  console.log('\nCOSCO Attachments:', attachments?.length);

  // Separate by extraction status
  const pdfs = attachments?.filter(a => a.mime_type?.includes('pdf') || a.filename?.endsWith('.pdf')) || [];
  const withText = pdfs.filter(a => a.extracted_text && a.extracted_text.length > 0);
  const withoutText = pdfs.filter(a => a.extracted_text === null || a.extracted_text === '');

  console.log('\nPDF Attachments:', pdfs.length);
  console.log('  With extracted text:', withText.length);
  console.log('  Without extracted text:', withoutText.length);

  // Check content_bytes availability
  console.log('\nPDFs without text - content_bytes status:');
  for (const p of withoutText) {
    const bytesLen = p.content_bytes ? (typeof p.content_bytes === 'string' ? p.content_bytes.length : 0) : 0;
    console.log(`  ${p.filename}: status=${p.status}, content_bytes=${bytesLen > 0 ? bytesLen + ' chars' : 'NULL'}`);
  }

  // Check if we need to refetch from Gmail
  if (withoutText.length > 0 && withoutText.every(p => !p.content_bytes)) {
    console.log('\n⚠️  All PDFs without text have NO content_bytes stored.');
    console.log('   Need to re-fetch attachments from Gmail and extract text.');
  }

  // Check all attachment types
  console.log('\nAll COSCO attachment types:');
  const byType: Record<string, number> = {};
  for (const a of attachments || []) {
    const type = a.mime_type || 'unknown';
    byType[type] = (byType[type] || 0) + 1;
  }
  Object.entries(byType).forEach(([type, count]) => console.log(`  ${type}: ${count}`));
}

main().catch(console.error);
