#!/usr/bin/env npx tsx
/**
 * Extract Hapag-Lloyd Booking Data
 *
 * Hapag subject format: HL-{BOOKING_NUMBER} {PORT_CODE} {VESSEL_NAME}
 * Example: "HL-22970937 USSAV RESILIENT"
 *
 * These emails from service.hlag.com contain:
 * - Full booking confirmation details
 * - Cutoff dates in body/attachments
 * - Vessel, voyage, ETD/ETA
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

// Hapag-Lloyd specific extraction prompt
const HAPAG_EXTRACTION_PROMPT = `You are extracting data from a HAPAG-LLOYD booking confirmation email.

HAPAG-LLOYD SPECIFIC PATTERNS:
- Booking numbers: 8 digits (like 22970937) or start with HL prefix
- Subject format: "HL-{BOOKING_NUMBER} {PORT_CODE} {VESSEL_NAME}"
- Look for "Deadline Information" or "Cut-off" section for dates:
  * "SI closing" or "Shipping instruction closing" → si_cutoff
  * "VGM cut-off" or "VGM submission" → vgm_cutoff
  * "FCL delivery cut-off" or "Cargo cut-off" → cargo_cutoff
  * "Gate cut-off" → gate_cutoff
  * "Documentation cut-off" → doc_cutoff

Date formats: DD-Mon-YYYY HH:MM (e.g., "25-Dec-2025 10:00") or DD/MM/YYYY

Extract ALL available information. Return ONLY valid JSON:

{
  "carrier": "Hapag-Lloyd",
  "booking_number": "8-digit number",
  "vessel_name": "vessel name without M/V prefix",
  "voyage_number": "voyage number",
  "etd": "YYYY-MM-DD",
  "eta": "YYYY-MM-DD",
  "port_of_loading": "loading port name",
  "port_of_loading_code": "5-char UN/LOCODE like INMUN",
  "port_of_discharge": "discharge port name",
  "port_of_discharge_code": "5-char UN/LOCODE like USSAV",
  "final_destination": "final destination if different",
  "si_cutoff": "YYYY-MM-DD",
  "vgm_cutoff": "YYYY-MM-DD",
  "cargo_cutoff": "YYYY-MM-DD",
  "gate_cutoff": "YYYY-MM-DD",
  "doc_cutoff": "YYYY-MM-DD",
  "container_type": "20GP/40HC/etc",
  "shipper_name": "shipper company",
  "consignee_name": "consignee company"
}

RULES:
1. Convert ALL dates to YYYY-MM-DD format
2. Use null for missing values (not "null" string)
3. The subject line may have vessel name after port code
4. Search ENTIRE email body and any PDF text for cutoff dates

EMAIL CONTENT:
`;

// Parse Hapag subject line: "HL-22970937 USSAV RESILIENT"
function parseHapagSubject(subject: string): { bookingNumber?: string; portCode?: string; vesselName?: string } {
  const match = subject.match(/HL-?(\d{8})\s+([A-Z]{5})\s+(.+)/i);
  if (match) {
    return {
      bookingNumber: match[1],
      portCode: match[2],
      vesselName: match[3].trim()
    };
  }

  // Try just booking number
  const bookingMatch = subject.match(/HL-?(\d{8})/i);
  if (bookingMatch) {
    return { bookingNumber: bookingMatch[1] };
  }

  return {};
}

// Port code to name mapping
const PORT_CODES: Record<string, string> = {
  'USSAV': 'Savannah',
  'USORF': 'Norfolk',
  'USCHS': 'Charleston',
  'USNYC': 'New York',
  'USLAX': 'Los Angeles',
  'USOAK': 'Oakland',
  'INMUN': 'Mundra',
  'INNSA': 'Nhava Sheva',
  'INCCU': 'Calcutta',
  'INBOM': 'Mumbai',
  'INCOK': 'Kochi',
  'AEJEA': 'Jebel Ali',
  'SGSIN': 'Singapore',
  'CNSHA': 'Shanghai',
  'CNNGB': 'Ningbo',
  'DEHAM': 'Hamburg',
  'NLRTM': 'Rotterdam',
  'BEANR': 'Antwerp',
};

async function extractWithAI(content: string): Promise<any> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 2048,
      messages: [{ role: 'user', content: HAPAG_EXTRACTION_PROMPT + content.substring(0, 12000) }],
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
  console.log('=== EXTRACTING HAPAG-LLOYD BOOKING DATA ===\n');

  // Get Hapag-Lloyd carrier ID
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const hapagCarrier = carriers?.find(c => c.carrier_name.toLowerCase().includes('hapag'));
  console.log('Hapag carrier ID:', hapagCarrier?.id);

  // Get all Hapag booking confirmation emails
  const { data: hapagEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email')
    .ilike('sender_email', '%hlag.com%');

  console.log('Hapag emails found:', hapagEmails?.length);

  // Get existing shipments for matching
  const { data: shipments } = await supabase.from('shipments').select('*');
  const shipmentByBooking = new Map<string, any>();
  shipments?.forEach(s => {
    if (s.booking_number) {
      // Store by raw number
      shipmentByBooking.set(s.booking_number, s);
      // Also by Hapag format
      const numOnly = s.booking_number.replace(/\D/g, '');
      if (numOnly.length === 8) {
        shipmentByBooking.set(numOnly, s);
      }
    }
  });

  console.log('Shipments mapped:', shipmentByBooking.size);

  // Stats
  const stats = {
    processed: 0,
    extracted: 0,
    shipmentsCreated: 0,
    shipmentsUpdated: 0,
    fields: {
      carrier: 0,
      vessel: 0,
      etd: 0,
      eta: 0,
      pol: 0,
      pod: 0,
      si_cutoff: 0,
      vgm_cutoff: 0,
      cargo_cutoff: 0,
    }
  };

  // Process each Hapag email
  for (const email of hapagEmails || []) {
    stats.processed++;

    if (stats.processed % 20 === 0) {
      console.log(`\nProgress: ${stats.processed}/${hapagEmails?.length}`);
    }

    // Parse subject for quick extraction
    const subjectData = parseHapagSubject(email.subject);

    // Get PDF attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', email.id)
      .ilike('mime_type', '%pdf%');

    // Build full content
    let content = `Subject: ${email.subject}\n\nBody:\n${email.body_text || ''}`;
    for (const att of attachments || []) {
      if (att.extracted_text) {
        content += `\n\n--- PDF: ${att.filename} ---\n${att.extracted_text}`;
      }
    }

    // Extract with AI
    const extracted = await extractWithAI(content);
    if (!extracted) continue;

    stats.extracted++;

    // Merge subject data with AI extraction (subject is more reliable for booking)
    if (subjectData.bookingNumber) {
      extracted.booking_number = subjectData.bookingNumber;
    }
    if (subjectData.vesselName && !extracted.vessel_name) {
      extracted.vessel_name = subjectData.vesselName;
    }
    if (subjectData.portCode) {
      extracted.port_of_discharge_code = subjectData.portCode;
      extracted.port_of_discharge = PORT_CODES[subjectData.portCode] || extracted.port_of_discharge;
    }

    // Always Hapag-Lloyd
    extracted.carrier = 'Hapag-Lloyd';

    if (!extracted.booking_number) {
      console.log('  No booking number found, skipping');
      continue;
    }

    // Find or create shipment
    let shipment = shipmentByBooking.get(extracted.booking_number);
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!shipment) {
      // Create new shipment
      const newShipment: Record<string, any> = {
        booking_number: extracted.booking_number,
        carrier_id: hapagCarrier?.id,
        created_from_email_id: email.id,
        workflow_state: 'booking_confirmed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Add extracted fields
      if (extracted.vessel_name) newShipment.vessel_name = extracted.vessel_name;
      if (extracted.voyage_number) newShipment.voyage_number = extracted.voyage_number;
      if (extracted.etd && dateRegex.test(extracted.etd)) newShipment.etd = extracted.etd;
      if (extracted.eta && dateRegex.test(extracted.eta)) newShipment.eta = extracted.eta;
      if (extracted.port_of_loading) newShipment.port_of_loading = extracted.port_of_loading;
      if (extracted.port_of_discharge) newShipment.port_of_discharge = extracted.port_of_discharge;
      if (extracted.port_of_loading_code) newShipment.port_of_loading_code = extracted.port_of_loading_code;
      if (extracted.port_of_discharge_code) newShipment.port_of_discharge_code = extracted.port_of_discharge_code;
      if (extracted.si_cutoff && dateRegex.test(extracted.si_cutoff)) newShipment.si_cutoff = extracted.si_cutoff;
      if (extracted.vgm_cutoff && dateRegex.test(extracted.vgm_cutoff)) newShipment.vgm_cutoff = extracted.vgm_cutoff;
      if (extracted.cargo_cutoff && dateRegex.test(extracted.cargo_cutoff)) newShipment.cargo_cutoff = extracted.cargo_cutoff;
      if (extracted.shipper_name) newShipment.shipper_name = extracted.shipper_name;
      if (extracted.consignee_name) newShipment.consignee_name = extracted.consignee_name;

      const { data: created, error } = await supabase
        .from('shipments')
        .insert(newShipment)
        .select()
        .single();

      if (!error && created) {
        stats.shipmentsCreated++;
        shipmentByBooking.set(extracted.booking_number, created);
        console.log(`  NEW: ${extracted.booking_number} → ${extracted.vessel_name || 'no vessel'}`);
      }
    } else {
      // Update existing shipment
      const updates: Record<string, any> = {};

      if (!shipment.carrier_id && hapagCarrier?.id) {
        updates.carrier_id = hapagCarrier.id;
        stats.fields.carrier++;
      }
      if (!shipment.vessel_name && extracted.vessel_name) {
        updates.vessel_name = extracted.vessel_name;
        stats.fields.vessel++;
      }
      if (extracted.voyage_number) {
        updates.voyage_number = extracted.voyage_number;
      }
      if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
        updates.etd = extracted.etd;
        stats.fields.etd++;
      }
      if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
        updates.eta = extracted.eta;
        stats.fields.eta++;
      }
      if (!shipment.port_of_loading && extracted.port_of_loading) {
        updates.port_of_loading = extracted.port_of_loading;
        stats.fields.pol++;
      }
      if (!shipment.port_of_discharge && extracted.port_of_discharge) {
        updates.port_of_discharge = extracted.port_of_discharge;
        stats.fields.pod++;
      }
      if (extracted.port_of_loading_code) updates.port_of_loading_code = extracted.port_of_loading_code;
      if (extracted.port_of_discharge_code) updates.port_of_discharge_code = extracted.port_of_discharge_code;

      // Cutoffs - critical!
      if (!shipment.si_cutoff && extracted.si_cutoff && dateRegex.test(extracted.si_cutoff)) {
        updates.si_cutoff = extracted.si_cutoff;
        stats.fields.si_cutoff++;
      }
      if (!shipment.vgm_cutoff && extracted.vgm_cutoff && dateRegex.test(extracted.vgm_cutoff)) {
        updates.vgm_cutoff = extracted.vgm_cutoff;
        stats.fields.vgm_cutoff++;
      }
      if (!shipment.cargo_cutoff && extracted.cargo_cutoff && dateRegex.test(extracted.cargo_cutoff)) {
        updates.cargo_cutoff = extracted.cargo_cutoff;
        stats.fields.cargo_cutoff++;
      }
      if (extracted.gate_cutoff && dateRegex.test(extracted.gate_cutoff)) {
        updates.gate_cutoff = extracted.gate_cutoff;
      }

      // Parties
      if (!shipment.shipper_name && extracted.shipper_name) {
        updates.shipper_name = extracted.shipper_name;
      }
      if (!shipment.consignee_name && extracted.consignee_name) {
        updates.consignee_name = extracted.consignee_name;
      }

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        const { error } = await supabase
          .from('shipments')
          .update(updates)
          .eq('id', shipment.id);

        if (!error) {
          stats.shipmentsUpdated++;
          if (Object.keys(updates).length > 2) {
            console.log(`  UPD: ${extracted.booking_number} +${Object.keys(updates).length - 1} fields`);
          }
        }
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Extracted:', stats.extracted);
  console.log('Shipments created:', stats.shipmentsCreated);
  console.log('Shipments updated:', stats.shipmentsUpdated);
  console.log('\nFields added:');
  Object.entries(stats.fields).forEach(([k, v]) => {
    if (v > 0) console.log(`  ${k}: ${v}`);
  });

  // Final coverage
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
