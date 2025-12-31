#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkPdfDistribution() {
  console.log('=== PDF TEXT DISTRIBUTION ===\n');

  // Get PDFs with text by email
  const { data: pdfsWithText } = await supabase
    .from('raw_attachments')
    .select('email_id')
    .not('extracted_text', 'is', null);

  const emailsWithPdf = new Set(pdfsWithText?.map(p => p.email_id) || []);
  console.log('Emails with extracted PDF text:', emailsWithPdf.size);

  // Get booking confirmation emails
  const { data: bookingClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bookingIds = new Set(bookingClassifications?.map(c => c.email_id) || []);
  console.log('Booking confirmation emails:', bookingIds.size);

  // Intersection
  let intersection = 0;
  for (const id of emailsWithPdf) {
    if (bookingIds.has(id)) intersection++;
  }
  console.log('Booking emails with PDF text:', intersection);

  // Check what document types have PDFs
  console.log('\n=== PDF TEXT BY DOCUMENT TYPE ===');
  const { data: allClassifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type');

  const pdfsByType: Record<string, number> = {};
  for (const c of allClassifications || []) {
    if (emailsWithPdf.has(c.email_id)) {
      pdfsByType[c.document_type] = (pdfsByType[c.document_type] || 0) + 1;
    }
  }

  Object.entries(pdfsByType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log('  ' + type + ': ' + count);
    });

  // Check for cutoff info in booking_amendment emails
  console.log('\n=== CUTOFF INFO IN BOOKING AMENDMENTS ===');
  const { data: amendments } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_amendment');

  const amendmentIds = amendments?.map(a => a.email_id) || [];

  const { data: amendmentEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .in('id', amendmentIds);

  let amendmentsWithCutoff = 0;
  for (const email of amendmentEmails || []) {
    const body = (email.body_text || '').toLowerCase();
    if (body.includes('cut') || body.includes('deadline') || body.includes('closing')) {
      amendmentsWithCutoff++;
    }
  }
  console.log('Booking amendments:', amendmentEmails?.length);
  console.log('With cutoff keywords:', amendmentsWithCutoff);

  // Summary of current state
  console.log('\n=== SUMMARY ===');
  console.log('Total emails with PDF text:', emailsWithPdf.size);
  console.log('Classified as booking_confirmation:', intersection);
  console.log('In other document types:', emailsWithPdf.size - intersection);
}

checkPdfDistribution().catch(console.error);
