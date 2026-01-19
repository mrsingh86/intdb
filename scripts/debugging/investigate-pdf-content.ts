#!/usr/bin/env npx tsx
/**
 * Investigate PDF content for shipments missing cutoffs
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  // Get shipments missing ALL cutoffs
  const { data: missingShipments } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .is('si_cutoff', null)
    .is('vgm_cutoff', null)
    .is('cargo_cutoff', null)
    .limit(20);

  console.log('Investigating shipments missing cutoffs...\n');

  for (const shipment of missingShipments || []) {
    const bn = shipment.booking_number;
    if (!bn || bn.length < 6) continue;

    const searchTerm = bn.substring(0, 8);

    // Find related emails
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject')
      .or(`subject.ilike.%${searchTerm}%,body_text.ilike.%${searchTerm}%`)
      .limit(5);

    if (!emails || emails.length === 0) {
      console.log(`${bn}: No related emails found`);
      continue;
    }

    console.log(`\n═══ ${bn} ═══`);
    console.log(`Related emails: ${emails.length}`);

    // Get PDF attachments for these emails
    const emailIds = emails.map(e => e.id);
    const { data: pdfs } = await supabase
      .from('raw_attachments')
      .select('id, email_id, filename, extracted_text, extraction_status')
      .ilike('mime_type', '%pdf%')
      .in('email_id', emailIds);

    if (!pdfs || pdfs.length === 0) {
      console.log('  No PDF attachments found');
      emails.forEach(e => console.log('  Email:', e.subject?.substring(0, 60)));
      continue;
    }

    console.log(`PDF attachments: ${pdfs.length}`);

    for (const pdf of pdfs.slice(0, 3)) {
      const email = emails.find(e => e.id === pdf.email_id);
      console.log(`\n  PDF: ${pdf.filename}`);
      console.log(`  Email: ${email?.subject?.substring(0, 50)}`);
      console.log(`  Extraction status: ${pdf.extraction_status || 'unknown'}`);
      console.log(`  Text length: ${pdf.extracted_text?.length || 0}`);

      if (pdf.extracted_text) {
        const text = pdf.extracted_text.toLowerCase();
        const hasCutoff = text.includes('cut-off') || text.includes('cutoff');
        const hasClosing = text.includes('closing');
        const hasDeadline = text.includes('deadline');
        const hasSI = text.includes('shipping instruction') || text.includes('si closing');
        const hasVGM = text.includes('vgm');
        const hasCY = text.includes('cy ') || text.includes('container yard');

        console.log(`  Has 'cut-off/cutoff': ${hasCutoff}`);
        console.log(`  Has 'closing': ${hasClosing}`);
        console.log(`  Has 'deadline': ${hasDeadline}`);
        console.log(`  Has 'SI'/instruction: ${hasSI}`);
        console.log(`  Has 'VGM': ${hasVGM}`);
        console.log(`  Has 'CY'/container yard: ${hasCY}`);

        // Sample some text
        if (hasCutoff || hasClosing || hasDeadline) {
          const lines = pdf.extracted_text.split('\n');
          const relevantLines = lines.filter((l: string) => {
            const lower = l.toLowerCase();
            return lower.includes('cut') || lower.includes('closing') || lower.includes('deadline');
          }).slice(0, 5);

          if (relevantLines.length > 0) {
            console.log('  Relevant lines:');
            relevantLines.forEach((l: string) => console.log(`    > ${l.trim().substring(0, 80)}`));
          }
        } else {
          // Show first 500 chars
          console.log('  Sample text:');
          console.log(`    ${pdf.extracted_text.substring(0, 300).replace(/\n/g, ' ').substring(0, 200)}...`);
        }
      } else {
        console.log('  No extracted text available');
      }
    }
  }
}

investigate().catch(console.error);
