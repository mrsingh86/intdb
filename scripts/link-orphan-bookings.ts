#!/usr/bin/env npx tsx
/**
 * Link Orphan Booking Emails to Shipments
 *
 * Match booking confirmation emails to shipments using fuzzy matching
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

const EXTRACTION_PROMPT = `Extract shipping cutoff dates from this booking document.

LOOK FOR THESE SPECIFIC CUTOFF DATES:
1. "FCL delivery cut-off", "Cargo cut-off", "CY cut-off", "Container Yard Cut-off" → cargo_cutoff
2. "SI closing", "Shipping instruction", "Documentation deadline", "SI Cut-off" → si_cutoff
3. "VGM cut-off", "VGM deadline", "VGM submission" → vgm_cutoff
4. "Gate cut-off" → gate_cutoff

Also look for:
- ETD/Departure date
- ETA/Arrival date
- Vessel name
- Booking number (confirm it matches)

Return ONLY valid JSON:
{
  "booking_number": "string",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "gate_cutoff": "YYYY-MM-DD or null",
  "vessel_name": "string or null"
}

Convert dates like "25-Dec-2025" to YYYY-MM-DD format.

DOCUMENT:
`;

function normalizeBookingNumber(bn: string): string {
  // Remove common prefixes and normalize
  return bn
    .replace(/^HL-?/i, '')
    .replace(/^COSU/i, '')
    .replace(/^MAEU/i, '')
    .replace(/^CMAU/i, '')
    .replace(/_.*$/, '') // Remove suffixes like _I
    .replace(/\D/g, ''); // Keep only digits
}

function convertDateToISO(dateStr: string): string | null {
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
  console.log('=== LINKING ORPHAN BOOKINGS ===\n');

  // Get shipments missing cutoffs
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .is('si_cutoff', null)
    .is('vgm_cutoff', null)
    .is('cargo_cutoff', null);

  console.log('Shipments missing all cutoffs:', shipments?.length);

  // Create lookup maps for shipments
  const shipmentByExact = new Map<string, any>();
  const shipmentByNormalized = new Map<string, any>();

  shipments?.forEach(s => {
    if (s.booking_number) {
      shipmentByExact.set(s.booking_number, s);
      shipmentByExact.set(s.booking_number.toUpperCase(), s);
      const normalized = normalizeBookingNumber(s.booking_number);
      if (normalized.length >= 6) {
        shipmentByNormalized.set(normalized, s);
      }
    }
  });

  // Get booking confirmation emails
  const { data: bcClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bcEmailIds = bcClassifications?.map(c => c.email_id) || [];

  const { data: bcEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .in('id', bcEmailIds);

  console.log('Booking confirmation emails:', bcEmails?.length);

  // Get PDF attachments for these emails
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, filename, extracted_text')
    .in('email_id', bcEmailIds)
    .ilike('mime_type', '%pdf%')
    .not('extracted_text', 'is', null);

  const attachmentsByEmail = new Map<string, any[]>();
  attachments?.forEach(att => {
    if (!attachmentsByEmail.has(att.email_id)) {
      attachmentsByEmail.set(att.email_id, []);
    }
    attachmentsByEmail.get(att.email_id)!.push(att);
  });

  const stats = {
    processed: 0,
    matched: 0,
    extracted: 0,
    updated: 0,
    newCutoffs: { si: 0, vgm: 0, cargo: 0, gate: 0 },
  };

  // Process each booking confirmation email
  for (const email of bcEmails || []) {
    stats.processed++;

    if (stats.processed % 30 === 0) {
      console.log(`Progress: ${stats.processed}/${bcEmails?.length} (updated: ${stats.updated})`);
    }

    // Extract booking numbers from subject
    const subject = email.subject || '';
    const bookingMatches = subject.match(/\b(\d{8,})\b/g) ||
      subject.match(/hl-?(\d{8})/gi) ||
      subject.match(/COSU(\d+)/gi) || [];

    let shipment = null;
    let matchedBooking = '';

    // Try to match to a shipment
    for (const match of bookingMatches) {
      const bn = match.replace(/^HL-?/i, '').replace(/^COSU/i, '');
      shipment = shipmentByExact.get(bn) ||
        shipmentByExact.get(match) ||
        shipmentByNormalized.get(normalizeBookingNumber(bn));
      if (shipment) {
        matchedBooking = shipment.booking_number;
        break;
      }
    }

    if (!shipment) continue;
    stats.matched++;

    // Get content for extraction
    let content = email.body_text || '';

    // Add PDF attachment text
    const emailAttachments = attachmentsByEmail.get(email.id) || [];
    for (const att of emailAttachments) {
      if (att.extracted_text) {
        content += '\n\n=== ' + att.filename + ' ===\n' + att.extracted_text;
      }
    }

    if (content.length < 200) continue;

    // Extract with AI
    const extracted = await extractWithAI(content);
    if (!extracted) continue;
    stats.extracted++;

    // Build updates
    const updates: Record<string, any> = {};
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
      updates.etd = extracted.etd;
    }
    if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
      updates.eta = extracted.eta;
    }
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
    if (!shipment.vessel_name && extracted.vessel_name) {
      updates.vessel_name = extracted.vessel_name;
    }

    // Update shipment
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
          console.log(`  ${matchedBooking}: +${cutoffs.join(',')}`);
        }
      }
    }

    // Also create entity_extraction link if not exists
    const { data: existingExtraction } = await supabase
      .from('entity_extractions')
      .select('id')
      .eq('email_id', email.id)
      .eq('booking_number', matchedBooking)
      .single();

    if (!existingExtraction) {
      await supabase.from('entity_extractions').insert({
        email_id: email.id,
        booking_number: matchedBooking,
        extracted_data: extracted,
        extraction_method: 'ai_link_orphan',
        confidence_score: 0.8,
        created_at: new Date().toISOString()
      });
    }

    await new Promise(r => setTimeout(r, 150));
  }

  console.log('\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Matched to shipments:', stats.matched);
  console.log('Extracted:', stats.extracted);
  console.log('Updated:', stats.updated);
  console.log('\nNew cutoffs:');
  console.log('  SI:', stats.newCutoffs.si);
  console.log('  VGM:', stats.newCutoffs.vgm);
  console.log('  Cargo:', stats.newCutoffs.cargo);
  console.log('  Gate:', stats.newCutoffs.gate);

  // Final coverage
  console.log('\n=== FINAL COVERAGE ===');
  const { data: final } = await supabase.from('shipments').select('*');
  const total = final?.length || 0;

  const fields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'etd', 'eta'];
  for (const field of fields) {
    const count = final?.filter(s => (s as any)[field]).length || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`${field.padEnd(20)} ${bar} ${pct}%`);
  }
}

main().catch(console.error);
