/**
 * Reprocess incomplete shipments using BOTH email and attachment content
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

async function reprocess() {
  console.log('═'.repeat(70));
  console.log('REPROCESSING INCOMPLETE SHIPMENTS WITH ATTACHMENTS');
  console.log('═'.repeat(70));
  console.log('');

  // Get confirmed shipments with no voyage data
  const { data: confirmedDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id')
    .eq('document_type', 'booking_confirmation');

  const confirmedIds = new Set(confirmedDocs?.map(d => d.shipment_id) || []);
  const shipmentEmails = new Map<string, string[]>();

  // Build map of shipment -> all linked emails
  confirmedDocs?.forEach(d => {
    const existing = shipmentEmails.get(d.shipment_id) || [];
    existing.push(d.email_id);
    shipmentEmails.set(d.shipment_id, existing);
  });

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, port_of_loading, port_of_discharge, vessel_name, voyage_number');

  const incomplete = (shipments || []).filter(s => {
    if (!confirmedIds.has(s.id)) return false;
    const hasVoyageData = s.etd || s.eta || s.port_of_loading || s.port_of_discharge || s.vessel_name;
    return !hasVoyageData;
  });

  console.log(`Found ${incomplete.length} incomplete shipments`);
  console.log('');

  let processed = 0;
  let updated = 0;
  let failed = 0;

  for (const shipment of incomplete) {
    console.log('─'.repeat(70));
    console.log(`Processing: ${shipment.booking_number}`);

    const emailIds = shipmentEmails.get(shipment.id) || [];
    if (emailIds.length === 0) {
      console.log('  ❌ No linked emails');
      failed++;
      continue;
    }

    // Get ALL emails for this shipment
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, body_text, snippet')
      .in('id', emailIds);

    // Get ALL attachments for these emails
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('email_id, filename, mime_type, extracted_text')
      .in('email_id', emailIds);

    console.log(`  Emails: ${emails?.length || 0}`);
    console.log(`  Attachments: ${attachments?.length || 0}`);

    // Build combined content
    let combinedContent = '';

    for (const email of emails || []) {
      combinedContent += `
=== EMAIL ===
Subject: ${email.subject || ''}
Body: ${email.body_text || email.snippet || ''}
`;
    }

    // Add attachment content
    let pdfCount = 0;
    for (const att of attachments || []) {
      if (att.extracted_text) {
        combinedContent += `
=== PDF ATTACHMENT: ${att.filename} ===
${att.extracted_text}
`;
        pdfCount++;
        console.log(`  ✓ PDF content: ${att.filename}`);
      }
    }

    if (pdfCount === 0 && combinedContent.length < 200) {
      console.log('  ❌ Insufficient content');
      failed++;
      continue;
    }

    // Run AI extraction
    console.log('  Running AI extraction...');

    try {
      const result = await extractVoyageData(combinedContent, shipment.booking_number);

      if (result) {
        // Build updates
        const updates: Record<string, any> = {};

        if (result.vessel_name && !shipment.vessel_name) {
          updates.vessel_name = result.vessel_name;
        }
        if (result.voyage_number && !shipment.voyage_number) {
          updates.voyage_number = result.voyage_number;
        }
        if (result.etd && !shipment.etd) {
          const d = new Date(result.etd);
          if (!isNaN(d.getTime())) updates.etd = d.toISOString();
        }
        if (result.eta && !shipment.eta) {
          const d = new Date(result.eta);
          if (!isNaN(d.getTime())) updates.eta = d.toISOString();
        }
        if (result.port_of_loading && !shipment.port_of_loading) {
          updates.port_of_loading = result.port_of_loading;
        }
        if (result.port_of_discharge && !shipment.port_of_discharge) {
          updates.port_of_discharge = result.port_of_discharge;
        }

        if (Object.keys(updates).length > 0) {
          await supabase.from('shipments').update(updates).eq('id', shipment.id);
          console.log(`  ✅ Updated: ${Object.keys(updates).join(', ')}`);
          updated++;
        } else {
          console.log('  ⚠️ No new fields to update');
          console.log('  AI extracted:', JSON.stringify(result));
        }
      } else {
        console.log('  ❌ AI returned no data');
        failed++;
      }

      processed++;
    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 500));
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
  const prompt = `Extract voyage/shipment details from this booking confirmation.

CONTENT:
${content.substring(0, 10000)}

Extract ONLY if you find the actual values (don't guess):
- vessel_name: Ship name (e.g., "MAERSK KENT", "EVER GIVEN")
- voyage_number: Voyage number
- etd: Estimated Departure (format: YYYY-MM-DD)
- eta: Estimated Arrival (format: YYYY-MM-DD)
- port_of_loading: Loading port (e.g., "HAZIRA" or "CHENNAI")
- port_of_discharge: Discharge port (e.g., "HOUSTON" or "NEW YORK")

IMPORTANT:
- Look for "VesselName-" patterns in the content
- Look for "From:" and "To:" locations
- Look for "AllocationWeek" which indicates voyage timing
- Ports should be clean names (not codes like "INMAA")
- Return null for fields not found

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
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

reprocess().catch(console.error);
