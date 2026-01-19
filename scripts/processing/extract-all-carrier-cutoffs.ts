#!/usr/bin/env npx tsx
/**
 * Extract Cutoffs from ALL Carriers
 *
 * Each carrier has different date formats and field labels:
 * - Hapag-Lloyd: "FCL delivery cut-off", "SI closing", DD-MMM-YYYY
 * - Maersk: "CY Cut-off", "SI Cut-off", DD/MM/YYYY or YYYY-MM-DD
 * - CMA CGM: "Cargo Closing", "SI Closing", DD/MM/YYYY
 * - COSCO: "Cut-off Date", various formats
 * - MSC: "Closing Date", DD/MM/YYYY
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

// Carrier-specific extraction prompts
const CARRIER_PROMPTS: Record<string, string> = {
  'hapag-lloyd': `HAPAG-LLOYD BOOKING CONFIRMATION

Look for these EXACT labels:
- "FCL delivery cut-off" or "Cargo cut-off" → cargo_cutoff
- "Shipping instruction closing" or "SI closing" → si_cutoff
- "VGM cut-off" or "VGM submission deadline" → vgm_cutoff
- "Gate cut-off" → gate_cutoff
- "Documentation cut-off" → doc_cutoff
- "ETD" or "Estimated departure" → etd
- "ETA" or "Estimated arrival" → eta

Date format: DD-MMM-YYYY (e.g., 25-Dec-2025) or DD/MM/YYYY
Booking numbers: 8 digits or with HL prefix`,

  'maersk': `MAERSK BOOKING CONFIRMATION

Look for these EXACT labels:
- "CY Cut-off" or "Container Yard Cut-off" → cargo_cutoff
- "SI Cut-off" or "Shipping Instruction Cut-off" → si_cutoff
- "VGM Cut-off" or "VGM Deadline" → vgm_cutoff
- "Port Cut-off" or "Gate Cut-off" → gate_cutoff
- "Documentation Deadline" → doc_cutoff
- "ETD" or "Departure" → etd
- "ETA" or "Arrival" → eta

Date formats: DD/MM/YYYY or YYYY-MM-DD or DD-MMM-YYYY
Booking numbers: Start with numbers or MAEU prefix`,

  'cma-cgm': `CMA CGM BOOKING CONFIRMATION

Look for these EXACT labels:
- "Cargo Closing" or "CY Closing" → cargo_cutoff
- "SI Closing" or "Documentation Closing" → si_cutoff
- "VGM Closing" or "VGM Deadline" → vgm_cutoff
- "Gate Closing" → gate_cutoff
- "ETD" → etd
- "ETA" → eta

Date format: DD/MM/YYYY or DD-MMM-YYYY
Booking numbers: Various formats`,

  'cosco': `COSCO SHIPPING BOOKING CONFIRMATION

Look for these EXACT labels:
- "Cut-off Date" or "Cargo Cut-off" → cargo_cutoff
- "SI Cut-off" or "Doc Cut-off" → si_cutoff
- "VGM Cut-off" → vgm_cutoff
- "ETD" → etd
- "ETA" → eta

Booking numbers: Start with COSU
Date format: DD/MM/YYYY or YYYY-MM-DD`,

  'msc': `MSC (Mediterranean Shipping) BOOKING CONFIRMATION

Look for these EXACT labels:
- "Closing Date" or "Cut-off" → cargo_cutoff
- "SI Closing" → si_cutoff
- "VGM Closing" → vgm_cutoff
- "ETD" → etd
- "ETA" → eta

Date format: DD/MM/YYYY`,

  'default': `SHIPPING BOOKING CONFIRMATION

Look for any of these cutoff labels:
- Cargo/CY cut-off, FCL delivery → cargo_cutoff
- SI/Documentation closing/cut-off → si_cutoff
- VGM cut-off/deadline → vgm_cutoff
- Gate cut-off → gate_cutoff
- ETD/Departure → etd
- ETA/Arrival → eta

Convert all dates to YYYY-MM-DD format.`
};

const BASE_PROMPT = `{CARRIER_PROMPT}

Extract ALL dates from this booking document. Return ONLY valid JSON:

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
  "port_of_discharge": "string or null"
}

RULES:
1. Convert ALL dates to YYYY-MM-DD format
2. Use null for missing values (not "null" string)
3. Search the ENTIRE document for cutoff information
4. Cutoff dates are often in tables or deadline sections

DOCUMENT:
`;

function detectCarrier(subject: string, body: string, senderEmail: string): string {
  const text = `${subject} ${body} ${senderEmail}`.toLowerCase();

  if (text.includes('hapag') || text.includes('hlag') || text.includes('hlcu')) return 'hapag-lloyd';
  if (text.includes('maersk') || text.includes('maeu')) return 'maersk';
  if (text.includes('cma cgm') || text.includes('cma-cgm')) return 'cma-cgm';
  if (text.includes('cosco') || text.includes('cosu')) return 'cosco';
  if (text.includes('msc') || text.includes('mediterranean shipping')) return 'msc';
  if (text.includes('one') || text.includes('ocean network express')) return 'one';
  if (text.includes('evergreen') || text.includes('eglv')) return 'evergreen';

  return 'default';
}

function convertDateToISO(dateStr: string): string | null {
  if (!dateStr || dateStr === 'null') return null;

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  const monthMap: Record<string, string> = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };

  // DD-MMM-YYYY (25-Dec-2025)
  const dmmyMatch = dateStr.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
  if (dmmyMatch) {
    const day = dmmyMatch[1].padStart(2, '0');
    const month = monthMap[dmmyMatch[2].toLowerCase()];
    if (month) return `${dmmyMatch[3]}-${month}-${day}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyyMatch = dateStr.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (ddmmyyyyMatch) {
    const [, day, month, year] = ddmmyyyyMatch;
    // Validate it's a reasonable date
    if (parseInt(month) <= 12 && parseInt(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  // MM/DD/YYYY (American format) - check if month > 12, then it's DD/MM
  const mdyMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) {
    let [, first, second, year] = mdyMatch;
    if (parseInt(first) > 12) {
      // First is day, second is month
      return `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`;
    } else {
      // Assume MM/DD/YYYY
      return `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`;
    }
  }

  return null;
}

async function extractWithAI(content: string, carrier: string): Promise<any> {
  const carrierPrompt = CARRIER_PROMPTS[carrier] || CARRIER_PROMPTS['default'];
  const prompt = BASE_PROMPT.replace('{CARRIER_PROMPT}', carrierPrompt) + content.substring(0, 10000);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Clean and convert dates
      for (const key of Object.keys(parsed)) {
        if (parsed[key] === 'null' || parsed[key] === '' || parsed[key] === 'N/A') {
          parsed[key] = null;
        } else if (key.includes('cutoff') || key === 'etd' || key === 'eta') {
          parsed[key] = convertDateToISO(parsed[key]);
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
  console.log('=== MULTI-CARRIER CUTOFF EXTRACTION ===\n');

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
    if (name.includes('msc')) carrierIdMap.set('msc', c.id);
  });

  // Get booking confirmation emails
  const { data: bookingClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bookingIds = bookingClassifications?.map(c => c.email_id) || [];
  console.log('Booking confirmation emails:', bookingIds.length);

  // Get emails with content
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email')
    .in('id', bookingIds);

  // Get shipments for matching
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .or('si_cutoff.is.null,vgm_cutoff.is.null,cargo_cutoff.is.null,etd.is.null,eta.is.null');

  console.log('Shipments needing cutoffs:', shipments?.length);

  const shipmentByBooking = new Map<string, any>();
  shipments?.forEach(s => {
    if (s.booking_number) {
      shipmentByBooking.set(s.booking_number, s);
      // Also by number without prefix
      const numOnly = s.booking_number.replace(/\D/g, '');
      if (numOnly.length >= 6) {
        shipmentByBooking.set(numOnly, s);
      }
    }
  });

  // Get PDF attachments for content
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, extracted_text')
    .in('email_id', bookingIds)
    .not('extracted_text', 'is', null);

  const attachmentsByEmail = new Map<string, string[]>();
  attachments?.forEach(a => {
    if (!attachmentsByEmail.has(a.email_id)) {
      attachmentsByEmail.set(a.email_id, []);
    }
    attachmentsByEmail.get(a.email_id)?.push(a.extracted_text);
  });

  console.log('Emails with PDF text:', attachmentsByEmail.size);

  // Stats by carrier
  const stats: Record<string, { processed: number; updated: number; cutoffs: number }> = {};

  // Process emails
  let processed = 0;
  const toProcess = emails?.slice(0, 200) || [];

  for (const email of toProcess) {
    processed++;

    if (processed % 30 === 0) {
      console.log(`\nProgress: ${processed}/${toProcess.length}`);
    }

    // Build full content
    const pdfTexts = attachmentsByEmail.get(email.id) || [];
    let content = `Subject: ${email.subject}\n\n${email.body_text || ''}`;
    for (const pdfText of pdfTexts) {
      content += `\n\n--- PDF ATTACHMENT ---\n${pdfText}`;
    }

    if (content.length < 200) continue;

    // Detect carrier
    const carrier = detectCarrier(email.subject, email.body_text || '', email.sender_email);

    if (!stats[carrier]) {
      stats[carrier] = { processed: 0, updated: 0, cutoffs: 0 };
    }
    stats[carrier].processed++;

    // Extract booking number from subject/body
    const bookingPatterns = [
      /\b(\d{8,})\b/,
      /COSU(\d+)/i,
      /MAEU(\d+)/i,
      /HL-?(\d{8})/i,
      /booking[:\s#]*(\d{6,})/i,
    ];

    let bookingNumber: string | null = null;
    for (const pattern of bookingPatterns) {
      const match = (email.subject + ' ' + content).match(pattern);
      if (match) {
        bookingNumber = match[1] || match[0];
        break;
      }
    }

    if (!bookingNumber) continue;

    const shipment = shipmentByBooking.get(bookingNumber) ||
                     shipmentByBooking.get(bookingNumber.replace(/\D/g, ''));
    if (!shipment) continue;

    // Extract with AI
    const extracted = await extractWithAI(content, carrier);
    if (!extracted) continue;

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
      stats[carrier].cutoffs++;
    }
    if (!shipment.vgm_cutoff && extracted.vgm_cutoff && dateRegex.test(extracted.vgm_cutoff)) {
      updates.vgm_cutoff = extracted.vgm_cutoff;
      stats[carrier].cutoffs++;
    }
    if (!shipment.cargo_cutoff && extracted.cargo_cutoff && dateRegex.test(extracted.cargo_cutoff)) {
      updates.cargo_cutoff = extracted.cargo_cutoff;
      stats[carrier].cutoffs++;
    }
    if (!shipment.gate_cutoff && extracted.gate_cutoff && dateRegex.test(extracted.gate_cutoff)) {
      updates.gate_cutoff = extracted.gate_cutoff;
    }

    // Carrier ID
    const carrierId = carrierIdMap.get(carrier);
    if (!shipment.carrier_id && carrierId) {
      updates.carrier_id = carrierId;
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

    // Update shipment
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        stats[carrier].updated++;
        const cutoffFields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff'].filter(f => updates[f]);
        if (cutoffFields.length > 0) {
          console.log(`  [${carrier}] ${bookingNumber}: +${cutoffFields.join(',')}`);
        }
      }
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 150));
  }

  console.log('\n\n=== RESULTS BY CARRIER ===');
  for (const [carrier, s] of Object.entries(stats)) {
    console.log(`${carrier}: processed=${s.processed}, updated=${s.updated}, cutoffs=${s.cutoffs}`);
  }

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
