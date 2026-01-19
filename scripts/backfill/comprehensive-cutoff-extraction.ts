#!/usr/bin/env npx tsx
/**
 * Comprehensive Cutoff Extraction Script
 *
 * This script:
 * 1. Links booking confirmation emails to shipments using improved matching
 * 2. Extracts SI, VGM, Cargo cutoffs from matched emails using AI
 * 3. Updates shipments with extracted cutoff data
 *
 * Follows project principles:
 * - Interface-based design
 * - Deep modules with simple interfaces
 * - Fail fast on critical errors
 * - Idempotent operations
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

// Environment validation (fail fast)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase environment variables');
}
if (!anthropicKey) {
  throw new Error('Missing ANTHROPIC_API_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });

// ============================================================================
// Types and Interfaces
// ============================================================================

interface Email {
  id: string;
  subject: string | null;
  body_text: string | null;
  sender_email: string | null;
}

interface Shipment {
  id: string;
  booking_number: string | null;
  bl_number: string | null;
  carrier_id: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  etd: string | null;
  eta: string | null;
  vessel_name: string | null;
}

interface ExtractedCutoffs {
  booking_number: string | null;
  etd: string | null;
  eta: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  vessel_name: string | null;
}

interface MatchResult {
  email: Email;
  shipment: Shipment;
  matchedOn: string;
}

interface ProcessingStats {
  emailsProcessed: number;
  emailsMatched: number;
  extractionsAttempted: number;
  extractionsSuccessful: number;
  shipmentsUpdated: number;
  newCutoffs: {
    si: number;
    vgm: number;
    cargo: number;
    gate: number;
    etd: number;
    eta: number;
  };
  errors: string[];
}

// ============================================================================
// Booking Number Matching Service
// ============================================================================

class BookingNumberMatcher {
  private shipmentLookup: Map<string, Shipment> = new Map();

  constructor(shipments: Shipment[]) {
    this.buildLookupMap(shipments);
  }

  private buildLookupMap(shipments: Shipment[]): void {
    for (const shipment of shipments) {
      if (shipment.booking_number) {
        const bn = shipment.booking_number;

        // Exact match
        this.shipmentLookup.set(bn, shipment);
        this.shipmentLookup.set(bn.toUpperCase(), shipment);
        this.shipmentLookup.set(bn.toLowerCase(), shipment);

        // Normalized (digits only for 8+ digit numbers)
        const numOnly = bn.replace(/\D/g, '');
        if (numOnly.length >= 8) {
          this.shipmentLookup.set(numOnly, shipment);
        }

        // Handle HL- prefix variations (Hapag-Lloyd)
        if (bn.startsWith('HL-')) {
          this.shipmentLookup.set(bn.substring(3), shipment);
        } else if (/^\d{8}$/.test(bn)) {
          // Add HL- version for 8-digit numbers
          this.shipmentLookup.set('HL-' + bn, shipment);
        }

        // Handle COSU prefix (COSCO)
        if (bn.startsWith('COSU')) {
          this.shipmentLookup.set(bn.substring(4), shipment);
        }
      }

      // Also index by BL number
      if (shipment.bl_number) {
        this.shipmentLookup.set(shipment.bl_number, shipment);
        this.shipmentLookup.set(shipment.bl_number.toUpperCase(), shipment);
      }
    }

    console.log(`Built lookup map with ${this.shipmentLookup.size} entries`);
  }

  extractCandidates(email: Email): string[] {
    const candidates: string[] = [];
    const subject = email.subject || '';
    const body = email.body_text || '';

    // HL-XXXXXXXX pattern (Hapag-Lloyd)
    const hlMatches = [...subject.matchAll(/HL-?(\d{8})/gi)];
    for (const match of hlMatches) {
      candidates.push(match[1]); // Without HL-
      candidates.push('HL-' + match[1]); // With HL-
    }

    // COSU pattern (COSCO)
    const cosuMatches = [...subject.matchAll(/COSU(\d+)/gi)];
    for (const match of cosuMatches) {
      candidates.push('COSU' + match[1]);
      candidates.push(match[1]);
    }

    // MAEU pattern (Maersk)
    const maeuMatches = [...subject.matchAll(/MAEU(\d+)/gi)];
    for (const match of maeuMatches) {
      candidates.push('MAEU' + match[1]);
    }

    // CEI/AMC pattern (CMA CGM)
    const cmaMatches = [...subject.matchAll(/(CEI\d+|AMC\d+)/gi)];
    for (const match of cmaMatches) {
      candidates.push(match[1].toUpperCase());
    }

    // 8-10 digit numbers in subject (generic booking numbers)
    const numMatches = [...subject.matchAll(/\b(\d{8,10})\b/g)];
    for (const match of numMatches) {
      candidates.push(match[1]);
    }

    // 9 digit Maersk-style (26XXXXXXX)
    const maerskStyleMatches = [...subject.matchAll(/\b(26\d{7})\b/g)];
    for (const match of maerskStyleMatches) {
      candidates.push(match[1]);
    }

    // Extract from body: "Our Reference:" field
    const ourRefMatch = body.match(/Our Reference[:\s]+(\d{8,})/i);
    if (ourRefMatch) {
      candidates.push(ourRefMatch[1]);
    }

    // Extract from body: "Booking" or "BKG NO" patterns
    const bkgMatches = [...body.matchAll(/(?:booking|bkg)\s*(?:no\.?|number|#)?[:\s]*([A-Z0-9\-]{6,20})/gi)];
    for (const match of bkgMatches) {
      candidates.push(match[1].replace(/[:\s]/g, ''));
    }

    return [...new Set(candidates)]; // Deduplicate
  }

  findShipment(candidates: string[]): { shipment: Shipment; matchedOn: string } | null {
    for (const candidate of candidates) {
      const shipment = this.shipmentLookup.get(candidate) ||
                       this.shipmentLookup.get(candidate.toUpperCase());
      if (shipment) {
        return { shipment, matchedOn: candidate };
      }
    }
    return null;
  }
}

// ============================================================================
// Cutoff Extraction Service (AI-powered)
// ============================================================================

class CutoffExtractor {
  private static readonly EXTRACTION_PROMPT = `Extract shipping cutoff dates and booking information from this document.

LOOK FOR THESE SPECIFIC FIELDS:
1. Booking number (8+ digits, or with carrier prefix like COSU, MAEU, HL-)
2. Cutoff dates:
   - "FCL delivery cut-off", "Cargo cut-off", "CY cut-off", "CY Closing" → cargo_cutoff
   - "SI closing", "Shipping instruction", "Documentation deadline", "SI Cut-off" → si_cutoff
   - "VGM cut-off", "VGM deadline", "VGM submission" → vgm_cutoff
   - "Gate cut-off" → gate_cutoff
3. ETD (departure date)
4. ETA (arrival date)
5. Vessel name

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

RULES:
1. Convert dates like "25-Dec-2025", "25/12/2025", "25-Dec-2025 10:00" to YYYY-MM-DD format
2. Use null for missing values
3. Search the ENTIRE document thoroughly
4. If date has time component, extract just the date

DOCUMENT:
`;

  async extract(content: string): Promise<ExtractedCutoffs | null> {
    if (content.length < 200) {
      return null;
    }

    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: CutoffExtractor.EXTRACTION_PROMPT + content.substring(0, 15000)
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.normalizeExtractedData(parsed);
      }

      return null;
    } catch (error: any) {
      console.error(`  AI extraction error: ${error.message}`);
      return null;
    }
  }

  private normalizeExtractedData(data: any): ExtractedCutoffs {
    const dateFields = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];

    for (const field of dateFields) {
      if (data[field] === 'null' || data[field] === '') {
        data[field] = null;
      } else if (data[field]) {
        data[field] = this.convertToISODate(data[field]);
      }
    }

    // Clean null string values
    if (data.booking_number === 'null' || data.booking_number === '') {
      data.booking_number = null;
    }
    if (data.vessel_name === 'null' || data.vessel_name === '') {
      data.vessel_name = null;
    }

    return data as ExtractedCutoffs;
  }

  private convertToISODate(dateStr: string): string | null {
    if (!dateStr) return null;

    // Already in ISO format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

    const monthMap: Record<string, string> = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
      'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };

    // DD-MMM-YYYY or DD/MMM/YYYY (with optional time)
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
    const isoWithTime = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoWithTime) return isoWithTime[1];

    return null;
  }
}

// ============================================================================
// Shipment Update Service
// ============================================================================

class ShipmentUpdater {
  private static readonly DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  async update(
    shipment: Shipment,
    extracted: ExtractedCutoffs
  ): Promise<{ updated: boolean; fields: string[] }> {
    const updates: Record<string, any> = {};
    const updatedFields: string[] = [];

    // Only update fields that are null in shipment and valid in extraction
    if (!shipment.etd && extracted.etd && ShipmentUpdater.DATE_REGEX.test(extracted.etd)) {
      updates.etd = extracted.etd;
      updatedFields.push('etd');
    }

    if (!shipment.eta && extracted.eta && ShipmentUpdater.DATE_REGEX.test(extracted.eta)) {
      updates.eta = extracted.eta;
      updatedFields.push('eta');
    }

    if (!shipment.si_cutoff && extracted.si_cutoff && ShipmentUpdater.DATE_REGEX.test(extracted.si_cutoff)) {
      updates.si_cutoff = extracted.si_cutoff;
      updatedFields.push('si_cutoff');
    }

    if (!shipment.vgm_cutoff && extracted.vgm_cutoff && ShipmentUpdater.DATE_REGEX.test(extracted.vgm_cutoff)) {
      updates.vgm_cutoff = extracted.vgm_cutoff;
      updatedFields.push('vgm_cutoff');
    }

    if (!shipment.cargo_cutoff && extracted.cargo_cutoff && ShipmentUpdater.DATE_REGEX.test(extracted.cargo_cutoff)) {
      updates.cargo_cutoff = extracted.cargo_cutoff;
      updatedFields.push('cargo_cutoff');
    }

    if (!shipment.gate_cutoff && extracted.gate_cutoff && ShipmentUpdater.DATE_REGEX.test(extracted.gate_cutoff)) {
      updates.gate_cutoff = extracted.gate_cutoff;
      updatedFields.push('gate_cutoff');
    }

    if (!shipment.vessel_name && extracted.vessel_name) {
      updates.vessel_name = extracted.vessel_name;
      updatedFields.push('vessel_name');
    }

    if (Object.keys(updates).length === 0) {
      return { updated: false, fields: [] };
    }

    updates.updated_at = new Date().toISOString();

    const { error } = await supabase
      .from('shipments')
      .update(updates)
      .eq('id', shipment.id);

    if (error) {
      throw new Error(`Failed to update shipment ${shipment.id}: ${error.message}`);
    }

    return { updated: true, fields: updatedFields };
  }
}

// ============================================================================
// Main Processing Pipeline
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║       COMPREHENSIVE CUTOFF EXTRACTION PIPELINE                     ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const stats: ProcessingStats = {
    emailsProcessed: 0,
    emailsMatched: 0,
    extractionsAttempted: 0,
    extractionsSuccessful: 0,
    shipmentsUpdated: 0,
    newCutoffs: { si: 0, vgm: 0, cargo: 0, gate: 0, etd: 0, eta: 0 },
    errors: [],
  };

  // Step 1: Load all shipments
  console.log('Step 1: Loading shipments...');
  const { data: shipments, error: shipmentError } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, carrier_id, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, etd, eta, vessel_name');

  if (shipmentError || !shipments) {
    throw new Error(`Failed to load shipments: ${shipmentError?.message}`);
  }
  console.log(`  Loaded ${shipments.length} shipments`);

  // Step 2: Load booking confirmation emails
  console.log('\nStep 2: Loading booking confirmation emails...');
  const { data: bcClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bcEmailIds = bcClassifications?.map(c => c.email_id) || [];
  console.log(`  Found ${bcEmailIds.length} booking confirmation classifications`);

  const { data: emails, error: emailError } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email')
    .in('id', bcEmailIds);

  if (emailError || !emails) {
    throw new Error(`Failed to load emails: ${emailError?.message}`);
  }
  console.log(`  Loaded ${emails.length} booking confirmation emails`);

  // Step 3: Load PDF attachments for fallback content
  console.log('\nStep 3: Loading PDF attachments...');
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, extracted_text')
    .in('email_id', bcEmailIds)
    .ilike('mime_type', '%pdf%')
    .not('extracted_text', 'is', null);

  const attachmentsByEmail = new Map<string, string[]>();
  attachments?.forEach(att => {
    if (att.extracted_text) {
      const texts = attachmentsByEmail.get(att.email_id) || [];
      texts.push(att.extracted_text);
      attachmentsByEmail.set(att.email_id, texts);
    }
  });
  console.log(`  Loaded attachments for ${attachmentsByEmail.size} emails`);

  // Initialize services
  const matcher = new BookingNumberMatcher(shipments);
  const extractor = new CutoffExtractor();
  const updater = new ShipmentUpdater();

  // Step 4: Process emails
  console.log('\nStep 4: Processing emails...\n');

  // Track which shipments have been updated to avoid duplicate processing
  const processedShipmentIds = new Set<string>();

  for (const email of emails) {
    stats.emailsProcessed++;

    if (stats.emailsProcessed % 50 === 0) {
      console.log(`Progress: ${stats.emailsProcessed}/${emails.length} | Matched: ${stats.emailsMatched} | Updated: ${stats.shipmentsUpdated}`);
    }

    // Extract booking number candidates from email
    const candidates = matcher.extractCandidates(email);
    if (candidates.length === 0) {
      continue;
    }

    // Find matching shipment
    const match = matcher.findShipment(candidates);
    if (!match) {
      continue;
    }

    stats.emailsMatched++;
    const { shipment, matchedOn } = match;

    // Skip if this shipment already has all cutoffs or was already processed
    if (processedShipmentIds.has(shipment.id)) {
      continue;
    }

    const hasCutoffs = shipment.si_cutoff && shipment.vgm_cutoff && shipment.cargo_cutoff;
    if (hasCutoffs) {
      continue;
    }

    // Build content for extraction (email body + PDF attachments)
    let content = email.body_text || '';
    const pdfTexts = attachmentsByEmail.get(email.id) || [];
    for (const pdfText of pdfTexts) {
      content += '\n\n=== PDF CONTENT ===\n' + pdfText;
    }

    if (content.length < 300) {
      continue;
    }

    // Extract cutoffs using AI
    stats.extractionsAttempted++;
    const extracted = await extractor.extract(content);

    if (!extracted) {
      continue;
    }
    stats.extractionsSuccessful++;

    // Update shipment
    try {
      const result = await updater.update(shipment, extracted);

      if (result.updated) {
        stats.shipmentsUpdated++;
        processedShipmentIds.add(shipment.id);

        // Track which cutoffs were added
        for (const field of result.fields) {
          if (field === 'si_cutoff') stats.newCutoffs.si++;
          if (field === 'vgm_cutoff') stats.newCutoffs.vgm++;
          if (field === 'cargo_cutoff') stats.newCutoffs.cargo++;
          if (field === 'gate_cutoff') stats.newCutoffs.gate++;
          if (field === 'etd') stats.newCutoffs.etd++;
          if (field === 'eta') stats.newCutoffs.eta++;
        }

        const cutoffFields = result.fields.filter(f => f.includes('cutoff')).map(f => f.replace('_cutoff', '').toUpperCase());
        if (cutoffFields.length > 0) {
          console.log(`  [${matchedOn}] Added: ${cutoffFields.join(', ')}`);
        }
      }
    } catch (error: any) {
      stats.errors.push(`${shipment.booking_number}: ${error.message}`);
    }

    // Rate limiting for AI API
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  // Step 5: Print summary
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                        PROCESSING SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Emails processed:        ${stats.emailsProcessed}`);
  console.log(`Emails matched:          ${stats.emailsMatched} (${Math.round(stats.emailsMatched / stats.emailsProcessed * 100)}%)`);
  console.log(`Extractions attempted:   ${stats.extractionsAttempted}`);
  console.log(`Extractions successful:  ${stats.extractionsSuccessful}`);
  console.log(`Shipments updated:       ${stats.shipmentsUpdated}`);

  console.log('\nNew cutoffs added:');
  console.log(`  SI:    ${stats.newCutoffs.si}`);
  console.log(`  VGM:   ${stats.newCutoffs.vgm}`);
  console.log(`  Cargo: ${stats.newCutoffs.cargo}`);
  console.log(`  Gate:  ${stats.newCutoffs.gate}`);
  console.log(`  ETD:   ${stats.newCutoffs.etd}`);
  console.log(`  ETA:   ${stats.newCutoffs.eta}`);

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }

  // Step 6: Final coverage report
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                      FINAL COVERAGE REPORT                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const { data: finalShipments } = await supabase.from('shipments').select('*');
  const total = finalShipments?.length || 0;

  const coverageFields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'etd', 'eta'];
  for (const field of coverageFields) {
    const count = finalShipments?.filter(s => (s as any)[field]).length || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`${field.padEnd(15)} ${bar} ${count}/${total} (${pct}%)`);
  }

  // Calculate combined cutoff coverage (has at least one cutoff)
  const hasAnyCutoff = finalShipments?.filter(s =>
    s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff || s.gate_cutoff
  ).length || 0;
  const hasAllCutoffs = finalShipments?.filter(s =>
    s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff
  ).length || 0;

  console.log(`\nHas any cutoff:  ${hasAnyCutoff}/${total} (${Math.round(hasAnyCutoff / total * 100)}%)`);
  console.log(`Has all cutoffs: ${hasAllCutoffs}/${total} (${Math.round(hasAllCutoffs / total * 100)}%)`);
}

main().catch(error => {
  console.error('CRITICAL ERROR:', error);
  process.exit(1);
});
