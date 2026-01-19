#!/usr/bin/env npx tsx
/**
 * Process Booking Confirmations Only
 *
 * Focuses on booking confirmation emails from carriers to extract complete data:
 * - Carrier, Vessel, Voyage
 * - ETD, ETA
 * - POL, POD
 * - ALL Cutoff dates (SI, VGM, Cargo, Gate, Doc)
 * - Shipper, Consignee
 *
 * Prioritizes carrier emails (from hlag.com, maersk.com, etc.)
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });

// Carrier-specific prompts for cutoff extraction
const CARRIER_PROMPTS: Record<string, string> = {
  'hapag': `HAPAG-LLOYD BOOKING CONFIRMATION

CRITICAL: Find the "Deadline Information" or "Cut-off" section. It typically contains:
- "SI closing" or "Shipping instruction closing" → si_cutoff
- "VGM cut-off" → vgm_cutoff
- "FCL delivery cut-off" or "Cargo cut-off" → cargo_cutoff
- "Documentation cut-off" → doc_cutoff

Date format is usually: DD-Mon-YYYY HH:MM (e.g., "25-Dec-2025 10:00")
Booking numbers: 8-digit or start with HLCU/HLXU

`,
  'maersk': `MAERSK BOOKING CONFIRMATION

CRITICAL: Find "Important Dates" or "Key Dates" section:
- "SI Cut-off" or "Documentation Deadline" → si_cutoff
- "VGM Deadline" → vgm_cutoff
- "Cargo Receiving" or "CY Cut-off" → cargo_cutoff
- "Gate Cut-off" → gate_cutoff

Date format: Often YYYY-MM-DD or DD/MM/YYYY
Booking numbers: Start with numbers or MAEU

`,
  'cma': `CMA CGM BOOKING CONFIRMATION

CRITICAL: Find "Cut-off Dates" section:
- "SI Closing" → si_cutoff
- "VGM Closing" → vgm_cutoff
- "Cargo Closing" → cargo_cutoff

Date format: DD/MM/YYYY HH:MM

`,
  'default': `BOOKING CONFIRMATION

Find ALL cutoff dates. They may be labeled as:
- SI cutoff, Documentation deadline, Shipping instructions closing
- VGM cutoff, VGM deadline
- Cargo cutoff, CY cutoff, Cargo receiving deadline
- Gate cutoff, Port cutoff
- Documentation cutoff, Doc cutoff

`
};

const EXTRACTION_PROMPT = `{CARRIER_PROMPT}

Extract ALL information from this booking confirmation. Return ONLY valid JSON:

{
  "carrier": "shipping line name",
  "booking_number": "booking reference",
  "vessel_name": "vessel name (without M/V prefix)",
  "voyage_number": "voyage number",
  "etd": "YYYY-MM-DD",
  "eta": "YYYY-MM-DD",
  "port_of_loading": "loading port name",
  "port_of_loading_code": "5-char UN/LOCODE",
  "port_of_discharge": "discharge port name",
  "port_of_discharge_code": "5-char UN/LOCODE",
  "final_destination": "final destination",
  "si_cutoff": "YYYY-MM-DD",
  "vgm_cutoff": "YYYY-MM-DD",
  "cargo_cutoff": "YYYY-MM-DD",
  "gate_cutoff": "YYYY-MM-DD",
  "doc_cutoff": "YYYY-MM-DD",
  "shipper_name": "shipper company",
  "consignee_name": "consignee company",
  "container_type": "20GP/40HC/etc"
}

CRITICAL RULES:
1. Convert ALL dates to YYYY-MM-DD format
2. Use null for missing values
3. Look carefully in PDF content for cutoff tables
4. Cutoffs are CRITICAL - search entire document

CONTENT:
`;

function detectCarrier(senderEmail: string, content: string): string {
  const text = `${senderEmail} ${content}`.toLowerCase();
  if (text.includes('hapag') || text.includes('hlag') || text.includes('hlcu')) return 'hapag';
  if (text.includes('maersk') || text.includes('maeu')) return 'maersk';
  if (text.includes('cma-cgm') || text.includes('cma cgm')) return 'cma';
  return 'default';
}

async function extractWithAI(content: string, carrier: string): Promise<any> {
  const carrierPrompt = CARRIER_PROMPTS[carrier] || CARRIER_PROMPTS['default'];
  const prompt = EXTRACTION_PROMPT.replace('{CARRIER_PROMPT}', carrierPrompt) + content.substring(0, 10000);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Clean null strings
      for (const key of Object.keys(parsed)) {
        if (parsed[key] === 'null' || parsed[key] === '') {
          parsed[key] = null;
        }
      }
      return parsed;
    }
    return null;
  } catch (error: any) {
    console.error('  AI error:', error.message);
    return null;
  }
}

async function main() {
  console.log('=== PROCESSING BOOKING CONFIRMATIONS ===\n');

  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map<string, string>();
  carriers?.forEach(c => {
    const lower = c.carrier_name.toLowerCase();
    carrierMap.set(lower, c.id);
    if (lower.includes('hapag')) carrierMap.set('hapag-lloyd', c.id);
    if (lower.includes('maersk')) carrierMap.set('maersk', c.id);
    if (lower.includes('cma')) carrierMap.set('cma cgm', c.id);
  });

  // Get booking confirmation emails
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  console.log('Booking confirmation emails:', bookingEmails?.length);

  // Get emails with their content
  const emailIds = bookingEmails?.map(e => e.email_id) || [];

  // Get all shipments for updating
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff');

  const shipmentByBooking = new Map<string, any>();
  allShipments?.forEach(s => {
    if (s.booking_number) shipmentByBooking.set(s.booking_number, s);
  });

  // Stats
  const stats = {
    processed: 0,
    extracted: 0,
    shipmentsUpdated: 0,
    cutoffsExtracted: { si: 0, vgm: 0, cargo: 0, gate: 0 },
    etdExtracted: 0,
    etaExtracted: 0,
  };

  // Process in batches
  const batchSize = 50;
  const toProcess = emailIds.slice(0, 150); // Limit for this run

  for (let i = 0; i < toProcess.length; i++) {
    const emailId = toProcess[i];
    stats.processed++;

    if (stats.processed % 20 === 0) {
      console.log(`\nProgress: ${stats.processed}/${toProcess.length}`);
    }

    // Get email content
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text, sender_email')
      .eq('id', emailId)
      .single();

    if (!email) continue;

    // Get PDF attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', emailId)
      .ilike('mime_type', '%pdf%');

    // Build full content
    let content = `Subject: ${email.subject}\n\n${email.body_text || ''}`;
    for (const att of attachments || []) {
      if (att.extracted_text) {
        content += `\n\n--- PDF: ${att.filename} ---\n${att.extracted_text}`;
      }
    }

    // Detect carrier
    const carrier = detectCarrier(email.sender_email, content);

    // Extract with AI
    const extracted = await extractWithAI(content, carrier);
    if (!extracted || !extracted.booking_number) continue;

    stats.extracted++;

    // Find shipment to update
    const shipment = shipmentByBooking.get(extracted.booking_number);
    if (!shipment) continue;

    // Build update
    const updates: Record<string, any> = {};
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    // Carrier
    if (!shipment.carrier_id && extracted.carrier) {
      const carrierId = carrierMap.get(extracted.carrier.toLowerCase());
      if (carrierId) updates.carrier_id = carrierId;
    }

    // Vessel/Voyage
    if (extracted.vessel_name) updates.vessel_name = extracted.vessel_name;
    if (extracted.voyage_number) updates.voyage_number = extracted.voyage_number;

    // Dates
    if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
      updates.etd = extracted.etd;
      stats.etdExtracted++;
    }
    if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
      updates.eta = extracted.eta;
      stats.etaExtracted++;
    }

    // CUTOFFS - The critical ones!
    if (!shipment.si_cutoff && extracted.si_cutoff && dateRegex.test(extracted.si_cutoff)) {
      updates.si_cutoff = extracted.si_cutoff;
      stats.cutoffsExtracted.si++;
    }
    if (!shipment.vgm_cutoff && extracted.vgm_cutoff && dateRegex.test(extracted.vgm_cutoff)) {
      updates.vgm_cutoff = extracted.vgm_cutoff;
      stats.cutoffsExtracted.vgm++;
    }
    if (!shipment.cargo_cutoff && extracted.cargo_cutoff && dateRegex.test(extracted.cargo_cutoff)) {
      updates.cargo_cutoff = extracted.cargo_cutoff;
      stats.cutoffsExtracted.cargo++;
    }
    if (extracted.gate_cutoff && dateRegex.test(extracted.gate_cutoff)) {
      updates.gate_cutoff = extracted.gate_cutoff;
      stats.cutoffsExtracted.gate++;
    }

    // Ports
    if (extracted.port_of_loading) updates.port_of_loading = extracted.port_of_loading;
    if (extracted.port_of_discharge) updates.port_of_discharge = extracted.port_of_discharge;
    if (extracted.port_of_loading_code) updates.port_of_loading_code = extracted.port_of_loading_code;
    if (extracted.port_of_discharge_code) updates.port_of_discharge_code = extracted.port_of_discharge_code;
    if (extracted.final_destination) updates.final_destination = extracted.final_destination;

    // Parties
    if (extracted.shipper_name) updates.shipper_name = extracted.shipper_name;
    if (extracted.consignee_name) updates.consignee_name = extracted.consignee_name;

    // Update shipment
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        stats.shipmentsUpdated++;
        if (Object.keys(updates).length > 3) {
          console.log(`  ${extracted.booking_number}: +${Object.keys(updates).length - 1} fields`);
        }
      }
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Extracted:', stats.extracted);
  console.log('Shipments updated:', stats.shipmentsUpdated);
  console.log('ETD extracted:', stats.etdExtracted);
  console.log('ETA extracted:', stats.etaExtracted);
  console.log('Cutoffs extracted:');
  console.log('  SI:', stats.cutoffsExtracted.si);
  console.log('  VGM:', stats.cutoffsExtracted.vgm);
  console.log('  Cargo:', stats.cutoffsExtracted.cargo);
  console.log('  Gate:', stats.cutoffsExtracted.gate);

  // Show final coverage
  console.log('\n=== FINAL COVERAGE ===');
  const { data: final } = await supabase.from('shipments').select('*');
  const total = final?.length || 0;

  const fields = ['carrier_id', 'vessel_name', 'etd', 'eta', 'port_of_loading', 'port_of_discharge',
                  'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'shipper_name', 'consignee_name'];

  for (const field of fields) {
    const count = final?.filter(s => (s as any)[field]).length || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`${field.padEnd(20)} ${bar} ${pct}%`);
  }
}

main().catch(console.error);
