/**
 * Show sample PDF extractions by document type
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function showSamples() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('SAMPLE PDF EXTRACTIONS BY DOCUMENT TYPE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get all PDFs with extracted text
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, filename, extracted_text')
    .not('extracted_text', 'is', null)
    .ilike('filename', '%.pdf')
    .limit(500);

  if (!attachments) {
    console.log('No extracted PDFs found');
    return;
  }

  const emailIdsWithPdfs = [...new Set(attachments.map(a => a.email_id))];

  // Get classifications for these emails - batch in chunks
  const allClassifications: any[] = [];
  const batchSize = 100;

  for (let i = 0; i < emailIdsWithPdfs.length; i += batchSize) {
    const batch = emailIdsWithPdfs.slice(i, i + batchSize);
    const { data } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .in('email_id', batch);
    if (data) allClassifications.push(...data);
  }

  const classifications = allClassifications;

  // Group by document type
  const byDocType: Record<string, string[]> = {};
  for (const c of classifications || []) {
    if (!byDocType[c.document_type]) byDocType[c.document_type] = [];
    byDocType[c.document_type].push(c.email_id);
  }

  // Show samples for top document types
  const docTypes = Object.entries(byDocType)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([type]) => type);

  console.log(`Document types with extracted PDFs: ${Object.keys(byDocType).join(', ')}`);
  console.log('');

  for (const docType of docTypes) {
    const emailId = byDocType[docType]?.[0];
    if (!emailId) continue;

    const classification = { email_id: emailId };

    // Get attachment for this email
    const { data: att } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', classification.email_id)
      .not('extracted_text', 'is', null)
      .ilike('filename', '%.pdf')
      .limit(1)
      .single();

    if (!att) {
      console.log(`▶ ${docType.toUpperCase().replace(/_/g, ' ')}: No PDF with extracted text`);
      console.log('');
      continue;
    }

    // Get email subject
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, sender_email')
      .eq('id', classification.email_id)
      .single();

    console.log(`▶ ${docType.toUpperCase().replace(/_/g, ' ')}`);
    console.log('─'.repeat(70));
    console.log(`  Subject: ${(email?.subject?.substring(0, 60) || 'N/A')}...`);
    console.log(`  Sender: ${email?.sender_email}`);
    console.log(`  PDF: ${att.filename}`);
    console.log(`  Characters: ${att.extracted_text.length}`);
    console.log('');
    console.log('  EXTRACTED TEXT (key content):');
    console.log('  ' + '─'.repeat(60));

    // Show first 800 chars with line formatting
    const text = att.extracted_text || '';
    const lines = text.substring(0, 800).split('\n').slice(0, 20);
    for (const line of lines) {
      if (line.trim()) {
        console.log('  ' + line.substring(0, 70));
      }
    }
    console.log('  ...');
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

showSamples().catch(console.error);
