import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { ShipmentExtractionService } from '../lib/services/shipment-extraction-service';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anthropicKey = process.env.ANTHROPIC_API_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const bookingNumber = '263368698';

  // Get the shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('booking_number', bookingNumber)
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log('═'.repeat(70));
  console.log('=== OLD EXTRACTION (Before) ===');
  console.log('═'.repeat(70));
  console.log('Booking:', shipment.booking_number);
  console.log('Vessel:', shipment.vessel_name, 'Voy:', shipment.voyage_number);
  console.log('POL:', shipment.port_of_loading, `(${shipment.port_of_loading_code})`);
  console.log('POD:', shipment.port_of_discharge, `(${shipment.port_of_discharge_code})`);
  console.log('Place of Receipt:', shipment.place_of_receipt || 'NOT EXTRACTED');
  console.log('Place of Delivery:', shipment.place_of_delivery || 'NOT EXTRACTED');
  console.log('ETD:', shipment.etd);
  console.log('ETA:', shipment.eta);
  console.log('SI Cutoff:', shipment.si_cutoff, shipment.si_cutoff?.includes('2023') ? '⚠️ HALLUCINATED!' : '');
  console.log('VGM Cutoff:', shipment.vgm_cutoff, shipment.vgm_cutoff?.includes('2023') ? '⚠️ HALLUCINATED!' : '');
  console.log('Cargo Cutoff:', shipment.cargo_cutoff, shipment.cargo_cutoff?.includes('2023') ? '⚠️ HALLUCINATED!' : '');
  console.log('Gate Cutoff:', shipment.gate_cutoff, shipment.gate_cutoff?.includes('2023') ? '⚠️ HALLUCINATED!' : '');
  console.log('IT Number:', shipment.it_number || 'NOT EXTRACTED');

  // Get source email
  const emailId = shipment.created_from_email_id;
  if (!emailId) {
    console.log('\nNo source email found');
    return;
  }

  const { data: email } = await supabase
    .from('raw_emails')
    .select('*')
    .eq('id', emailId)
    .single();

  console.log('\nSource email:', email?.subject);

  // Get PDF content
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('filename, extracted_text, mime_type')
    .eq('email_id', emailId);

  let pdfContent = '';
  for (const att of attachments || []) {
    const isPdf = att.mime_type?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf');
    if (att.extracted_text && isPdf) {
      pdfContent += `\n--- ${att.filename} ---\n${att.extracted_text}\n`;
    }
  }

  console.log('PDF content length:', pdfContent.length, 'chars');

  if (pdfContent.length === 0) {
    console.log('\n⚠️ No PDF content found - cannot reprocess');
    return;
  }

  // Run NEW extraction
  console.log('\n' + '═'.repeat(70));
  console.log('=== NEW EXTRACTION (After) ===');
  console.log('═'.repeat(70));

  const extractionService = new ShipmentExtractionService(
    supabase,
    anthropicKey,
    { useAdvancedModel: false }
  );

  const result = await extractionService.extractFromContent({
    emailId,
    subject: email?.subject || '',
    bodyText: email?.body_text || '',
    pdfContent,
    carrier: 'maersk',
  });

  if (!result.success || !result.data) {
    console.log('Extraction failed:', result.error);
    return;
  }

  const d = result.data;

  console.log('Booking:', d.booking_number);
  console.log('Vessel:', d.vessel_name, 'Voy:', d.voyage_number);
  console.log('POL:', d.port_of_loading, `(${d.port_of_loading_code})`);
  console.log('POD:', d.port_of_discharge, `(${d.port_of_discharge_code})`);
  console.log('Place of Receipt:', d.place_of_receipt || 'null', `(${d.place_of_receipt_code})`);
  console.log('Place of Delivery:', d.place_of_delivery || 'null', `(${d.place_of_delivery_code})`);
  console.log('Final Destination:', d.final_destination);
  console.log('ETD:', d.etd);
  console.log('ETA:', d.eta);
  console.log('SI Cutoff:', d.si_cutoff);
  console.log('VGM Cutoff:', d.vgm_cutoff);
  console.log('Cargo Cutoff:', d.cargo_cutoff);
  console.log('Gate Cutoff:', d.gate_cutoff);
  console.log('Doc Cutoff:', d.doc_cutoff);
  console.log('Port Cutoff:', d.port_cutoff);
  console.log('Early Return Date:', d.early_return_date);
  console.log('Terminal Receiving:', d.terminal_receiving_date);
  console.log('IT Number:', d.it_number);
  console.log('HS Codes:', d.hs_codes);
  console.log('Shipper:', d.shipper_name);
  console.log('Consignee:', d.consignee_name);
  console.log('Container Type:', d.container_type);
  console.log('Incoterms:', d.incoterms);

  console.log('\n' + '═'.repeat(70));
  console.log('=== COMPARISON ===');
  console.log('═'.repeat(70));

  const oldSiYear = shipment.si_cutoff?.substring(0, 4);
  const newSiYear = d.si_cutoff?.substring(0, 4);

  console.log('SI Cutoff:');
  console.log('  OLD:', shipment.si_cutoff, oldSiYear === '2023' ? '❌ HALLUCINATED' : '');
  console.log('  NEW:', d.si_cutoff, newSiYear === '2026' || newSiYear === '2025' ? '✅ CORRECT' : (d.si_cutoff === null ? '✅ NULL (not hallucinated)' : ''));

  console.log('\nPOL Code:');
  console.log('  OLD:', shipment.port_of_loading_code, shipment.port_of_loading_code === 'CNSHA' ? '❌ WRONG (China code for India port)' : '');
  console.log('  NEW:', d.port_of_loading_code);

  console.log('\nFields extracted:', d.fields_extracted.length);
  console.log('Confidence:', d.extraction_confidence, '%');

  // Ask if user wants to update
  console.log('\n' + '═'.repeat(70));
  console.log('To update this shipment with new extraction, run:');
  console.log(`UPDATE shipments SET
  port_of_loading = '${d.port_of_loading}',
  port_of_loading_code = '${d.port_of_loading_code}',
  si_cutoff = ${d.si_cutoff ? `'${d.si_cutoff}'` : 'NULL'},
  vgm_cutoff = ${d.vgm_cutoff ? `'${d.vgm_cutoff}'` : 'NULL'},
  cargo_cutoff = ${d.cargo_cutoff ? `'${d.cargo_cutoff}'` : 'NULL'},
  gate_cutoff = ${d.gate_cutoff ? `'${d.gate_cutoff}'` : 'NULL'}
WHERE booking_number = '${bookingNumber}';`);
}

main().catch(console.error);
