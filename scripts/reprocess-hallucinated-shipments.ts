import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { ShipmentExtractionService } from '../lib/services/shipment-extraction-service';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anthropicKey = process.env.ANTHROPIC_API_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('═'.repeat(70));
  console.log('=== REPROCESSING SHIPMENTS WITH HALLUCINATED DATES ===');
  console.log('═'.repeat(70));

  // Find shipments with 2022/2023 cutoff dates (hallucinated)
  // Filter by date range: any cutoff before 2024 is hallucinated
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, port_of_loading_code')
    .or('vgm_cutoff.lt.2024-01-01,cargo_cutoff.lt.2024-01-01,gate_cutoff.lt.2024-01-01')
    .not('created_from_email_id', 'is', null);

  if (error) {
    console.log('Error fetching shipments:', error.message);
    return;
  }

  console.log(`Found ${shipments?.length || 0} shipments with hallucinated dates\n`);

  if (!shipments || shipments.length === 0) {
    console.log('No shipments to reprocess');
    return;
  }

  const extractionService = new ShipmentExtractionService(
    supabase,
    anthropicKey,
    { useAdvancedModel: false }
  );

  let successCount = 0;
  let failCount = 0;
  let noPdfCount = 0;

  for (const shipment of shipments) {
    console.log('─'.repeat(70));
    console.log(`Processing: ${shipment.booking_number}`);
    console.log(`  Old SI Cutoff: ${shipment.si_cutoff}`);

    // Get source email
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text, true_sender_email, sender_email')
      .eq('id', shipment.created_from_email_id)
      .single();

    if (!email) {
      console.log('  ⚠️ Source email not found, skipping');
      failCount++;
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
      if (att.extracted_text && isPdf) {
        pdfContent += `\n--- ${att.filename} ---\n${att.extracted_text}\n`;
      }
    }

    if (pdfContent.length === 0) {
      console.log('  ⚠️ No PDF content, skipping');
      noPdfCount++;
      continue;
    }

    // Detect carrier
    const senderLower = (email.true_sender_email || email.sender_email || '').toLowerCase();
    let carrier = 'unknown';
    if (senderLower.includes('maersk')) carrier = 'maersk';
    else if (senderLower.includes('hapag') || senderLower.includes('hlag')) carrier = 'hapag-lloyd';
    else if (senderLower.includes('cma')) carrier = 'cma-cgm';
    else if (senderLower.includes('msc')) carrier = 'msc';
    else if (senderLower.includes('cosco')) carrier = 'cosco';

    // Run new extraction
    const result = await extractionService.extractFromContent({
      emailId: shipment.created_from_email_id,
      subject: email.subject || '',
      bodyText: email.body_text || '',
      pdfContent,
      carrier,
    });

    if (!result.success || !result.data) {
      console.log('  ❌ Extraction failed:', result.error);
      failCount++;
      continue;
    }

    const d = result.data;

    // Prepare update
    const updates: Record<string, any> = {};

    // Update port codes if they were wrong
    if (d.port_of_loading) updates.port_of_loading = d.port_of_loading;
    if (d.port_of_loading_code) updates.port_of_loading_code = d.port_of_loading_code;
    if (d.port_of_discharge) updates.port_of_discharge = d.port_of_discharge;
    if (d.port_of_discharge_code) updates.port_of_discharge_code = d.port_of_discharge_code;

    // Update dates - use new values or NULL (not hallucinated)
    updates.si_cutoff = d.si_cutoff || null;
    updates.vgm_cutoff = d.vgm_cutoff || null;
    updates.cargo_cutoff = d.cargo_cutoff || null;
    updates.gate_cutoff = d.gate_cutoff || null;
    updates.doc_cutoff = d.doc_cutoff || null;

    // Update ETD/ETA if extracted
    if (d.etd) updates.etd = d.etd;
    if (d.eta) updates.eta = d.eta;

    // Update vessel info
    if (d.vessel_name) updates.vessel_name = d.vessel_name;
    if (d.voyage_number) updates.voyage_number = d.voyage_number;

    // Update inland locations
    if (d.place_of_receipt) updates.place_of_receipt = d.place_of_receipt;
    if (d.place_of_delivery) updates.place_of_delivery = d.place_of_delivery;
    if (d.final_destination) updates.final_destination = d.final_destination;

    // Update shipper/consignee names
    if (d.shipper_name) updates.shipper_name = d.shipper_name;
    if (d.consignee_name) updates.consignee_name = d.consignee_name;

    // Update the shipment
    const { error: updateError } = await supabase
      .from('shipments')
      .update(updates)
      .eq('id', shipment.id);

    if (updateError) {
      console.log('  ❌ Update failed:', updateError.message);
      failCount++;
      continue;
    }

    console.log(`  ✅ Updated: SI=${d.si_cutoff || 'null'}, POL=${d.port_of_loading_code}`);
    successCount++;
  }

  console.log('\n' + '═'.repeat(70));
  console.log('=== REPROCESSING COMPLETE ===');
  console.log('═'.repeat(70));
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`⚠️ No PDF: ${noPdfCount}`);
  console.log(`Total: ${shipments.length}`);
}

main().catch(console.error);
