#!/usr/bin/env npx tsx
/**
 * Aggressive Cutoff Extraction Script
 *
 * Processes ALL emails with cutoff keywords or PDF content, not just booking confirmations.
 * This extracts cutoff data from:
 * - Booking confirmations
 * - Booking amendments
 * - Arrival notices
 * - Any email with embedded PDF content containing cutoff dates
 *
 * Follows project principles:
 * - Deep modules with simple interfaces
 * - Idempotent operations
 * - Fail fast on critical errors
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

// Environment validation
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

interface Stats {
  emailsProcessed: number;
  emailsMatched: number;
  shipmentsUpdated: number;
  cutoffs: { si: number; vgm: number; cargo: number; gate: number; etd: number; eta: number };
}

// ============================================================================
// Extraction Prompt
// ============================================================================

const EXTRACTION_PROMPT = `Extract shipping cutoff dates from this document. Be THOROUGH and search the ENTIRE document.

LOOK FOR THESE SPECIFIC CUTOFF DATES:
1. SI Cutoff: "SI closing", "Shipping Instruction closing", "Documentation deadline", "SI Cut-off", "SI-Cutoff"
2. VGM Cutoff: "VGM cut-off", "VGM deadline", "VGM submission deadline", "VGM Cutoff"
3. Cargo Cutoff: "FCL delivery cut-off", "Cargo cut-off", "CY cut-off", "CY Closing", "Container Yard Cutoff", "Cargo Cutoff"
4. Gate Cutoff: "Gate cut-off", "Gate closing"

Also extract:
- Booking number (8+ digits, or with prefix like COSU, MAEU, HL-, HLCU)
- ETD (departure date, "Estimated Departure", "Sailing Date")
- ETA (arrival date, "Estimated Arrival")
- Vessel name

IMPORTANT DATE FORMATS TO RECOGNIZE:
- "25-Dec-2025 10:00" or "25-Dec-2025"
- "25/12/2025" or "2025-12-25"
- Dates may appear as "DD-Mon-YYYY HH:MM (Local)"

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

  // DD/MM/YYYY
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

function extractBookingCandidates(subject: string, body: string): string[] {
  const candidates: string[] = [];

  // HL-XXXXXXXX (Hapag-Lloyd)
  const hlMatches = [...subject.matchAll(/HL-?(\d{8})/gi), ...body.matchAll(/HL-?(\d{8})/gi)];
  for (const m of hlMatches) {
    candidates.push(m[1]);
    candidates.push('HL-' + m[1]);
  }

  // Our Reference in body
  const ourRefMatch = body.match(/Our Reference[:\s]+(\d{8,})/i);
  if (ourRefMatch) candidates.push(ourRefMatch[1]);

  // 8-10 digit numbers in subject
  const numMatches = [...subject.matchAll(/\b(\d{8,10})\b/g)];
  for (const m of numMatches) candidates.push(m[1]);

  // COSU (COSCO)
  const cosuMatches = [...subject.matchAll(/COSU(\d+)/gi)];
  for (const m of cosuMatches) candidates.push('COSU' + m[1]);

  // CEI/AMC (CMA CGM)
  const cmaMatches = [...subject.matchAll(/(CEI\d+|AMC\d+)/gi)];
  for (const m of cmaMatches) candidates.push(m[1].toUpperCase());

  // 9-digit Maersk (26XXXXXXX)
  const maerskMatches = [...subject.matchAll(/\b(26\d{7})\b/g)];
  for (const m of maerskMatches) candidates.push(m[1]);

  return [...new Set(candidates)];
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
      if (parsed.booking_number === 'null' || parsed.booking_number === '') {
        parsed.booking_number = null;
      }
      if (parsed.vessel_name === 'null' || parsed.vessel_name === '') {
        parsed.vessel_name = null;
      }

      return parsed as ExtractedData;
    }
  } catch (error: any) {
    console.error(`  AI error: ${error.message}`);
  }

  return null;
}

// ============================================================================
// Main Processing
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║       AGGRESSIVE CUTOFF EXTRACTION (ALL EMAIL TYPES)               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const stats: Stats = {
    emailsProcessed: 0,
    emailsMatched: 0,
    shipmentsUpdated: 0,
    cutoffs: { si: 0, vgm: 0, cargo: 0, gate: 0, etd: 0, eta: 0 },
  };

  // Load shipments that need cutoffs
  console.log('Loading shipments needing cutoffs...');
  const { data: allShipments } = await supabase.from('shipments').select('*');

  const shipmentsNeedingCutoffs = allShipments?.filter(s =>
    s.si_cutoff === null || s.vgm_cutoff === null || s.cargo_cutoff === null
  ) || [];

  console.log(`Total shipments: ${allShipments?.length}`);
  console.log(`Shipments needing cutoffs: ${shipmentsNeedingCutoffs.length}`);

  // Build shipment lookup map
  const shipmentLookup = new Map<string, Shipment>();
  for (const s of shipmentsNeedingCutoffs) {
    if (s.booking_number) {
      shipmentLookup.set(s.booking_number, s);
      shipmentLookup.set(s.booking_number.toUpperCase(), s);

      // Normalized (digits only)
      const numOnly = s.booking_number.replace(/\D/g, '');
      if (numOnly.length >= 8) {
        shipmentLookup.set(numOnly, s);
      }

      // HL- variations
      if (s.booking_number.startsWith('HL-')) {
        shipmentLookup.set(s.booking_number.substring(3), s);
      } else if (/^\d{8}$/.test(s.booking_number)) {
        shipmentLookup.set('HL-' + s.booking_number, s);
      }
    }
    if (s.bl_number) {
      shipmentLookup.set(s.bl_number, s);
      shipmentLookup.set(s.bl_number.toUpperCase(), s);
    }
  }

  console.log(`Lookup map entries: ${shipmentLookup.size}`);

  // Load all emails with cutoff keywords or PDF content
  console.log('\nLoading emails with cutoff/PDF content...');
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .or('body_text.ilike.%=== %.pdf ===%,body_text.ilike.%cut-off%,body_text.ilike.%cutoff%,body_text.ilike.%deadline%,body_text.ilike.%SI closing%,body_text.ilike.%VGM%')
    .order('received_at', { ascending: false });

  console.log(`Found ${emails?.length} emails with cutoff/PDF content`);

  // Track updated shipments
  const updatedShipmentIds = new Set<string>();

  // Process emails
  console.log('\nProcessing emails...\n');

  for (const email of emails || []) {
    stats.emailsProcessed++;

    if (stats.emailsProcessed % 50 === 0) {
      console.log(`Progress: ${stats.emailsProcessed}/${emails?.length} | Matched: ${stats.emailsMatched} | Updated: ${stats.shipmentsUpdated}`);
    }

    const subject = email.subject || '';
    const body = email.body_text || '';

    // Extract booking candidates
    const candidates = extractBookingCandidates(subject, body);
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

    // Skip if already updated
    if (updatedShipmentIds.has(shipment.id)) continue;

    // Check if shipment still needs cutoffs
    if (shipment.si_cutoff && shipment.vgm_cutoff && shipment.cargo_cutoff) {
      continue;
    }

    // Extract with AI
    const extracted = await extractWithAI(body);
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

  console.log(`Emails processed:    ${stats.emailsProcessed}`);
  console.log(`Emails matched:      ${stats.emailsMatched} (${Math.round(stats.emailsMatched / stats.emailsProcessed * 100)}%)`);
  console.log(`Shipments updated:   ${stats.shipmentsUpdated}`);
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

  const hasAnyCutoff = final?.filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff).length || 0;
  const hasAllCutoffs = final?.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length || 0;

  console.log(`\nHas any cutoff:  ${hasAnyCutoff}/${total} (${Math.round(hasAnyCutoff / total * 100)}%)`);
  console.log(`Has all cutoffs: ${hasAllCutoffs}/${total} (${Math.round(hasAllCutoffs / total * 100)}%)`);
}

main().catch(error => {
  console.error('CRITICAL ERROR:', error);
  process.exit(1);
});
