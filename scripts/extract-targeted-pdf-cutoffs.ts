#!/usr/bin/env npx tsx
/**
 * Targeted PDF Cutoff Extraction
 *
 * Specifically targets shipments that:
 * 1. Have booking confirmation emails
 * 2. But are still missing cutoffs
 * 3. And have PDF attachments we can extract from
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

const EXTRACTION_PROMPT = `Extract ALL shipping cutoff dates and booking information from this PDF document.

SEARCH THE ENTIRE DOCUMENT CAREFULLY for these fields:

CUTOFF DATES (CRITICAL - look for these exact labels):
- "FCL delivery cut-off", "Cargo cut-off", "CY cut-off", "CY Closing", "Container Yard Cut-off" → cargo_cutoff
- "SI closing", "Shipping Instruction closing", "Documentation deadline", "SI Cut-off", "SI-Cutoff" → si_cutoff
- "VGM cut-off", "VGM deadline", "VGM submission deadline" → vgm_cutoff
- "Gate cut-off", "Gate closing" → gate_cutoff

ALSO EXTRACT:
- booking_number: Carrier booking reference (8+ digits, or prefixed like COSU*, MAEU*, HL-*, CEI*, AMC*)
- etd: Estimated departure date
- eta: Estimated arrival date
- vessel_name: Ship name

DATE FORMATS TO RECOGNIZE:
- "25-Dec-2025 10:00" → 2025-12-25
- "25/12/2025" → 2025-12-25
- "Dec 25, 2025" → 2025-12-25

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

PDF CONTENT:
`;

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

function convertToISODate(dateStr: string): string | null {
  if (!dateStr || dateStr === 'null') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  // DD-MMM-YYYY or DD/MMM/YYYY
  const dmmyMatch = dateStr.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
  if (dmmyMatch) {
    const day = dmmyMatch[1].padStart(2, '0');
    const month = monthMap[dmmyMatch[2].toLowerCase()];
    if (month) return `${dmmyMatch[3]}-${month}-${day}`;
  }

  // MMM DD, YYYY
  const mdyMatch = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})/);
  if (mdyMatch) {
    const month = monthMap[mdyMatch[1].toLowerCase()];
    const day = mdyMatch[2].padStart(2, '0');
    if (month) return `${mdyMatch[3]}-${month}-${day}`;
  }

  // DD/MM/YYYY
  const ddmmMatch = dateStr.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (ddmmMatch) {
    const [, day, month, year] = ddmmMatch;
    if (parseInt(month) <= 12) return `${year}-${month}-${day}`;
  }

  return null;
}

async function extractWithAI(content: string): Promise<ExtractedData | null> {
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
    console.log('  AI error:', error.message?.substring(0, 60));
    return null;
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║       TARGETED PDF EXTRACTION FOR MISSING CUTOFFS                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Get shipments missing cutoffs
  const { data: missingShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, etd, eta, vessel_name')
    .is('si_cutoff', null)
    .is('vgm_cutoff', null)
    .is('cargo_cutoff', null);

  console.log('Shipments missing ALL cutoffs:', missingShipments?.length);

  // Build lookup map
  const shipmentByBooking = new Map<string, any>();
  missingShipments?.forEach(s => {
    if (s.booking_number) {
      shipmentByBooking.set(s.booking_number, s);
      shipmentByBooking.set(s.booking_number.toUpperCase(), s);
      const numOnly = s.booking_number.replace(/\D/g, '');
      if (numOnly.length >= 6) shipmentByBooking.set(numOnly, s);
    }
    if (s.bl_number) {
      shipmentByBooking.set(s.bl_number, s);
    }
  });

  // Step 2: Get all PDF attachments with extracted text
  const { data: pdfAttachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, extracted_text')
    .ilike('mime_type', '%pdf%')
    .not('extracted_text', 'is', null)
    .order('created_at', { ascending: false });

  console.log('PDF attachments with text:', pdfAttachments?.length);

  // Get email subjects for matching
  const emailIds = [...new Set(pdfAttachments?.map(p => p.email_id) || [])];
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .in('id', emailIds);

  const emailSubjects = new Map<string, string>();
  emails?.forEach(e => emailSubjects.set(e.id, e.subject || ''));

  const stats = {
    processed: 0,
    matched: 0,
    extracted: 0,
    updated: 0,
    cutoffs: { si: 0, vgm: 0, cargo: 0, gate: 0, etd: 0, eta: 0 }
  };

  // Step 3: Process each PDF
  for (const pdf of pdfAttachments || []) {
    stats.processed++;

    if (stats.processed % 100 === 0) {
      console.log(`Progress: ${stats.processed}/${pdfAttachments?.length} | Matched: ${stats.matched} | Updated: ${stats.updated}`);
    }

    const text = pdf.extracted_text || '';
    if (text.length < 100) continue;

    // Try to find booking number in PDF or subject
    const subject = emailSubjects.get(pdf.email_id) || '';
    const filename = pdf.filename || '';

    // Extract potential booking numbers
    const bookingMatches: string[] = [];

    // From subject
    const subjectMatch = subject.match(/\b(\d{8,})\b/g) ||
                         subject.match(/hl-?(\d{8})/gi) ||
                         subject.match(/COSU(\d+)/gi) ||
                         subject.match(/MAEU(\d+)/gi) ||
                         subject.match(/AMC(\d+)/gi) ||
                         subject.match(/CEI(\d+)/gi) || [];
    bookingMatches.push(...subjectMatch);

    // From filename
    const filenameMatch = filename.match(/\b(\d{8,})\b/g) || [];
    bookingMatches.push(...filenameMatch);

    // From PDF text (first 2000 chars)
    const textMatch = text.substring(0, 2000).match(/booking[:\s#]*(\d{8,})/gi) ||
                      text.substring(0, 2000).match(/\b(\d{9,12})\b/g) || [];
    bookingMatches.push(...textMatch.map(m => m.replace(/\D/g, '')));

    // Find matching shipment
    let shipment = null;
    let matchedBooking = '';

    for (const match of bookingMatches) {
      const cleanMatch = match.replace(/^(HL-?|COSU|MAEU|AMC|CEI)/i, '').replace(/\D/g, '');
      shipment = shipmentByBooking.get(match) ||
                 shipmentByBooking.get(cleanMatch) ||
                 shipmentByBooking.get(match.toUpperCase());
      if (shipment) {
        matchedBooking = shipment.booking_number;
        break;
      }
    }

    if (!shipment) continue;
    stats.matched++;

    // Check if PDF has cutoff keywords
    const textLower = text.toLowerCase();
    const hasCutoffKeywords = textLower.includes('cut-off') ||
                              textLower.includes('cutoff') ||
                              textLower.includes('closing') ||
                              textLower.includes('deadline');

    if (!hasCutoffKeywords) continue;

    // Extract with AI
    const extracted = await extractWithAI(text);
    if (!extracted) continue;
    stats.extracted++;

    // Build updates - only for fields that are null in shipment
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
        const cutoffFields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff']
          .filter(f => updates[f])
          .map(f => f.replace('_cutoff', '').toUpperCase());

        if (cutoffFields.length > 0) {
          console.log(`  [${matchedBooking}] Added: ${cutoffFields.join(', ')}`);
        }

        // Remove from lookup map so we don't process again
        shipmentByBooking.delete(matchedBooking);
      }
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  // Final report
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                        PROCESSING SUMMARY                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log('PDFs processed:', stats.processed);
  console.log('Matched to missing shipments:', stats.matched);
  console.log('Successfully extracted:', stats.extracted);
  console.log('Shipments updated:', stats.updated);
  console.log('\nNew cutoffs added:');
  console.log('  SI:', stats.cutoffs.si);
  console.log('  VGM:', stats.cutoffs.vgm);
  console.log('  Cargo:', stats.cutoffs.cargo);
  console.log('  Gate:', stats.cutoffs.gate);
  console.log('  ETD:', stats.cutoffs.etd);
  console.log('  ETA:', stats.cutoffs.eta);

  // Final coverage
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                      FINAL COVERAGE REPORT                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const { data: final } = await supabase.from('shipments').select('*');
  const total = final?.length || 0;

  const fields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'etd', 'eta'];
  for (const field of fields) {
    const count = final?.filter(s => (s as any)[field]).length || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`${field.padEnd(15)} ${bar} ${pct}% (${count}/${total})`);
  }

  const hasAnyCutoff = final?.filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff).length || 0;
  const hasAllCutoffs = final?.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff).length || 0;
  console.log(`\nHas any cutoff:  ${hasAnyCutoff}/${total} (${Math.round(hasAnyCutoff/total*100)}%)`);
  console.log(`Has all cutoffs: ${hasAllCutoffs}/${total} (${Math.round(hasAllCutoffs/total*100)}%)`);
}

main().catch(console.error);
