import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { ShipmentExtractionService } from '../lib/services/shipment-extraction-service';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anthropicKey = process.env.ANTHROPIC_API_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Test with Hapag-Lloyd Arrival Notice (has IT number, customs fields)
  const emailId = '9061dbda-26c4-4b79-81ff-1277dfaa6f7b'; // HLCL Arrival Notice

  console.log('=== TESTING NEW EXTRACTION SERVICE ===\n');

  // Get email
  const { data: email } = await supabase
    .from('raw_emails')
    .select('*')
    .eq('id', emailId)
    .single();

  if (!email) {
    console.log('Email not found');
    return;
  }

  console.log('Email:', email.subject);
  console.log('From:', email.true_sender_email || email.sender_email);

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

  console.log('\nPDF content length:', pdfContent.length, 'chars');

  // Test the new extraction service directly
  const extractionService = new ShipmentExtractionService(
    supabase,
    anthropicKey,
    { useAdvancedModel: false } // Use Haiku like cron
  );

  console.log('\n--- Running extraction with NEW consolidated service ---\n');

  const result = await extractionService.extractFromContent({
    emailId,
    subject: email.subject || '',
    bodyText: email.body_text || '',
    pdfContent,
    carrier: 'hapag-lloyd',
  });

  console.log('Success:', result.success);
  console.log('Processing time:', result.processingTime, 'ms');

  if (result.success && result.data) {
    const d = result.data;

    console.log('\n=== EXTRACTED DATA ===\n');

    console.log('--- PRIMARY ---');
    console.log('Booking #:', d.booking_number);
    console.log('BL #:', d.bl_number);
    console.log('MBL #:', d.mbl_number);
    console.log('HBL #:', d.hbl_number);
    console.log('Containers:', d.container_numbers);

    console.log('\n--- CARRIER & VOYAGE ---');
    console.log('Carrier:', d.carrier_name);
    console.log('Vessel:', d.vessel_name);
    console.log('Voyage:', d.voyage_number);

    console.log('\n--- ROUTING ---');
    console.log('POL:', d.port_of_loading, `(${d.port_of_loading_code})`);
    console.log('POD:', d.port_of_discharge, `(${d.port_of_discharge_code})`);
    console.log('Place of Receipt:', d.place_of_receipt, `(${d.place_of_receipt_code})`);
    console.log('Place of Delivery:', d.place_of_delivery, `(${d.place_of_delivery_code})`);
    console.log('Final Destination:', d.final_destination);
    console.log('Transhipment:', d.transhipment_ports);

    console.log('\n--- DATES ---');
    console.log('ETD:', d.etd);
    console.log('ETA:', d.eta);

    console.log('\n--- CUTOFFS (ALL) ---');
    console.log('SI Cutoff:', d.si_cutoff);
    console.log('VGM Cutoff:', d.vgm_cutoff);
    console.log('Cargo Cutoff:', d.cargo_cutoff);
    console.log('Gate Cutoff:', d.gate_cutoff);
    console.log('Doc Cutoff:', d.doc_cutoff);
    console.log('Port Cutoff:', d.port_cutoff);
    console.log('Customs Cutoff:', d.customs_cutoff);
    console.log('Hazmat Cutoff:', d.hazmat_cutoff);
    console.log('Reefer Cutoff:', d.reefer_cutoff);
    console.log('Early Return Date:', d.early_return_date);
    console.log('Terminal Receiving:', d.terminal_receiving_date);
    console.log('Late Gate:', d.late_gate);

    console.log('\n--- PARTIES ---');
    console.log('Shipper:', d.shipper_name);
    console.log('Consignee:', d.consignee_name);
    console.log('Notify Party:', d.notify_party);

    console.log('\n--- CARGO ---');
    console.log('Commodity:', d.commodity_description);
    console.log('Container Type:', d.container_type);
    console.log('Weight:', d.weight_kg, 'kg');
    console.log('Volume:', d.volume_cbm, 'cbm');
    console.log('Packages:', d.package_count, d.package_type);
    console.log('Seals:', d.seal_numbers);

    console.log('\n--- CUSTOMS/AN ---');
    console.log('HS Codes:', d.hs_codes);
    console.log('AN Number:', d.an_number);
    console.log('IT Number:', d.it_number);
    console.log('Entry Number:', d.entry_number);
    console.log('Bond Number:', d.bond_number);
    console.log('ISF Number:', d.isf_number);

    console.log('\n--- FINANCIAL ---');
    console.log('Cargo Value:', d.cargo_value, d.cargo_value_currency);
    console.log('Duty Amount:', d.duty_amount);
    console.log('Tax Amount:', d.tax_amount);
    console.log('Freight Amount:', d.freight_amount);

    console.log('\n--- REFERENCES ---');
    console.log('Customer Ref:', d.customer_reference);
    console.log('Forwarder Ref:', d.forwarder_reference);
    console.log('PO Numbers:', d.po_numbers);
    console.log('Invoice Numbers:', d.invoice_numbers);

    console.log('\n--- METADATA ---');
    console.log('Confidence:', d.extraction_confidence, '%');
    console.log('Source:', d.extraction_source);
    console.log('Fields extracted:', d.fields_extracted.length);
    console.log('Fields:', d.fields_extracted.join(', '));
  } else {
    console.log('Error:', result.error);
  }
}

main().catch(console.error);
