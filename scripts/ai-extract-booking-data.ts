#!/usr/bin/env npx tsx
/**
 * AI Extract Booking Data from Emails
 * Uses Claude to parse unstructured booking confirmation emails
 */

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

if (!anthropicKey) {
  console.error('Missing ANTHROPIC_API_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: anthropicKey });

const EXTRACTION_PROMPT = `Extract shipping booking information from this email. Return ONLY valid JSON with these fields (use null for missing values):

{
  "carrier": "shipping line name (Hapag-Lloyd, Maersk, CMA CGM, MSC, COSCO, ONE, Evergreen, etc.)",
  "booking_number": "booking reference number",
  "vessel_name": "vessel/ship name",
  "voyage_number": "voyage number",
  "etd": "departure date in YYYY-MM-DD format",
  "eta": "arrival date in YYYY-MM-DD format",
  "port_of_loading": "loading port name",
  "port_of_loading_code": "UN/LOCODE if available",
  "port_of_discharge": "discharge port name",
  "port_of_discharge_code": "UN/LOCODE if available",
  "final_destination": "final destination if different from POD",
  "si_cutoff": "SI/documentation cutoff date in YYYY-MM-DD format",
  "vgm_cutoff": "VGM cutoff date in YYYY-MM-DD format",
  "cargo_cutoff": "cargo/CY cutoff date in YYYY-MM-DD format",
  "gate_cutoff": "gate cutoff date in YYYY-MM-DD format",
  "container_type": "container size/type (20GP, 40HC, etc.)",
  "shipper_name": "shipper/exporter company name",
  "consignee_name": "consignee/importer company name"
}

EMAIL CONTENT:
`;

async function extractWithAI(subject: string, bodyText: string): Promise<any> {
  const content = `Subject: ${subject}\n\nBody:\n${bodyText?.substring(0, 4000) || 'No body text'}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: EXTRACTION_PROMPT + content,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch (error: any) {
    console.error('AI extraction error:', error.message);
    return null;
  }
}

async function main() {
  console.log('=== AI EXTRACTION FOR BOOKING DATA ===\n');

  // Get carriers for ID lookup
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierByName = new Map<string, string>();
  carriers?.forEach(c => {
    carrierByName.set(c.carrier_name.toLowerCase(), c.id);
    // Also add variations
    if (c.carrier_name === 'Hapag-Lloyd') carrierByName.set('hapag-lloyd', c.id);
    if (c.carrier_name === 'Maersk Line') {
      carrierByName.set('maersk', c.id);
      carrierByName.set('maersk line', c.id);
    }
    if (c.carrier_name === 'CMA CGM') carrierByName.set('cma-cgm', c.id);
    if (c.carrier_name === 'COSCO Shipping') carrierByName.set('cosco', c.id);
  });

  // Get shipments with incomplete data
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, carrier_id, vessel_name, etd, eta, port_of_loading, port_of_discharge, si_cutoff, vgm_cutoff, cargo_cutoff, shipper_name, consignee_name')
    .or('etd.is.null,eta.is.null,si_cutoff.is.null,vgm_cutoff.is.null,vessel_name.is.null');

  console.log('Shipments needing extraction:', shipments?.length);

  // Limit to avoid too many API calls
  const toProcess = shipments?.slice(0, 50) || [];
  console.log('Processing first:', toProcess.length);

  let updated = 0;
  const stats = {
    carrier: 0,
    vessel: 0,
    etd: 0,
    eta: 0,
    pol: 0,
    pod: 0,
    si_cutoff: 0,
    vgm_cutoff: 0,
    cargo_cutoff: 0,
    shipper: 0,
    consignee: 0,
  };

  for (let i = 0; i < toProcess.length; i++) {
    const shipment = toProcess[i];
    console.log(`\n[${i + 1}/${toProcess.length}] Processing ${shipment.booking_number}...`);

    // Get email content
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject, body_text')
      .eq('id', shipment.created_from_email_id)
      .single();

    if (!email) {
      console.log('  No email found');
      continue;
    }

    // Extract with AI
    const extracted = await extractWithAI(email.subject || '', email.body_text || '');
    if (!extracted) {
      console.log('  Extraction failed');
      continue;
    }

    console.log('  Extracted:', JSON.stringify(extracted).substring(0, 100) + '...');

    // Build update object (only for missing fields)
    const updates: Record<string, any> = {};

    // Carrier
    if (!shipment.carrier_id && extracted.carrier) {
      const carrierId = carrierByName.get(extracted.carrier.toLowerCase());
      if (carrierId) {
        updates.carrier_id = carrierId;
        stats.carrier++;
      }
    }

    // Vessel/Voyage
    if (!shipment.vessel_name && extracted.vessel_name) {
      updates.vessel_name = extracted.vessel_name.substring(0, 100);
      stats.vessel++;
    }
    if (extracted.voyage_number) {
      updates.voyage_number = extracted.voyage_number.substring(0, 50);
    }

    // Dates (validate format)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!shipment.etd && extracted.etd && dateRegex.test(extracted.etd)) {
      updates.etd = extracted.etd;
      stats.etd++;
    }
    if (!shipment.eta && extracted.eta && dateRegex.test(extracted.eta)) {
      updates.eta = extracted.eta;
      stats.eta++;
    }
    if (!shipment.si_cutoff && extracted.si_cutoff && dateRegex.test(extracted.si_cutoff)) {
      updates.si_cutoff = extracted.si_cutoff;
      stats.si_cutoff++;
    }
    if (!shipment.vgm_cutoff && extracted.vgm_cutoff && dateRegex.test(extracted.vgm_cutoff)) {
      updates.vgm_cutoff = extracted.vgm_cutoff;
      stats.vgm_cutoff++;
    }
    if (!shipment.cargo_cutoff && extracted.cargo_cutoff && dateRegex.test(extracted.cargo_cutoff)) {
      updates.cargo_cutoff = extracted.cargo_cutoff;
      stats.cargo_cutoff++;
    }

    // Ports
    if (!shipment.port_of_loading && extracted.port_of_loading) {
      updates.port_of_loading = extracted.port_of_loading.substring(0, 100);
      stats.pol++;
    }
    if (!shipment.port_of_discharge && extracted.port_of_discharge) {
      updates.port_of_discharge = extracted.port_of_discharge.substring(0, 100);
      stats.pod++;
    }
    if (extracted.port_of_loading_code) {
      updates.port_of_loading_code = extracted.port_of_loading_code.substring(0, 10);
    }
    if (extracted.port_of_discharge_code) {
      updates.port_of_discharge_code = extracted.port_of_discharge_code.substring(0, 10);
    }
    if (extracted.final_destination) {
      updates.final_destination = extracted.final_destination.substring(0, 100);
    }

    // Parties
    if (!shipment.shipper_name && extracted.shipper_name) {
      updates.shipper_name = extracted.shipper_name.substring(0, 200);
      stats.shipper++;
    }
    if (!shipment.consignee_name && extracted.consignee_name) {
      updates.consignee_name = extracted.consignee_name.substring(0, 200);
      stats.consignee++;
    }

    // Update if we have changes
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error) {
        updated++;
        console.log('  Updated fields:', Object.keys(updates).join(', '));
      } else {
        console.error('  Update error:', error.message);
      }
    } else {
      console.log('  No new fields to update');
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log('\n=== RESULTS ===');
  console.log('Shipments updated:', updated);
  console.log('\nFields extracted:');
  Object.entries(stats).forEach(([field, count]) => {
    if (count > 0) console.log(`  ${field}: ${count}`);
  });

  // Show final coverage
  console.log('\n=== FINAL COVERAGE ===');
  const { data: final } = await supabase
    .from('shipments')
    .select('carrier_id, vessel_name, etd, eta, port_of_loading, port_of_discharge, si_cutoff, vgm_cutoff, cargo_cutoff, shipper_name, consignee_name');

  const total = final?.length || 0;
  const coverage: Record<string, number> = {};

  for (const field of ['carrier_id', 'vessel_name', 'etd', 'eta', 'port_of_loading', 'port_of_discharge', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'shipper_name', 'consignee_name']) {
    coverage[field] = final?.filter(s => (s as any)[field]).length || 0;
  }

  for (const [field, count] of Object.entries(coverage)) {
    const pct = Math.round((count / total) * 100);
    console.log(`  ${field}: ${count}/${total} (${pct}%)`);
  }
}

main().catch(console.error);
