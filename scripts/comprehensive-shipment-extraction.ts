#!/usr/bin/env npx tsx
/**
 * Comprehensive Shipment Data Extraction
 *
 * 1. Find ALL emails related to each shipment (by booking number)
 * 2. Prioritize carrier emails (hlag.com, maersk.com, etc.)
 * 3. Extract from PDF attachments
 * 4. Use AI to parse unstructured content
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });

// Carrier domains (prioritized for extraction)
const CARRIER_DOMAINS = ['hlag', 'hapag', 'maersk', 'cma-cgm', 'msc.com', 'cosco', 'one-line', 'evergreen', 'oocl'];

function isCarrierEmail(senderEmail: string): boolean {
  if (!senderEmail) return false;
  const lower = senderEmail.toLowerCase();
  return CARRIER_DOMAINS.some(d => lower.includes(d));
}

const EXTRACTION_PROMPT = `Extract ALL shipping information from this email/document. Return ONLY valid JSON:

{
  "carrier": "shipping line name",
  "booking_number": "booking reference",
  "vessel_name": "vessel/ship name",
  "voyage_number": "voyage number",
  "etd": "YYYY-MM-DD format or null",
  "eta": "YYYY-MM-DD format or null",
  "port_of_loading": "loading port name",
  "port_of_loading_code": "UN/LOCODE (5 chars)",
  "port_of_discharge": "discharge port name",
  "port_of_discharge_code": "UN/LOCODE (5 chars)",
  "final_destination": "final destination if different",
  "si_cutoff": "SI/doc cutoff YYYY-MM-DD or null",
  "vgm_cutoff": "VGM cutoff YYYY-MM-DD or null",
  "cargo_cutoff": "cargo/CY cutoff YYYY-MM-DD or null",
  "gate_cutoff": "gate cutoff YYYY-MM-DD or null",
  "doc_cutoff": "documentation cutoff YYYY-MM-DD or null",
  "container_number": "container number if available",
  "shipper_name": "shipper company",
  "consignee_name": "consignee company"
}

Look for dates in formats like: DD-MMM-YYYY, DD/MM/YYYY, YYYY-MM-DD
Convert all dates to YYYY-MM-DD format.

CONTENT:
`;

async function extractWithAI(content: string): Promise<any> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [{ role: 'user', content: EXTRACTION_PROMPT + content.substring(0, 6000) }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error: any) {
    return null;
  }
}

async function main() {
  console.log('=== COMPREHENSIVE SHIPMENT EXTRACTION ===\n');

  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierByName = new Map<string, string>();
  carriers?.forEach(c => {
    const lower = c.carrier_name.toLowerCase();
    carrierByName.set(lower, c.id);
    if (lower.includes('hapag')) carrierByName.set('hapag-lloyd', c.id);
    if (lower.includes('maersk')) carrierByName.set('maersk', c.id);
    if (lower.includes('cma')) carrierByName.set('cma cgm', c.id);
    if (lower.includes('cosco')) carrierByName.set('cosco', c.id);
    if (lower.includes('msc')) carrierByName.set('msc', c.id);
  });

  // Get shipments with incomplete data (missing ETD, ETA, or cutoffs)
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .or('etd.is.null,eta.is.null,si_cutoff.is.null,vgm_cutoff.is.null,cargo_cutoff.is.null');

  console.log('Shipments needing data:', shipments?.length);

  // Build booking number -> email mapping from entity extractions
  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number');

  const bookingToEmails = new Map<string, Set<string>>();
  bookingEntities?.forEach(e => {
    const bookings = e.entity_value.split(/[,&]/).map((b: string) => b.trim());
    bookings.forEach((booking: string) => {
      if (!bookingToEmails.has(booking)) {
        bookingToEmails.set(booking, new Set());
      }
      bookingToEmails.get(booking)?.add(e.email_id);
    });
  });

  console.log('Booking numbers mapped:', bookingToEmails.size);

  // Process shipments
  let processed = 0;
  let updated = 0;
  const stats: Record<string, number> = {};

  // Limit processing
  const toProcess = shipments?.slice(0, 100) || [];

  for (const shipment of toProcess) {
    processed++;
    if (processed % 10 === 0) {
      console.log(`\nProgress: ${processed}/${toProcess.length}`);
    }

    // Find all related emails
    const relatedEmailIds = new Set<string>();

    // Add emails from booking number mapping
    const emailsFromBooking = bookingToEmails.get(shipment.booking_number);
    if (emailsFromBooking) {
      emailsFromBooking.forEach(id => relatedEmailIds.add(id));
    }

    // Add the creation email
    if (shipment.created_from_email_id) {
      relatedEmailIds.add(shipment.created_from_email_id);
    }

    if (relatedEmailIds.size === 0) continue;

    // Fetch all related emails
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, sender_email, subject, body_text')
      .in('id', Array.from(relatedEmailIds));

    // Sort: carrier emails first
    const sortedEmails = (emails || []).sort((a, b) => {
      const aIsCarrier = isCarrierEmail(a.sender_email) ? 0 : 1;
      const bIsCarrier = isCarrierEmail(b.sender_email) ? 0 : 1;
      return aIsCarrier - bIsCarrier;
    });

    // Get PDF attachments for these emails
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('email_id, filename, extracted_text')
      .in('email_id', Array.from(relatedEmailIds))
      .ilike('filename', '%.pdf');

    // Combine content: prioritize carrier emails and PDFs
    let bestContent = '';

    // First try carrier emails
    for (const email of sortedEmails) {
      if (isCarrierEmail(email.sender_email)) {
        bestContent += `\n\n--- EMAIL FROM CARRIER ---\nSubject: ${email.subject}\n${email.body_text || ''}`;
      }
    }

    // Add PDF content
    for (const att of attachments || []) {
      if (att.extracted_text) {
        bestContent += `\n\n--- PDF: ${att.filename} ---\n${att.extracted_text.substring(0, 3000)}`;
      }
    }

    // If no carrier emails, use any email
    if (!bestContent) {
      for (const email of sortedEmails.slice(0, 2)) {
        bestContent += `\nSubject: ${email.subject}\n${email.body_text || ''}`;
      }
    }

    if (!bestContent || bestContent.length < 50) continue;

    // Extract with AI
    const extracted = await extractWithAI(bestContent);
    if (!extracted) continue;

    // Build updates (only missing fields)
    const updates: Record<string, any> = {};
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    // Carrier
    if (!shipment.carrier_id && extracted.carrier) {
      const carrierId = carrierByName.get(extracted.carrier.toLowerCase());
      if (carrierId) {
        updates.carrier_id = carrierId;
        stats.carrier = (stats.carrier || 0) + 1;
      }
    }

    // Vessel
    if (!shipment.vessel_name && extracted.vessel_name && extracted.vessel_name !== 'null') {
      updates.vessel_name = extracted.vessel_name.substring(0, 100);
      stats.vessel = (stats.vessel || 0) + 1;
    }
    if (!shipment.voyage_number && extracted.voyage_number) {
      updates.voyage_number = extracted.voyage_number.substring(0, 50);
    }

    // Dates
    if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
      updates.etd = extracted.etd;
      stats.etd = (stats.etd || 0) + 1;
    }
    if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
      updates.eta = extracted.eta;
      stats.eta = (stats.eta || 0) + 1;
    }

    // Cutoffs
    if (!shipment.si_cutoff && extracted.si_cutoff && dateRegex.test(extracted.si_cutoff)) {
      updates.si_cutoff = extracted.si_cutoff;
      stats.si_cutoff = (stats.si_cutoff || 0) + 1;
    }
    if (!shipment.vgm_cutoff && extracted.vgm_cutoff && dateRegex.test(extracted.vgm_cutoff)) {
      updates.vgm_cutoff = extracted.vgm_cutoff;
      stats.vgm_cutoff = (stats.vgm_cutoff || 0) + 1;
    }
    if (!shipment.cargo_cutoff && extracted.cargo_cutoff && dateRegex.test(extracted.cargo_cutoff)) {
      updates.cargo_cutoff = extracted.cargo_cutoff;
      stats.cargo_cutoff = (stats.cargo_cutoff || 0) + 1;
    }
    if (!shipment.gate_cutoff && extracted.gate_cutoff && dateRegex.test(extracted.gate_cutoff)) {
      updates.gate_cutoff = extracted.gate_cutoff;
      stats.gate_cutoff = (stats.gate_cutoff || 0) + 1;
    }
    if (!shipment.doc_cutoff && extracted.doc_cutoff && dateRegex.test(extracted.doc_cutoff)) {
      updates.doc_cutoff = extracted.doc_cutoff;
      stats.doc_cutoff = (stats.doc_cutoff || 0) + 1;
    }

    // Ports
    if (!shipment.port_of_loading && extracted.port_of_loading) {
      updates.port_of_loading = extracted.port_of_loading.substring(0, 100);
      stats.pol = (stats.pol || 0) + 1;
    }
    if (!shipment.port_of_discharge && extracted.port_of_discharge) {
      updates.port_of_discharge = extracted.port_of_discharge.substring(0, 100);
      stats.pod = (stats.pod || 0) + 1;
    }
    if (extracted.port_of_loading_code && extracted.port_of_loading_code.length === 5) {
      updates.port_of_loading_code = extracted.port_of_loading_code;
    }
    if (extracted.port_of_discharge_code && extracted.port_of_discharge_code.length === 5) {
      updates.port_of_discharge_code = extracted.port_of_discharge_code;
    }
    if (!shipment.final_destination && extracted.final_destination) {
      updates.final_destination = extracted.final_destination.substring(0, 100);
    }

    // Parties
    if (!shipment.shipper_name && extracted.shipper_name) {
      updates.shipper_name = extracted.shipper_name.substring(0, 200);
      stats.shipper = (stats.shipper || 0) + 1;
    }
    if (!shipment.consignee_name && extracted.consignee_name) {
      updates.consignee_name = extracted.consignee_name.substring(0, 200);
      stats.consignee = (stats.consignee || 0) + 1;
    }

    // Container
    if (!shipment.container_number_primary && extracted.container_number && typeof extracted.container_number === 'string') {
      updates.container_number_primary = extracted.container_number.substring(0, 20);
    }

    // Update if changes
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        updated++;
        if (Object.keys(updates).length > 2) {
          console.log(`  ${shipment.booking_number}: +${Object.keys(updates).length - 1} fields`);
        }
      }
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 150));
  }

  console.log('\n\n=== RESULTS ===');
  console.log('Processed:', processed);
  console.log('Updated:', updated);
  console.log('\nFields extracted:');
  Object.entries(stats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

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
