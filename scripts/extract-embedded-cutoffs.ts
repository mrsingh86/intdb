#!/usr/bin/env npx tsx
/**
 * Extract cutoffs from embedded PDF content in email body_text
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });

const EXTRACTION_PROMPT = `Extract shipping cutoff dates from this booking confirmation document.

LOOK CAREFULLY FOR THESE CUTOFF FIELDS:
1. "FCL delivery cut-off", "Cargo cut-off", "CY cut-off", "CY Closing" → cargo_cutoff
2. "SI closing", "SI Cut-off", "Shipping Instruction" → si_cutoff
3. "VGM cut-off", "VGM deadline" → vgm_cutoff
4. "Gate cut-off" → gate_cutoff
5. ETD/Departure date
6. ETA/Arrival date
7. Booking number

Convert all dates to YYYY-MM-DD format.

Return ONLY valid JSON:
{
  "booking_number": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "gate_cutoff": "YYYY-MM-DD or null"
}

DOCUMENT:
`;

function convertToISODate(dateStr: string): string | null {
  if (!dateStr || dateStr === 'null') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  const dmmyMatch = dateStr.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
  if (dmmyMatch) {
    const day = dmmyMatch[1].padStart(2, '0');
    const month = monthMap[dmmyMatch[2].toLowerCase()];
    if (month) return `${dmmyMatch[3]}-${month}-${day}`;
  }

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
          parsed[key] = convertToISODate(parsed[key]);
        }
      }
      return parsed;
    }
    return null;
  } catch (error: any) {
    console.log('  AI error:', error.message?.substring(0, 50));
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     EXTRACT FROM EMBEDDED PDF CONTENT WITH CUTOFF KEYWORDS         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get shipments missing cutoffs
  const { data: missingShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, etd, eta')
    .is('si_cutoff', null)
    .is('vgm_cutoff', null)
    .is('cargo_cutoff', null);

  console.log('Shipments missing cutoffs:', missingShipments?.length);

  // Build lookup
  const shipmentByBooking = new Map<string, any>();
  missingShipments?.forEach(s => {
    if (s.booking_number) {
      shipmentByBooking.set(s.booking_number, s);
      const numOnly = s.booking_number.replace(/\D/g, '');
      if (numOnly.length >= 6) shipmentByBooking.set(numOnly, s);
    }
  });

  // Get emails with embedded PDF that have cutoff keywords
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .like('body_text', '%=== %.pdf ===%')
    .limit(1000);

  // Filter to those with cutoff keywords
  const emailsWithCutoffs = (emails || []).filter(e => {
    const body = (e.body_text || '').toLowerCase();
    return body.includes('cut-off') || body.includes('cutoff') ||
           body.includes('cy closing') || body.includes('si closing');
  });

  console.log('Emails with embedded PDF + cutoff keywords:', emailsWithCutoffs.length);

  const stats = {
    processed: 0,
    matched: 0,
    extracted: 0,
    updated: 0,
    cutoffs: { si: 0, vgm: 0, cargo: 0, gate: 0, etd: 0, eta: 0 }
  };

  for (const email of emailsWithCutoffs) {
    stats.processed++;

    const subject = email.subject || '';
    const body = email.body_text || '';

    // Try to match to a missing shipment
    let shipment = null;
    let matchedBooking = '';

    // Look for booking numbers in subject
    const subjectMatches = subject.match(/\b(\d{8,})\b/g) ||
                          subject.match(/hl-?(\d{8})/gi) || [];

    for (const match of subjectMatches) {
      const cleanMatch = match.replace(/^HL-?/i, '').replace(/\D/g, '');
      shipment = shipmentByBooking.get(match) || shipmentByBooking.get(cleanMatch);
      if (shipment) {
        matchedBooking = shipment.booking_number;
        break;
      }
    }

    // Also try body text
    if (!shipment) {
      const bodyMatches = body.substring(0, 3000).match(/booking[:\s#]*(\d{8,})/gi) || [];
      for (const match of bodyMatches) {
        const numOnly = match.replace(/\D/g, '');
        shipment = shipmentByBooking.get(numOnly);
        if (shipment) {
          matchedBooking = shipment.booking_number;
          break;
        }
      }
    }

    if (!shipment) continue;
    stats.matched++;

    // Extract with AI
    const extracted = await extractWithAI(body);
    if (!extracted) continue;
    stats.extracted++;

    // Build updates
    const updates: Record<string, any> = {};
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!shipment.si_cutoff && extracted.si_cutoff && dateRegex.test(extracted.si_cutoff)) {
      updates.si_cutoff = extracted.si_cutoff;
      stats.cutoffs.si++;
    }
    if (!shipment.vgm_cutoff && extracted.vgm_cutoff && dateRegex.test(extracted.vgm_cutoff)) {
      updates.vgm_cutoff = extracted.vgm_cutoff;
      stats.cutoffs.vgm++;
    }
    if (!shipment.cargo_cutoff && extracted.cargo_cutoff && dateRegex.test(extracted.cargo_cutoff)) {
      updates.cargo_cutoff = extracted.cargo_cutoff;
      stats.cutoffs.cargo++;
    }
    if (!shipment.gate_cutoff && extracted.gate_cutoff && dateRegex.test(extracted.gate_cutoff)) {
      updates.gate_cutoff = extracted.gate_cutoff;
      stats.cutoffs.gate++;
    }
    if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
      updates.etd = extracted.etd;
      stats.cutoffs.etd++;
    }
    if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
      updates.eta = extracted.eta;
      stats.cutoffs.eta++;
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        stats.updated++;
        const fields = Object.keys(updates).filter(k => k.includes('cutoff'))
          .map(k => k.replace('_cutoff', '').toUpperCase());
        if (fields.length > 0) {
          console.log(`  [${matchedBooking}] Added: ${fields.join(', ')}`);
        }
        shipmentByBooking.delete(matchedBooking);
      }
    }

    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Matched to missing shipments:', stats.matched);
  console.log('Extracted:', stats.extracted);
  console.log('Updated:', stats.updated);
  console.log('\nNew cutoffs:');
  console.log('  SI:', stats.cutoffs.si);
  console.log('  VGM:', stats.cutoffs.vgm);
  console.log('  Cargo:', stats.cutoffs.cargo);
  console.log('  Gate:', stats.cutoffs.gate);

  // Final coverage
  const { data: final } = await supabase.from('shipments').select('*');
  const total = final?.length || 0;
  console.log('\n=== FINAL COVERAGE ===');

  const fields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta'];
  for (const field of fields) {
    const count = final?.filter(s => (s as any)[field]).length || 0;
    const pct = Math.round((count / total) * 100);
    console.log(`${field.padEnd(15)} ${pct}% (${count}/${total})`);
  }
}

main().catch(console.error);
