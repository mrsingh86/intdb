#!/usr/bin/env npx tsx
/**
 * Final Cutoff Extraction Script
 *
 * This comprehensive script extracts cutoffs from ALL available sources:
 * 1. Embedded PDF content in email body_text (Hapag-Lloyd style)
 * 2. Extracted text from raw_attachments
 * 3. Email body text with cutoff keywords
 *
 * Focus on getting maximum coverage for shipments still missing cutoffs.
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });

// ============================================================================
// Types
// ============================================================================

interface Shipment {
  id: string;
  booking_number: string | null;
  bl_number: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  etd: string | null;
  eta: string | null;
  vessel_name: string | null;
}

interface ExtractedData {
  booking_number: string | null;
  etd: string | null;
  eta: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  vessel_name: string | null;
}

// ============================================================================
// Extraction Prompt
// ============================================================================

const EXTRACTION_PROMPT = `Extract shipping cutoff dates and booking information from this document.

LOOK FOR THESE SPECIFIC FIELDS:
1. Booking number (formats: 8+ digits, COSU*, MAEU*, HL-*, CEI*, AMC*, HLCU*)
2. Cutoff dates - SEARCH THE ENTIRE DOCUMENT:
   - "FCL delivery cut-off", "Cargo cut-off", "CY cut-off", "CY Closing", "Container Yard" → cargo_cutoff
   - "SI closing", "Shipping instruction closing", "Documentation deadline", "SI Cut-off" → si_cutoff
   - "VGM cut-off", "VGM deadline", "VGM submission" → vgm_cutoff
   - "Gate cut-off", "Gate closing" → gate_cutoff
3. ETD/Departure date
4. ETA/Arrival date
5. Vessel name

DATE FORMATS to recognize:
- "25-Dec-2025 10:00" → 2025-12-25
- "25/12/2025" → 2025-12-25
- "2025-12-25T10:00:00" → 2025-12-25

Return ONLY valid JSON:
{
  "booking_number": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "gate_cutoff": "YYYY-MM-DD or null",
  "vessel_name": "string or null"
}

DOCUMENT:
`;

// ============================================================================
// Helper Functions
// ============================================================================

function convertToISODate(dateStr: string): string | null {
  if (!dateStr) return null;
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

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmMatch = dateStr.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (ddmmMatch) {
    const [, day, month, year] = ddmmMatch;
    if (parseInt(month) <= 12) return `${year}-${month}-${day}`;
  }

  // YYYY-MM-DD with time
  const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  return null;
}

async function extractWithAI(content: string): Promise<ExtractedData | null> {
  if (content.length < 300) return null;

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

      // Normalize dates
      for (const field of ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff']) {
        if (parsed[field] === 'null' || parsed[field] === '') {
          parsed[field] = null;
        } else if (parsed[field]) {
          parsed[field] = convertToISODate(parsed[field]);
        }
      }

      // Clean null strings
      for (const field of ['booking_number', 'vessel_name']) {
        if (parsed[field] === 'null' || parsed[field] === '') {
          parsed[field] = null;
        }
      }

      return parsed as ExtractedData;
    }
  } catch (error: any) {
    console.error(`  AI error: ${error.message}`);
  }

  return null;
}

function extractBookingCandidates(text: string): string[] {
  const candidates: string[] = [];

  // HL-XXXXXXXX (Hapag-Lloyd)
  for (const m of text.matchAll(/HL-?(\d{8})/gi)) {
    candidates.push(m[1]);
    candidates.push('HL-' + m[1]);
  }

  // Our Reference
  const ourRefMatch = text.match(/Our Reference[:\s]+(\d{8,})/i);
  if (ourRefMatch) candidates.push(ourRefMatch[1]);

  // 8-10 digit numbers
  for (const m of text.matchAll(/\b(\d{8,10})\b/g)) {
    candidates.push(m[1]);
  }

  // COSU (COSCO)
  for (const m of text.matchAll(/COSU(\d+)/gi)) {
    candidates.push('COSU' + m[1]);
  }

  // CEI/AMC (CMA CGM)
  for (const m of text.matchAll(/(CEI\d+|AMC\d+)/gi)) {
    candidates.push(m[1].toUpperCase());
  }

  // 9-digit Maersk (26XXXXXXX)
  for (const m of text.matchAll(/\b(26\d{7})\b/g)) {
    candidates.push(m[1]);
  }

  return [...new Set(candidates)];
}

// ============================================================================
// Main Processing
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              FINAL CUTOFF EXTRACTION PIPELINE                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const stats = {
    shipmentsNeedingCutoffs: 0,
    emailsProcessed: 0,
    emailsMatched: 0,
    shipmentsUpdated: 0,
    cutoffs: { si: 0, vgm: 0, cargo: 0, gate: 0, etd: 0, eta: 0 },
  };

  // Step 1: Load shipments missing cutoffs
  console.log('Step 1: Loading shipments needing cutoffs...');
  const { data: allShipments } = await supabase.from('shipments').select('*');

  const shipmentsNeedingCutoffs = allShipments?.filter(s =>
    s.si_cutoff === null || s.vgm_cutoff === null || s.cargo_cutoff === null
  ) || [];

  stats.shipmentsNeedingCutoffs = shipmentsNeedingCutoffs.length;
  console.log(`  Total shipments: ${allShipments?.length}`);
  console.log(`  Needing cutoffs: ${shipmentsNeedingCutoffs.length}`);

  // Build comprehensive shipment lookup
  const shipmentLookup = new Map<string, Shipment>();
  for (const s of shipmentsNeedingCutoffs) {
    if (s.booking_number) {
      const bn = s.booking_number;
      shipmentLookup.set(bn, s);
      shipmentLookup.set(bn.toUpperCase(), s);
      shipmentLookup.set(bn.toLowerCase(), s);

      const numOnly = bn.replace(/\D/g, '');
      if (numOnly.length >= 8) {
        shipmentLookup.set(numOnly, s);
      }

      if (bn.startsWith('HL-')) {
        shipmentLookup.set(bn.substring(3), s);
      } else if (/^\d{8}$/.test(bn)) {
        shipmentLookup.set('HL-' + bn, s);
      }

      if (bn.startsWith('COSU')) {
        shipmentLookup.set(bn.substring(4), s);
      }
    }
    if (s.bl_number) {
      shipmentLookup.set(s.bl_number, s);
      shipmentLookup.set(s.bl_number.toUpperCase(), s);
    }
  }

  console.log(`  Lookup entries: ${shipmentLookup.size}`);

  // Step 2: Load all emails with cutoff/PDF content
  console.log('\nStep 2: Loading relevant emails...');
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .or('body_text.ilike.%=== %.pdf ===%,body_text.ilike.%cut-off%,body_text.ilike.%cutoff%,body_text.ilike.%deadline%,body_text.ilike.%SI closing%,body_text.ilike.%VGM%,body_text.ilike.%Our Reference%')
    .order('received_at', { ascending: false });

  console.log(`  Found ${emails?.length} relevant emails`);

  // Step 3: Load PDF attachments with extracted text
  console.log('\nStep 3: Loading PDF attachments...');
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, extracted_text')
    .ilike('mime_type', '%pdf%')
    .not('extracted_text', 'is', null);

  const attachmentsByEmail = new Map<string, string[]>();
  for (const att of attachments || []) {
    if (att.extracted_text && att.extracted_text.length > 200) {
      const texts = attachmentsByEmail.get(att.email_id) || [];
      texts.push(att.extracted_text);
      attachmentsByEmail.set(att.email_id, texts);
    }
  }
  console.log(`  Emails with PDF text: ${attachmentsByEmail.size}`);

  // Track updated shipments
  const updatedShipmentIds = new Set<string>();

  // Step 4: Process emails
  console.log('\nStep 4: Processing emails...\n');

  for (const email of emails || []) {
    stats.emailsProcessed++;

    if (stats.emailsProcessed % 100 === 0) {
      console.log(`Progress: ${stats.emailsProcessed}/${emails?.length} | Matched: ${stats.emailsMatched} | Updated: ${stats.shipmentsUpdated}`);
    }

    const subject = email.subject || '';
    const body = email.body_text || '';

    // Combine email body with PDF attachment text
    let combinedContent = body;
    const pdfTexts = attachmentsByEmail.get(email.id) || [];
    for (const pdfText of pdfTexts) {
      combinedContent += '\n\n=== PDF ATTACHMENT ===\n' + pdfText;
    }

    if (combinedContent.length < 400) continue;

    // Extract booking candidates
    const candidates = extractBookingCandidates(subject + ' ' + combinedContent);
    if (candidates.length === 0) continue;

    // Find matching shipment
    let shipment: Shipment | undefined;
    let matchedOn = '';

    for (const candidate of candidates) {
      const found = shipmentLookup.get(candidate) || shipmentLookup.get(candidate.toUpperCase());
      if (found) {
        shipment = found;
        matchedOn = candidate;
        break;
      }
    }

    if (!shipment) continue;
    stats.emailsMatched++;

    // Skip if already updated in this run
    if (updatedShipmentIds.has(shipment.id)) continue;

    // Check if shipment still needs cutoffs
    if (shipment.si_cutoff && shipment.vgm_cutoff && shipment.cargo_cutoff) {
      continue;
    }

    // Extract with AI
    const extracted = await extractWithAI(combinedContent);
    if (!extracted) continue;

    // Build updates
    const updates: Record<string, any> = {};
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
      updates.etd = extracted.etd;
      stats.cutoffs.etd++;
    }
    if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
      updates.eta = extracted.eta;
      stats.cutoffs.eta++;
    }
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
    if (!shipment.vessel_name && extracted.vessel_name) {
      updates.vessel_name = extracted.vessel_name;
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        stats.shipmentsUpdated++;
        updatedShipmentIds.add(shipment.id);

        // Update local copy for next iteration
        Object.assign(shipment, updates);

        const cutoffFields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff']
          .filter(f => updates[f])
          .map(f => f.replace('_cutoff', '').toUpperCase());

        if (cutoffFields.length > 0) {
          console.log(`  [${matchedOn}] Added: ${cutoffFields.join(', ')}`);
        }
      }
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 150));
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                        PROCESSING SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Shipments needing cutoffs: ${stats.shipmentsNeedingCutoffs}`);
  console.log(`Emails processed:          ${stats.emailsProcessed}`);
  console.log(`Emails matched:            ${stats.emailsMatched}`);
  console.log(`Shipments updated:         ${stats.shipmentsUpdated}`);
  console.log(`\nNew cutoffs added:`);
  console.log(`  SI:    ${stats.cutoffs.si}`);
  console.log(`  VGM:   ${stats.cutoffs.vgm}`);
  console.log(`  Cargo: ${stats.cutoffs.cargo}`);
  console.log(`  Gate:  ${stats.cutoffs.gate}`);
  console.log(`  ETD:   ${stats.cutoffs.etd}`);
  console.log(`  ETA:   ${stats.cutoffs.eta}`);

  // Final coverage
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                      FINAL COVERAGE REPORT                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const { data: final } = await supabase.from('shipments').select('*');
  const total = final?.length || 0;

  for (const field of ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'etd', 'eta']) {
    const count = final?.filter((s: any) => s[field]).length || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`${field.padEnd(15)} ${bar} ${count}/${total} (${pct}%)`);
  }

  const hasAnyCutoff = final?.filter((s: any) => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff).length || 0;
  const hasAllCutoffs = final?.filter((s: any) => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length || 0;

  console.log(`\nHas any cutoff:  ${hasAnyCutoff}/${total} (${Math.round(hasAnyCutoff / total * 100)}%)`);
  console.log(`Has all cutoffs: ${hasAllCutoffs}/${total} (${Math.round(hasAllCutoffs / total * 100)}%)`);

  // Show remaining gaps by carrier
  console.log('\n=== REMAINING GAPS BY CARRIER ===');
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierNames = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  const remaining = final?.filter((s: any) => !s.si_cutoff || !s.vgm_cutoff || !s.cargo_cutoff) || [];
  const byCarrier = new Map<string, number>();

  for (const s of remaining) {
    const carrier = carrierNames.get(s.carrier_id) || 'Unknown';
    byCarrier.set(carrier, (byCarrier.get(carrier) || 0) + 1);
  }

  for (const [carrier, count] of [...byCarrier.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${carrier}: ${count} shipments still need cutoffs`);
  }
}

main().catch(error => {
  console.error('CRITICAL ERROR:', error);
  process.exit(1);
});
