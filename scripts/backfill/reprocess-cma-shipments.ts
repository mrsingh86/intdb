import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { ShipmentExtractionService } from '../lib/services/shipment-extraction-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropicKey = process.env.ANTHROPIC_API_KEY || '';

async function main() {
  const bookings = ['CAD0850107', 'AMC2482410', 'CAD0850214'];

  console.log('═'.repeat(70));
  console.log('REPROCESSING CMA CGM SHIPMENTS WITH NEW PDF TEXT');
  console.log('═'.repeat(70));

  const extractionService = new ShipmentExtractionService(
    supabase,
    anthropicKey,
    { useAdvancedModel: false }
  );

  for (const bookingNumber of bookings) {
    console.log(`\n─── ${bookingNumber} ───`);

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, created_from_email_id, vessel_name, etd, si_cutoff')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) {
      console.log('  Shipment not found');
      continue;
    }

    console.log(`  Before: vessel=${shipment.vessel_name}, etd=${shipment.etd}, si=${shipment.si_cutoff}`);

    // Get email
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text, true_sender_email, sender_email')
      .eq('id', shipment.created_from_email_id)
      .single();

    if (!email) {
      console.log('  No email found');
      continue;
    }

    // Get PDF content
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text, mime_type')
      .eq('email_id', shipment.created_from_email_id);

    let pdfContent = '';
    for (const att of attachments || []) {
      const isPdf = att.mime_type?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf');
      if (att.extracted_text && att.extracted_text.length > 100 && isPdf) {
        pdfContent += `\n--- ${att.filename} ---\n${att.extracted_text}\n`;
      }
    }

    if (pdfContent.length === 0) {
      console.log('  No PDF content found');
      continue;
    }

    console.log(`  PDF content: ${pdfContent.length} chars`);

    // Run extraction
    const result = await extractionService.extractFromContent({
      emailId: shipment.created_from_email_id,
      subject: email.subject || '',
      bodyText: email.body_text || '',
      pdfContent,
      carrier: 'cma-cgm',
    });

    if (!result.success || !result.data) {
      console.log(`  Extraction failed: ${result.error}`);
      continue;
    }

    const d = result.data;
    console.log(`  Extracted: vessel=${d.vessel_name}, etd=${d.etd}, si=${d.si_cutoff}`);

    // Build updates
    const updates: Record<string, any> = {};
    if (d.vessel_name) updates.vessel_name = d.vessel_name;
    if (d.voyage_number) updates.voyage_number = d.voyage_number;
    if (d.port_of_loading) updates.port_of_loading = d.port_of_loading;
    if (d.port_of_loading_code) updates.port_of_loading_code = d.port_of_loading_code;
    if (d.port_of_discharge) updates.port_of_discharge = d.port_of_discharge;
    if (d.port_of_discharge_code) updates.port_of_discharge_code = d.port_of_discharge_code;
    if (d.etd) updates.etd = d.etd;
    if (d.eta) updates.eta = d.eta;
    if (d.si_cutoff) updates.si_cutoff = d.si_cutoff;
    if (d.vgm_cutoff) updates.vgm_cutoff = d.vgm_cutoff;
    if (d.cargo_cutoff) updates.cargo_cutoff = d.cargo_cutoff;
    if (d.gate_cutoff) updates.gate_cutoff = d.gate_cutoff;
    if (d.doc_cutoff) updates.doc_cutoff = d.doc_cutoff;
    if (d.place_of_receipt) updates.place_of_receipt = d.place_of_receipt;
    if (d.place_of_delivery) updates.place_of_delivery = d.place_of_delivery;
    if (d.shipper_name) updates.shipper_name = d.shipper_name;
    if (d.consignee_name) updates.consignee_name = d.consignee_name;

    // Update
    const { error } = await supabase
      .from('shipments')
      .update(updates)
      .eq('id', shipment.id);

    if (error) {
      console.log(`  Update failed: ${error.message}`);
    } else {
      console.log(`  ✅ Updated ${Object.keys(updates).length} fields`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('DONE');
}

main().catch(console.error);
