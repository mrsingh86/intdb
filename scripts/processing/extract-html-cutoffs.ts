#!/usr/bin/env npx tsx
/**
 * Extract cutoffs from body_html for emails where body_text is empty/minimal
 * Targets: COSCO (88% HTML-only) and CMA CGM (50% HTML-only)
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

const EXTRACTION_PROMPT = `Extract shipping information from this booking confirmation email.

LOOK CAREFULLY FOR:
1. Booking number / Booking reference
2. Vessel name and voyage number
3. ETD (Departure date)
4. ETA (Arrival date)
5. Port of Loading (POL)
6. Port of Discharge (POD)
7. CUTOFF DATES - Look for:
   - "SI Cut-off" / "SI closing" / "SI deadline" / "Documentation cut-off" → si_cutoff
   - "VGM Cut-off" / "VGM deadline" → vgm_cutoff
   - "Cargo Cut-off" / "CY Cut-off" / "CY Closing" / "Container cut-off" → cargo_cutoff
   - "Gate Cut-off" → gate_cutoff

IMPORTANT: Look for dates in any format (DD/MM/YYYY, DD-MMM-YYYY, etc.)

Return ONLY valid JSON:
{
  "booking_number": "string or null",
  "vessel_name": "string or null",
  "voyage_number": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "port_of_loading": "string or null",
  "port_of_discharge": "string or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "gate_cutoff": "YYYY-MM-DD or null"
}

EMAIL CONTENT:
`;

function stripHtml(html: string): string {
  // Remove scripts and styles
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<td[^>]*>/gi, '\t');

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#39;/gi, "'");

  // Clean up whitespace
  text = text.replace(/\t+/g, '\t');
  text = text.replace(/[ ]+/g, ' ');
  text = text.replace(/\n\s*\n/g, '\n');

  return text.trim();
}

function convertToISODate(dateStr: string): string | null {
  if (!dateStr || dateStr === 'null') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  // Try DD-MMM-YYYY or DD/MMM/YYYY
  const dmmyMatch = dateStr.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
  if (dmmyMatch) {
    const day = dmmyMatch[1].padStart(2, '0');
    const month = monthMap[dmmyMatch[2].toLowerCase()];
    if (month) return `${dmmyMatch[3]}-${month}-${day}`;
  }

  // Try DD/MM/YYYY
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
      messages: [{ role: 'user', content: EXTRACTION_PROMPT + content.substring(0, 15000) }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Convert dates
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
  console.log('║     EXTRACT CUTOFFS FROM HTML CONTENT (COSCO/CMA CGM)              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get shipments missing cutoffs
  const { data: missingShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, carrier_id, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, etd, eta, vessel_name')
    .is('si_cutoff', null)
    .is('vgm_cutoff', null)
    .is('cargo_cutoff', null);

  console.log('Shipments missing ALL cutoffs:', missingShipments?.length);

  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  // Build lookup by booking number
  const shipmentByBooking = new Map<string, any>();
  missingShipments?.forEach(s => {
    if (s.booking_number) {
      shipmentByBooking.set(s.booking_number, s);
      // Also try without prefix
      const numOnly = s.booking_number.replace(/\D/g, '');
      if (numOnly.length >= 6) shipmentByBooking.set(numOnly, s);
    }
  });

  // Get booking confirmation emails with HTML content
  const { data: bcs } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const emailIds = bcs?.map(e => e.email_id) || [];

  // Get emails where body_html is significantly larger than body_text
  const { data: htmlEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, body_html')
    .in('id', emailIds);

  // Filter to HTML-only emails (text < 500, html > 1000)
  const htmlOnlyEmails = (htmlEmails || []).filter(e => {
    const textLen = (e.body_text || '').length;
    const htmlLen = (e.body_html || '').length;
    return textLen < 500 && htmlLen > 1000;
  });

  console.log('HTML-only booking confirmation emails:', htmlOnlyEmails.length);

  const stats = {
    processed: 0,
    matched: 0,
    extracted: 0,
    updated: 0,
    cutoffs: { si: 0, vgm: 0, cargo: 0, gate: 0, etd: 0, eta: 0, vessel: 0 }
  };

  for (const email of htmlOnlyEmails) {
    stats.processed++;

    const subject = email.subject || '';
    const htmlContent = email.body_html || '';

    // Convert HTML to text
    const textContent = stripHtml(htmlContent);

    // Try to match to a missing shipment
    let shipment = null;
    let matchedBooking = '';

    // Look for booking numbers in subject
    const subjectMatches = subject.match(/\b(\d{8,})\b/g) ||
                          subject.match(/COSU(\d{10})/gi) ||
                          subject.match(/hl-?(\d{8})/gi) || [];

    for (const match of subjectMatches) {
      const cleanMatch = match.replace(/^COSU/i, '').replace(/^HL-?/i, '').replace(/\D/g, '');

      // Try exact match first
      shipment = shipmentByBooking.get(match);
      if (!shipment) {
        // Try the numeric part
        shipment = shipmentByBooking.get(cleanMatch);
      }
      if (!shipment) {
        // Try COSCO format
        shipment = shipmentByBooking.get('COSU' + cleanMatch);
      }

      if (shipment) {
        matchedBooking = shipment.booking_number;
        break;
      }
    }

    // Also search in text content
    if (!shipment) {
      const bookingMatches = textContent.substring(0, 5000).match(/booking[:\s#]*([A-Z0-9]{8,})/gi) || [];
      for (const match of bookingMatches) {
        const numOnly = match.replace(/booking[:\s#]*/i, '').replace(/[^A-Z0-9]/gi, '');
        shipment = shipmentByBooking.get(numOnly);
        if (shipment) {
          matchedBooking = shipment.booking_number;
          break;
        }
      }
    }

    if (!shipment) continue;
    stats.matched++;

    const carrierName = carrierMap.get(shipment.carrier_id) || 'Unknown';

    // Extract with AI
    const extracted = await extractWithAI(textContent);
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
    if (!shipment.vessel_name && extracted.vessel_name) {
      updates.vessel_name = extracted.vessel_name;
      stats.cutoffs.vessel++;
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        stats.updated++;
        const fields = Object.keys(updates).filter(k => k !== 'updated_at');
        console.log(`  [${carrierName}] ${matchedBooking}: Added ${fields.join(', ')}`);
        // Remove from lookup to avoid re-processing
        shipmentByBooking.delete(matchedBooking);
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 150));
  }

  console.log('\n' + '═'.repeat(60));
  console.log('RESULTS');
  console.log('═'.repeat(60));
  console.log('Processed HTML-only emails:', stats.processed);
  console.log('Matched to missing shipments:', stats.matched);
  console.log('Successfully extracted:', stats.extracted);
  console.log('Shipments updated:', stats.updated);
  console.log('\nNew data extracted:');
  console.log('  SI Cutoff:', stats.cutoffs.si);
  console.log('  VGM Cutoff:', stats.cutoffs.vgm);
  console.log('  Cargo Cutoff:', stats.cutoffs.cargo);
  console.log('  Gate Cutoff:', stats.cutoffs.gate);
  console.log('  ETD:', stats.cutoffs.etd);
  console.log('  ETA:', stats.cutoffs.eta);
  console.log('  Vessel:', stats.cutoffs.vessel);

  // Show final coverage
  const { data: final } = await supabase.from('shipments').select('*');
  const total = final?.length || 0;

  console.log('\n' + '═'.repeat(60));
  console.log('FINAL CUTOFF COVERAGE');
  console.log('═'.repeat(60));

  const fields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta', 'vessel_name'];
  for (const field of fields) {
    const count = final?.filter(s => (s as any)[field]).length || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`${field.padEnd(15)} ${bar} ${pct}% (${count}/${total})`);
  }
}

main().catch(console.error);
