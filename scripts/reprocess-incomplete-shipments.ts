/**
 * Reprocess incomplete shipments - extract PDFs and re-run entity extraction
 *
 * ROOT CAUSE: PDFs stored but extracted_text was NULL when entity extraction ran
 * FIX: Extract PDF text → Re-run AI entity extraction → Update shipment
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

async function reprocessIncompleteShipments() {
  console.log('═'.repeat(70));
  console.log('REPROCESSING INCOMPLETE SHIPMENTS');
  console.log('═'.repeat(70));
  console.log('');

  // Step 1: Find confirmed shipments with no voyage data
  const { data: confirmedDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id')
    .eq('document_type', 'booking_confirmation');

  const confirmedIds = new Set(confirmedDocs?.map(d => d.shipment_id) || []);
  const shipmentToEmail = new Map<string, string>();
  confirmedDocs?.forEach(d => shipmentToEmail.set(d.shipment_id, d.email_id));

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, port_of_loading, port_of_discharge, vessel_name');

  const incomplete = (shipments || []).filter(s => {
    if (!confirmedIds.has(s.id)) return false;
    const hasVoyageData = s.etd || s.eta || s.port_of_loading || s.port_of_discharge || s.vessel_name;
    return !hasVoyageData;
  });

  console.log(`Found ${incomplete.length} incomplete shipments to reprocess`);
  console.log('');

  let processed = 0;
  let updated = 0;
  let failed = 0;

  for (const shipment of incomplete) {
    console.log(`─`.repeat(70));
    console.log(`Processing: ${shipment.booking_number}`);

    const emailId = shipmentToEmail.get(shipment.id);
    if (!emailId) {
      console.log('  ❌ No linked email found');
      failed++;
      continue;
    }

    // Get email content
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text, snippet')
      .eq('id', emailId)
      .single();

    if (!email) {
      console.log('  ❌ Email not found in database');
      failed++;
      continue;
    }

    // Get attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('id, filename, mime_type, extracted_text, file_data')
      .eq('email_id', emailId);

    console.log(`  Email subject: ${email.subject?.substring(0, 50)}...`);
    console.log(`  Attachments: ${attachments?.length || 0}`);

    // Build content for extraction
    let combinedContent = `
Subject: ${email.subject || ''}

Email Body:
${email.body_text || email.snippet || ''}
`;

    // Check for PDF text
    let hasPdfText = false;
    for (const att of attachments || []) {
      if (att.extracted_text) {
        combinedContent += `\n\n--- PDF: ${att.filename} ---\n${att.extracted_text}`;
        hasPdfText = true;
        console.log(`  ✓ Found extracted PDF text: ${att.filename}`);
      } else if (att.mime_type?.includes('pdf')) {
        console.log(`  ⚠️ PDF exists but no extracted_text: ${att.filename}`);
      }
    }

    if (!hasPdfText && (!email.body_text || email.body_text.length < 100)) {
      console.log('  ❌ Insufficient content for extraction');
      failed++;
      continue;
    }

    // Run AI extraction
    console.log('  Running AI extraction...');

    try {
      const extractionResult = await extractVoyageData(combinedContent, shipment.booking_number);

      if (extractionResult) {
        console.log('  Extracted:', JSON.stringify(extractionResult, null, 2).split('\n').map(l => '    ' + l).join('\n'));

        // Update shipment with extracted data
        const updates: Record<string, any> = {};

        if (extractionResult.vessel_name && !shipment.vessel_name) {
          updates.vessel_name = extractionResult.vessel_name;
        }
        if (extractionResult.etd && !shipment.etd) {
          const parsed = new Date(extractionResult.etd);
          if (!isNaN(parsed.getTime())) {
            updates.etd = parsed.toISOString();
          }
        }
        if (extractionResult.eta && !shipment.eta) {
          const parsed = new Date(extractionResult.eta);
          if (!isNaN(parsed.getTime())) {
            updates.eta = parsed.toISOString();
          }
        }
        if (extractionResult.port_of_loading && !shipment.port_of_loading) {
          updates.port_of_loading = extractionResult.port_of_loading;
        }
        if (extractionResult.port_of_discharge && !shipment.port_of_discharge) {
          updates.port_of_discharge = extractionResult.port_of_discharge;
        }
        if (extractionResult.voyage_number) {
          updates.voyage_number = extractionResult.voyage_number;
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from('shipments').update(updates).eq('id', shipment.id);
          console.log(`  ✅ Updated: ${Object.keys(updates).join(', ')}`);
          updated++;
        } else {
          console.log('  ⚠️ No new data to update');
        }
      } else {
        console.log('  ❌ AI extraction returned no voyage data');
        failed++;
      }
    } catch (error: any) {
      console.log(`  ❌ Extraction error: ${error.message}`);
      failed++;
    }

    processed++;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Processed: ${processed}`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);
}

async function extractVoyageData(content: string, bookingNumber: string | null): Promise<any> {
  const prompt = `Extract voyage/shipment details from this booking confirmation email.

CONTENT:
${content.substring(0, 8000)}

Extract these fields (return null if not found, don't guess):
- vessel_name: The ship name (e.g., "EVER GIVEN", "MSC OSCAR")
- voyage_number: The voyage number
- etd: Estimated Time of Departure (format: YYYY-MM-DD)
- eta: Estimated Time of Arrival (format: YYYY-MM-DD)
- port_of_loading: Loading port name
- port_of_discharge: Discharge port name

IMPORTANT:
- Only extract if you're confident the data is correct
- Dates should be in YYYY-MM-DD format
- Port names should be clean (e.g., "CHENNAI" not "CHENNAI, INDIA (INMAA)")
- Return null for fields you can't find

Return JSON only:
{
  "vessel_name": "...",
  "voyage_number": "...",
  "etd": "YYYY-MM-DD",
  "eta": "YYYY-MM-DD",
  "port_of_loading": "...",
  "port_of_discharge": "..."
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  return null;
}

reprocessIncompleteShipments().catch(console.error);
