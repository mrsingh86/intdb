#!/usr/bin/env npx tsx
/**
 * Extract Cutoffs from ALL Emails with Embedded PDF Text
 *
 * These emails have PDF content embedded in body_text with format:
 * === filename.pdf ===
 * {PDF content}
 *
 * We extract from ALL such emails, not just booking confirmations
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

const EXTRACTION_PROMPT = `Extract shipping booking/cutoff information from this document.

LOOK FOR:
1. Booking number (8+ digits, or with carrier prefix like COSU, MAEU, HL-)
2. Carrier name (Hapag-Lloyd, Maersk, CMA CGM, COSCO, MSC, ONE, Evergreen)
3. Cutoff dates with these labels:
   - "FCL delivery cut-off", "Cargo cut-off", "CY cut-off" → cargo_cutoff
   - "SI closing", "Shipping instruction", "Documentation deadline" → si_cutoff
   - "VGM cut-off", "VGM deadline", "VGM submission" → vgm_cutoff
   - "Gate cut-off" → gate_cutoff
4. ETD (departure date)
5. ETA (arrival date)
6. Vessel name
7. Port of Loading (POL)
8. Port of Discharge (POD)

Return ONLY valid JSON:
{
  "booking_number": "string or null",
  "carrier": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "gate_cutoff": "YYYY-MM-DD or null",
  "vessel_name": "string or null",
  "port_of_loading": "string or null",
  "port_of_discharge": "string or null"
}

RULES:
1. Convert dates like "25-Dec-2025" or "25/12/2025" to YYYY-MM-DD format
2. Use null for missing values
3. Search the ENTIRE document

DOCUMENT:
`;

function convertDateToISO(dateStr: string): string | null {
  if (!dateStr || dateStr === 'null') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  // DD-MMM-YYYY
  const dmmyMatch = dateStr.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
  if (dmmyMatch) {
    const day = dmmyMatch[1].padStart(2, '0');
    const month = monthMap[dmmyMatch[2].toLowerCase()];
    if (month) return `${dmmyMatch[3]}-${month}-${day}`;
  }

  // DD/MM/YYYY
  const ddmmMatch = dateStr.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (ddmmMatch) {
    const [, day, month, year] = ddmmMatch;
    if (parseInt(month) <= 12) return `${year}-${month}-${day}`;
  }

  return null;
}

async function extractWithAI(content: string): Promise<any> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{ role: 'user', content: EXTRACTION_PROMPT + content.substring(0, 12000) }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      for (const key of Object.keys(parsed)) {
        if (parsed[key] === 'null' || parsed[key] === '') parsed[key] = null;
        if ((key.includes('cutoff') || key === 'etd' || key === 'eta') && parsed[key]) {
          parsed[key] = convertDateToISO(parsed[key]);
        }
      }
      return parsed;
    }
    return null;
  } catch (error: any) {
    return null;
  }
}

async function main() {
  console.log('=== EXTRACTING FROM ALL EMBEDDED PDF EMAILS ===\n');

  // Get carrier IDs
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierIdMap = new Map<string, string>();
  carriers?.forEach(c => {
    const name = c.carrier_name.toLowerCase();
    carrierIdMap.set(name, c.id);
    if (name.includes('hapag')) carrierIdMap.set('hapag-lloyd', c.id);
    if (name.includes('maersk')) carrierIdMap.set('maersk', c.id);
    if (name.includes('cma')) carrierIdMap.set('cma-cgm', c.id);
    if (name.includes('cosco')) carrierIdMap.set('cosco', c.id);
  });

  // Get ALL emails with embedded PDF text
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email')
    .ilike('body_text', '%=== %.pdf ===%')
    .order('received_at', { ascending: false });

  console.log('Emails with embedded PDF:', emails?.length);

  // Get all shipments
  const { data: shipments } = await supabase.from('shipments').select('*');
  console.log('Total shipments:', shipments?.length);

  const shipmentByBooking = new Map<string, any>();
  shipments?.forEach(s => {
    if (s.booking_number) {
      shipmentByBooking.set(s.booking_number, s);
      const numOnly = s.booking_number.replace(/\D/g, '');
      if (numOnly.length >= 6) shipmentByBooking.set(numOnly, s);
    }
  });

  // Stats
  const stats = {
    processed: 0,
    extracted: 0,
    matched: 0,
    updated: 0,
    newCutoffs: { si: 0, vgm: 0, cargo: 0, gate: 0 },
    newDates: { etd: 0, eta: 0 },
  };

  // Process each email
  for (const email of emails || []) {
    stats.processed++;

    if (stats.processed % 30 === 0) {
      console.log(`Progress: ${stats.processed}/${emails?.length} (updated: ${stats.updated})`);
    }

    const body = email.body_text || '';
    if (body.length < 500) continue;

    // Extract with AI
    const extracted = await extractWithAI(body);
    if (!extracted) continue;
    stats.extracted++;

    // Find booking number
    let bookingNumber = extracted.booking_number;
    if (!bookingNumber) {
      // Try to extract from subject
      const match = email.subject?.match(/\b(\d{8,})\b/) ||
                    email.subject?.match(/HL-?(\d{8})/i) ||
                    email.subject?.match(/COSU(\d+)/i);
      if (match) bookingNumber = match[1] || match[0];
    }

    if (!bookingNumber) continue;

    // Find shipment
    const shipment = shipmentByBooking.get(bookingNumber) ||
                     shipmentByBooking.get(bookingNumber.replace(/\D/g, ''));
    if (!shipment) continue;
    stats.matched++;

    // Build updates
    const updates: Record<string, any> = {};
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    // Carrier
    if (!shipment.carrier_id && extracted.carrier) {
      const carrierId = carrierIdMap.get(extracted.carrier.toLowerCase());
      if (carrierId) updates.carrier_id = carrierId;
    }

    // Dates
    if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
      updates.etd = extracted.etd;
      stats.newDates.etd++;
    }
    if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
      updates.eta = extracted.eta;
      stats.newDates.eta++;
    }

    // Cutoffs
    if (!shipment.si_cutoff && extracted.si_cutoff && dateRegex.test(extracted.si_cutoff)) {
      updates.si_cutoff = extracted.si_cutoff;
      stats.newCutoffs.si++;
    }
    if (!shipment.vgm_cutoff && extracted.vgm_cutoff && dateRegex.test(extracted.vgm_cutoff)) {
      updates.vgm_cutoff = extracted.vgm_cutoff;
      stats.newCutoffs.vgm++;
    }
    if (!shipment.cargo_cutoff && extracted.cargo_cutoff && dateRegex.test(extracted.cargo_cutoff)) {
      updates.cargo_cutoff = extracted.cargo_cutoff;
      stats.newCutoffs.cargo++;
    }
    if (!shipment.gate_cutoff && extracted.gate_cutoff && dateRegex.test(extracted.gate_cutoff)) {
      updates.gate_cutoff = extracted.gate_cutoff;
      stats.newCutoffs.gate++;
    }

    // Vessel/Ports
    if (!shipment.vessel_name && extracted.vessel_name) {
      updates.vessel_name = extracted.vessel_name;
    }
    if (!shipment.port_of_loading && extracted.port_of_loading) {
      updates.port_of_loading = extracted.port_of_loading;
    }
    if (!shipment.port_of_discharge && extracted.port_of_discharge) {
      updates.port_of_discharge = extracted.port_of_discharge;
    }

    // Update
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        stats.updated++;
        const cutoffs = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff']
          .filter(f => updates[f])
          .map(f => f.replace('_cutoff', '').toUpperCase());
        if (cutoffs.length > 0) {
          console.log(`  ${bookingNumber}: +${cutoffs.join(',')}`);
        }
      }
    }

    await new Promise(r => setTimeout(r, 150));
  }

  console.log('\n\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Extracted:', stats.extracted);
  console.log('Matched to shipments:', stats.matched);
  console.log('Updated:', stats.updated);
  console.log('\nNew cutoffs:');
  console.log('  SI:', stats.newCutoffs.si);
  console.log('  VGM:', stats.newCutoffs.vgm);
  console.log('  Cargo:', stats.newCutoffs.cargo);
  console.log('  Gate:', stats.newCutoffs.gate);
  console.log('New dates:');
  console.log('  ETD:', stats.newDates.etd);
  console.log('  ETA:', stats.newDates.eta);

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
