#!/usr/bin/env npx tsx
/**
 * Investigate why BC-originated shipments are missing cutoffs
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get BC classifications
  const { data: bcClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .in('document_type', ['booking_confirmation', 'booking_amendment']);

  const bcEmailIds = new Set(bcClassifications?.map(c => c.email_id));

  // Get shipments created from BC
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id, created_from_email_id, si_cutoff, vgm_cutoff, cargo_cutoff, etd, eta, vessel_name, voyage_number, port_of_loading, port_of_discharge');

  const bcShipments = shipments?.filter(s => bcEmailIds.has(s.created_from_email_id)) || [];

  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         WHY ARE BC-ORIGINATED SHIPMENTS MISSING DATA?                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Group by carrier and analyze missing fields
  const byCarrier: Record<string, any[]> = {};
  for (const s of bcShipments) {
    const carrier = carrierMap.get(s.carrier_id) || 'Unknown';
    if (!byCarrier[carrier]) byCarrier[carrier] = [];
    byCarrier[carrier].push(s);
  }

  for (const [carrier, list] of Object.entries(byCarrier).sort((a, b) => b[1].length - a[1].length)) {
    console.log('\n' + '═'.repeat(80));
    console.log('📦 ' + carrier + ' (' + list.length + ' shipments from BC)');
    console.log('═'.repeat(80));

    // Field coverage
    const fields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta', 'vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge'];

    console.log('\nField Coverage:');
    for (const field of fields) {
      const count = list.filter(s => s[field] !== null && s[field] !== undefined).length;
      const pct = Math.round((count / list.length) * 100);
      const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
      console.log('  ' + field.padEnd(20) + bar + ' ' + pct + '% (' + count + '/' + list.length + ')');
    }

    // Find shipments missing ALL cutoffs
    const missingAllCutoffs = list.filter(s =>
      s.si_cutoff === null && s.vgm_cutoff === null && s.cargo_cutoff === null
    );

    if (missingAllCutoffs.length > 0) {
      console.log('\n⚠️  Missing ALL cutoffs: ' + missingAllCutoffs.length);

      // Investigate each
      for (const s of missingAllCutoffs.slice(0, 5)) {
        console.log('\n  📦 ' + s.booking_number);
        console.log('     ETD: ' + (s.etd || 'NULL') + ' | ETA: ' + (s.eta || 'NULL'));
        console.log('     Vessel: ' + (s.vessel_name || 'NULL') + ' | Voyage: ' + (s.voyage_number || 'NULL'));
        console.log('     POL: ' + (s.port_of_loading || 'NULL') + ' | POD: ' + (s.port_of_discharge || 'NULL'));

        // Get the source email
        const { data: email } = await supabase
          .from('raw_emails')
          .select('id, subject, sender_email, true_sender_email')
          .eq('id', s.created_from_email_id)
          .single();

        if (email) {
          console.log('     Email: ' + email.subject?.substring(0, 50));
          console.log('     From: ' + (email.true_sender_email || email.sender_email));

          // Get attachments
          const { data: atts } = await supabase
            .from('raw_attachments')
            .select('filename, mime_type, extracted_text')
            .eq('email_id', email.id);

          const pdfs = atts?.filter(a =>
            a.mime_type?.includes('pdf') || a.filename?.toLowerCase().endsWith('.pdf')
          ) || [];

          console.log('     PDFs: ' + pdfs.length);
          for (const pdf of pdfs) {
            const hasText = pdf.extracted_text && pdf.extracted_text.length > 0;
            console.log('       - ' + pdf.filename + ' | text: ' + (hasText ? pdf.extracted_text.length + ' chars' : 'NONE'));

            if (hasText) {
              const text = pdf.extracted_text.toLowerCase();
              const hasCutoff = text.includes('cut-off') || text.includes('cutoff') || text.includes('closing');
              console.log('         Has cutoff keywords: ' + (hasCutoff ? 'YES' : 'NO'));
            }
          }
        }
      }

      if (missingAllCutoffs.length > 5) {
        console.log('\n  ... and ' + (missingAllCutoffs.length - 5) + ' more');
      }
    }

    // Find shipments with partial cutoffs (some but not all)
    const partialCutoffs = list.filter(s => {
      const hasAny = s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff;
      const hasAll = s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff;
      return hasAny && !hasAll;
    });

    if (partialCutoffs.length > 0) {
      console.log('\n⚠️  Partial cutoffs (some but not all): ' + partialCutoffs.length);
      for (const s of partialCutoffs.slice(0, 3)) {
        console.log('  ' + s.booking_number + ': SI=' + (s.si_cutoff ? '✓' : '✗') +
          ' VGM=' + (s.vgm_cutoff ? '✓' : '✗') + ' Cargo=' + (s.cargo_cutoff ? '✓' : '✗'));
      }
    }
  }
}

main().catch(console.error);
