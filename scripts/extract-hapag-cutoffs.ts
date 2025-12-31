#!/usr/bin/env npx tsx
/**
 * Extract Hapag-Lloyd Cutoff Dates from Email Body
 *
 * Hapag emails have embedded PDF text in format:
 * DeadlineLocationDate / Time (local)Required Action
 * FCL delivery cut-off
 * GURGAON (INGGN)
 * 25-Dec-2025 17:00
 * ...
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

// Hapag cutoff extraction prompt - very specific
const HAPAG_CUTOFF_PROMPT = `Extract ONLY the dates from this Hapag-Lloyd booking confirmation. The dates are in a table format.

LOOK FOR THESE EXACT LABELS:
1. "FCL delivery cut-off" or "Cargo cut-off" → cargo_cutoff
2. "Shipping instruction closing" or "SI closing" → si_cutoff
3. "VGM cut-off" or "VGM submission" → vgm_cutoff
4. "Gate cut-off" → gate_cutoff
5. "Documentation cut-off" → doc_cutoff
6. "ETD" or "Estimated time of departure" → etd
7. "ETA" or "Estimated time of arrival" → eta

Date formats in document: DD-MMM-YYYY or DD/MM/YYYY or DD-Mon-YYYY HH:MM

ALSO EXTRACT:
- Vessel name (look for "VESSEL" or after "By" in routing table)
- Voyage number
- POL (Port of Loading)
- POD (Port of Discharge)

Return ONLY valid JSON:
{
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "gate_cutoff": "YYYY-MM-DD or null",
  "doc_cutoff": "YYYY-MM-DD or null",
  "vessel_name": "string or null",
  "voyage_number": "string or null",
  "port_of_loading": "string or null",
  "port_of_loading_code": "5-char code or null",
  "port_of_discharge": "string or null",
  "port_of_discharge_code": "5-char code or null"
}

DOCUMENT:
`;

function convertDateToISO(dateStr: string): string | null {
  if (!dateStr) return null;

  // Try DD-MMM-YYYY format (e.g., 25-Dec-2025)
  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  const dmmyMatch = dateStr.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
  if (dmmyMatch) {
    const day = dmmyMatch[1].padStart(2, '0');
    const month = monthMap[dmmyMatch[2].toLowerCase()];
    const year = dmmyMatch[3];
    if (month) return `${year}-${month}-${day}`;
  }

  // Try YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // Try DD/MM/YYYY format
  const ddmmyyyyMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (ddmmyyyyMatch) {
    return `${ddmmyyyyMatch[3]}-${ddmmyyyyMatch[2]}-${ddmmyyyyMatch[1]}`;
  }

  return null;
}

// Direct regex extraction as backup
function extractDatesRegex(text: string): Record<string, string | null> {
  const result: Record<string, string | null> = {
    cargo_cutoff: null,
    si_cutoff: null,
    vgm_cutoff: null,
    gate_cutoff: null,
    eta: null,
    etd: null,
  };

  const datePattern = /(\d{1,2}[-\/][A-Za-z]{3}[-\/]\d{4})/g;
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const nextLine = lines[i + 1] || '';
    const lineAfter = lines[i + 2] || '';

    // Look for date in next few lines
    const dateMatch = (nextLine + ' ' + lineAfter).match(datePattern);
    const foundDate = dateMatch ? convertDateToISO(dateMatch[0]) : null;

    if (!foundDate) continue;

    if (line.includes('fcl delivery cut-off') || line.includes('cargo cut-off')) {
      if (!result.cargo_cutoff) result.cargo_cutoff = foundDate;
    } else if (line.includes('shipping instruction closing') || line.includes('si closing')) {
      if (!result.si_cutoff) result.si_cutoff = foundDate;
    } else if (line.includes('vgm cut-off') || line.includes('vgm submission')) {
      if (!result.vgm_cutoff) result.vgm_cutoff = foundDate;
    } else if (line.includes('gate cut-off')) {
      if (!result.gate_cutoff) result.gate_cutoff = foundDate;
    } else if (line.includes('estimated time of arrival') || line === 'eta') {
      if (!result.eta) result.eta = foundDate;
    } else if (line.includes('estimated time of departure') || line === 'etd') {
      if (!result.etd) result.etd = foundDate;
    }
  }

  return result;
}

async function extractWithAI(content: string): Promise<any> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{ role: 'user', content: HAPAG_CUTOFF_PROMPT + content.substring(0, 8000) }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Clean null strings and convert dates
      for (const key of Object.keys(parsed)) {
        if (parsed[key] === 'null' || parsed[key] === '' || parsed[key] === 'N/A') {
          parsed[key] = null;
        } else if (key.includes('cutoff') || key === 'etd' || key === 'eta') {
          // Ensure date format
          parsed[key] = convertDateToISO(parsed[key]) || parsed[key];
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
  console.log('=== EXTRACTING HAPAG-LLOYD CUTOFF DATES ===\n');

  // Get Hapag carrier ID
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const hapagCarrier = carriers?.find(c => c.carrier_name.toLowerCase().includes('hapag'));

  // Get Hapag emails with body text
  const { data: hapagEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .ilike('sender_email', '%hlag.com%')
    .not('body_text', 'is', null);

  console.log('Hapag emails with body:', hapagEmails?.length);

  // Get shipments for matching
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .or('si_cutoff.is.null,vgm_cutoff.is.null,cargo_cutoff.is.null,eta.is.null,etd.is.null');

  console.log('Shipments needing cutoffs:', shipments?.length);

  const shipmentByBooking = new Map<string, any>();
  shipments?.forEach(s => {
    if (s.booking_number) {
      shipmentByBooking.set(s.booking_number, s);
      // Also by number only
      const numOnly = s.booking_number.replace(/\D/g, '');
      if (numOnly.length >= 8) {
        shipmentByBooking.set(numOnly.substring(0, 8), s);
      }
    }
  });

  // Stats
  const stats = {
    processed: 0,
    matched: 0,
    updated: 0,
    fields: {
      si_cutoff: 0,
      vgm_cutoff: 0,
      cargo_cutoff: 0,
      gate_cutoff: 0,
      eta: 0,
      etd: 0,
      vessel: 0,
      pol: 0,
      pod: 0,
    }
  };

  // Process emails
  for (const email of hapagEmails || []) {
    stats.processed++;

    if (stats.processed % 30 === 0) {
      console.log(`\nProgress: ${stats.processed}/${hapagEmails?.length}`);
    }

    // Extract booking number from subject (HL-XXXXXXXX)
    const bookingMatch = email.subject.match(/HL-?(\d{8})/i) || email.subject.match(/(\d{8})/);
    if (!bookingMatch) continue;

    const bookingNumber = bookingMatch[1];
    const shipment = shipmentByBooking.get(bookingNumber);
    if (!shipment) continue;

    stats.matched++;

    const body = email.body_text || '';
    if (body.length < 500) continue;

    // Try regex extraction first (faster, more reliable for known format)
    const regexData = extractDatesRegex(body);

    // If regex didn't get enough, use AI
    let extracted = regexData;
    const regexFields = Object.values(regexData).filter(v => v !== null).length;

    if (regexFields < 3) {
      const aiData = await extractWithAI(body);
      if (aiData) {
        // Merge AI data with regex data (prefer non-null values)
        for (const key of Object.keys(aiData)) {
          if (aiData[key] && !extracted[key as keyof typeof extracted]) {
            (extracted as any)[key] = aiData[key];
          }
        }
      }
    }

    // Build updates
    const updates: Record<string, any> = {};
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

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
    if (!shipment.gate_cutoff && extracted.gate_cutoff && dateRegex.test(extracted.gate_cutoff)) {
      updates.gate_cutoff = extracted.gate_cutoff;
      stats.fields.gate_cutoff++;
    }
    if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
      updates.eta = extracted.eta;
      stats.fields.eta++;
    }
    if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
      updates.etd = extracted.etd;
      stats.fields.etd++;
    }

    // Vessel/Voyage/Ports from AI
    if (!shipment.vessel_name && (extracted as any).vessel_name) {
      updates.vessel_name = (extracted as any).vessel_name;
      stats.fields.vessel++;
    }
    if (!shipment.port_of_loading && (extracted as any).port_of_loading) {
      updates.port_of_loading = (extracted as any).port_of_loading;
      stats.fields.pol++;
    }
    if (!shipment.port_of_discharge && (extracted as any).port_of_discharge) {
      updates.port_of_discharge = (extracted as any).port_of_discharge;
      stats.fields.pod++;
    }
    if ((extracted as any).port_of_loading_code) {
      updates.port_of_loading_code = (extracted as any).port_of_loading_code;
    }
    if ((extracted as any).port_of_discharge_code) {
      updates.port_of_discharge_code = (extracted as any).port_of_discharge_code;
    }

    // Update if changes
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      updates.carrier_id = hapagCarrier?.id; // Ensure carrier is set

      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        stats.updated++;
        const cutoffs = [
          updates.si_cutoff ? 'SI' : null,
          updates.vgm_cutoff ? 'VGM' : null,
          updates.cargo_cutoff ? 'CGO' : null,
        ].filter(Boolean).join(',');
        if (cutoffs) {
          console.log(`  ${bookingNumber}: +${cutoffs}`);
        }
      }
    }

    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Matched to shipments:', stats.matched);
  console.log('Updated:', stats.updated);
  console.log('\nFields extracted:');
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
