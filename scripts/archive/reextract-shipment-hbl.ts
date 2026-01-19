/**
 * Re-extract stakeholders from a specific shipment's HBL/SI documents
 * Usage: npx tsx scripts/reextract-shipment-hbl.ts <shipment_id>
 */

import { createClient } from '@supabase/supabase-js';
import { ShipmentExtractionService } from '../lib/services/shipment-extraction-service';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const STAKEHOLDER_DOC_TYPES = ['bill_of_lading', 'hbl_draft', 'bl_draft', 'shipping_instruction', 'si_draft', 'si_submission'];

async function reextract(shipmentId: string) {
  console.log(`Re-extracting HBL/SI docs for shipment: ${shipmentId}\n`);

  const extractionService = new ShipmentExtractionService(
    supabase,
    process.env.ANTHROPIC_API_KEY!,
    { useAdvancedModel: true }  // Use Sonnet for quality
  );

  // Get HBL/SI documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select(`
      email_id,
      document_type,
      raw_emails!inner(id, subject, body_text, sender_email, true_sender_email)
    `)
    .eq('shipment_id', shipmentId)
    .in('document_type', STAKEHOLDER_DOC_TYPES);

  console.log(`Found ${docs?.length || 0} HBL/SI documents\n`);

  for (const doc of docs || []) {
    const email = doc.raw_emails as any;
    console.log(`Processing: ${doc.document_type} (${doc.email_id.substring(0, 8)}...)`);

    // Get PDF content
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text, mime_type')
      .eq('email_id', doc.email_id);

    let pdfContent = '';
    for (const att of attachments || []) {
      const isPdf = att.mime_type?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf');
      if (att.extracted_text && isPdf) {
        pdfContent += `\n--- ${att.filename} ---\n${att.extracted_text}\n`;
      }
    }

    // Detect carrier
    const combined = `${email.true_sender_email || email.sender_email} ${email.subject} ${email.body_text} ${pdfContent}`.toLowerCase();
    let carrier = 'default';
    if (combined.includes('hapag') || combined.includes('hlag')) carrier = 'hapag-lloyd';
    else if (combined.includes('maersk')) carrier = 'maersk';
    else if (combined.includes('cma')) carrier = 'cma-cgm';

    // Extract with document-type hints
    const result = await extractionService.extractFromContent({
      emailId: doc.email_id,
      subject: email.subject || '',
      bodyText: email.body_text || '',
      pdfContent,
      carrier,
      documentType: doc.document_type,  // This triggers HBL-specific extraction
    });

    if (result.success && result.data) {
      const d = result.data;
      console.log(`  Shipper: ${d.shipper_name || '(none)'}`);
      console.log(`  Consignee: ${d.consignee_name || '(none)'}`);
      console.log(`  Notify: ${d.notify_party || '(none)'}`);

      // Store entities
      if (d.shipper_name || d.consignee_name || d.notify_party) {
        const entities: any[] = [];

        if (d.shipper_name) {
          entities.push({
            email_id: doc.email_id,
            entity_type: 'shipper_name',
            entity_value: d.shipper_name,
            confidence_score: 85,
            extraction_method: 'ai_reextract',
          });
        }
        if (d.consignee_name) {
          entities.push({
            email_id: doc.email_id,
            entity_type: 'consignee_name',
            entity_value: d.consignee_name,
            confidence_score: 85,
            extraction_method: 'ai_reextract',
          });
        }
        if (d.notify_party) {
          entities.push({
            email_id: doc.email_id,
            entity_type: 'notify_party',
            entity_value: d.notify_party,
            confidence_score: 85,
            extraction_method: 'ai_reextract',
          });
        }

        // Delete old stakeholder entities
        await supabase
          .from('entity_extractions')
          .delete()
          .eq('email_id', doc.email_id)
          .in('entity_type', ['shipper_name', 'consignee_name', 'notify_party', 'shipper', 'consignee']);

        // Insert new
        const { error } = await supabase.from('entity_extractions').insert(entities);
        if (error) console.log(`  Error: ${error.message}`);
        else console.log(`  ✓ Stored ${entities.length} stakeholder entities`);

        // Also update shipment if first non-null values
        const updateData: Record<string, string> = {};
        if (d.shipper_name) updateData.shipper_name = d.shipper_name;
        if (d.consignee_name) updateData.consignee_name = d.consignee_name;
        if (d.notify_party) updateData.notify_party_name = d.notify_party;

        if (Object.keys(updateData).length > 0) {
          await supabase
            .from('shipments')
            .update({ ...updateData, updated_at: new Date().toISOString() })
            .eq('id', shipmentId);
          console.log(`  ✓ Updated shipment with stakeholders`);
        }
      }
    } else {
      console.log(`  Failed: ${result.error}`);
    }

    console.log('');
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('Done!');
}

const shipmentId = process.argv[2] || '176d08fc-bb8b-4595-adc9-b25deda8346e';
reextract(shipmentId).catch(console.error);
