#!/usr/bin/env npx tsx
/**
 * Investigate the 10 shipments with real BC+PDF but missing all cutoffs
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const MISSING_BOOKINGS = [
  'HLCUBO12512',
  '2126333017',
  '2126333234',
  'COSU6439083630',
  'COSU6436084920',
  '2126333074',
  '0INLJW1MA',
  '0PEF1W1MA',
  'AMC2475813',
  'EID0919146'
];

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     INVESTIGATING 10 MISSING CUTOFF CASES                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get carriers
  const { data: carriers } = await supabase
    .from('carriers')
    .select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  for (const bn of MISSING_BOOKINGS) {
    console.log('\n' + '═'.repeat(70));
    console.log('📦 ' + bn);
    console.log('═'.repeat(70));

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bn)
      .single();

    if (!shipment) {
      console.log('❌ Shipment not found in database');
      continue;
    }

    const carrier = carrierMap.get(shipment.carrier_id) || 'Unknown';
    console.log('Carrier: ' + carrier);
    console.log('Current data:');
    console.log('  SI: ' + (shipment.si_cutoff || 'NULL'));
    console.log('  VGM: ' + (shipment.vgm_cutoff || 'NULL'));
    console.log('  Cargo: ' + (shipment.cargo_cutoff || 'NULL'));
    console.log('  ETD: ' + (shipment.etd || 'NULL'));

    // Find related emails
    const searchTerm = bn.substring(0, Math.min(bn.length, 8));
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, body_text')
      .or(`subject.ilike.%${searchTerm}%,body_text.ilike.%${searchTerm}%`)
      .limit(5);

    console.log('\nRelated emails: ' + (emails?.length || 0));

    for (const email of emails || []) {
      console.log('\n  📧 ' + email.subject?.substring(0, 60));
      console.log('     From: ' + email.sender_email);

      // Get classification
      const { data: cls } = await supabase
        .from('document_classifications')
        .select('document_type')
        .eq('email_id', email.id)
        .single();

      console.log('     Type: ' + (cls?.document_type || 'unknown'));

      // Get PDF attachments
      const { data: pdfs } = await supabase
        .from('raw_attachments')
        .select('filename, extracted_text, extraction_status')
        .eq('email_id', email.id)
        .or('mime_type.ilike.%pdf%,filename.ilike.%.pdf');

      if (pdfs && pdfs.length > 0) {
        for (const pdf of pdfs) {
          const hasText = pdf.extracted_text && pdf.extracted_text.length > 0;
          console.log('     📎 ' + pdf.filename + ' | text: ' + (hasText ? pdf.extracted_text.length + ' chars' : 'NONE'));

          if (hasText) {
            // Search for cutoff keywords
            const text = pdf.extracted_text.toLowerCase();
            const hasCutoff = text.includes('cut-off') || text.includes('cutoff') || text.includes('closing');
            console.log('        Has cutoff keywords: ' + (hasCutoff ? 'YES' : 'NO'));

            if (hasCutoff) {
              // Show cutoff section
              const idx = text.indexOf('cut-off') > 0 ? text.indexOf('cut-off') : text.indexOf('cutoff');
              if (idx > 0) {
                console.log('        Cutoff section:');
                const section = pdf.extracted_text.substring(Math.max(0, idx - 30), idx + 200);
                section.split('\n').slice(0, 5).forEach(line => {
                  if (line.trim()) console.log('          ' + line.trim().substring(0, 70));
                });
              }
            } else {
              // Check if "not confirmed" or similar
              if (text.includes('not confirm') || text.includes('yet to be')) {
                console.log('        ⚠️  Contains "not confirmed" - cutoffs pending');
              }
            }
          }
        }
      } else {
        console.log('     📎 No PDF attachments');
      }
    }
  }

  console.log('\n\n' + '═'.repeat(70));
  console.log('SUMMARY OF ISSUES');
  console.log('═'.repeat(70));
}

main().catch(console.error);
