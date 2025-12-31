#!/usr/bin/env npx tsx
/**
 * Rebuild Shipments from Booking Confirmations
 *
 * A shipment lifecycle STARTS with booking confirmation and includes:
 * - Carrier (from content, not just sender)
 * - Vessel/Voyage
 * - ETD/ETA
 * - POL/POD/FPOD
 * - Deadlines (SI cutoff, VGM cutoff, Cargo cutoff, Gate cutoff)
 * - Shipper/Consignee
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Carrier detection patterns (from content, not just sender)
const CARRIER_PATTERNS = [
  { pattern: /hapag[-\s]?lloyd|HLCU|HLXU|\bHLCL\b|\bhlag\b/i, name: 'Hapag-Lloyd' },
  { pattern: /maersk|MAEU|MSKU|MRKU/i, name: 'Maersk Line' },
  { pattern: /cma[\s-]?cgm|CMAU|CGMU/i, name: 'CMA CGM' },
  { pattern: /\bMSC\b|MSCU|MEDU/i, name: 'MSC' },
  { pattern: /cosco|COSU|CBHU/i, name: 'COSCO Shipping' },
  { pattern: /\bONE\b|ocean\s*network\s*express|ONEU/i, name: 'ONE' },
  { pattern: /evergreen|EGHU|EISU|EMCU/i, name: 'Evergreen' },
  { pattern: /\bOOCL\b|OOLU/i, name: 'OOCL' },
  { pattern: /yang\s*ming|YMLU/i, name: 'Yang Ming' },
  { pattern: /\bZIM\b|ZIMU/i, name: 'ZIM' },
];

// Date extraction patterns
const DATE_PATTERNS = {
  etd: [
    /ETD[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
    /ETD[:\s]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
    /departure[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
    /sailing[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
  ],
  eta: [
    /ETA[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
    /ETA[:\s]*(\d{4}[-\/]\d{2}[-\/]\d{2})/i,
    /arrival[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
  ],
  si_cutoff: [
    /SI\s*cut[-\s]?off[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
    /shipping\s*instruction[s]?\s*cut[-\s]?off[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
    /doc(?:ument)?\s*cut[-\s]?off[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
  ],
  vgm_cutoff: [
    /VGM\s*cut[-\s]?off[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
    /VGM[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
  ],
  cargo_cutoff: [
    /cargo\s*cut[-\s]?off[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
    /CY\s*cut[-\s]?off[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
  ],
  gate_cutoff: [
    /gate\s*cut[-\s]?off[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
    /port\s*cut[-\s]?off[:\s]*(\d{1,2}[-\/]\w{3}[-\/]\d{2,4})/i,
  ],
};

// Port extraction patterns
const PORT_PATTERNS = {
  pol: [
    /(?:port\s*of\s*loading|POL|load(?:ing)?\s*port)[:\s]*([A-Z][A-Za-z\s,]+?)(?:\s*[-|,]|\s*$)/i,
    /from[:\s]*([A-Z][A-Za-z\s]+?)(?:\s+to\s+)/i,
  ],
  pod: [
    /(?:port\s*of\s*discharge|POD|discharge\s*port)[:\s]*([A-Z][A-Za-z\s,]+?)(?:\s*[-|,]|\s*$)/i,
    /to[:\s]*([A-Z][A-Za-z\s]+?)(?:\s*[-|,]|\s*$)/i,
  ],
};

// Vessel/Voyage patterns
const VESSEL_PATTERNS = [
  /vessel[:\s]*([A-Z][A-Za-z0-9\s]+?)(?:\s*[-\/|,]|\s+voyage|\s*$)/i,
  /(?:M\/V|MV|VSL)[:\s]*([A-Z][A-Za-z0-9\s]+?)(?:\s*[-\/|,]|\s*$)/i,
  /ship[:\s]*([A-Z][A-Za-z0-9\s]+?)(?:\s*[-\/|,]|\s*$)/i,
];

const VOYAGE_PATTERNS = [
  /voyage[:\s]*([A-Z0-9]+)/i,
  /voy[:\s]*([A-Z0-9]+)/i,
  /(?:voyage|voy)\s*(?:no\.?|#)?[:\s]*([A-Z0-9]+)/i,
];

function detectCarrier(text: string): string | null {
  for (const { pattern, name } of CARRIER_PATTERNS) {
    if (pattern.test(text)) {
      return name;
    }
  }
  return null;
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // Try various formats
  const formats = [
    // DD-MMM-YYYY or DD/MMM/YYYY
    /(\d{1,2})[-\/](\w{3})[-\/](\d{2,4})/,
    // YYYY-MM-DD
    /(\d{4})[-\/](\d{2})[-\/](\d{2})/,
  ];

  for (const fmt of formats) {
    const match = dateStr.match(fmt);
    if (match) {
      try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          return d.toISOString().split('T')[0];
        }
      } catch {
        // Continue trying
      }
    }
  }

  return null;
}

function extractDate(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const parsed = parseDate(match[1]);
      if (parsed) return parsed;
    }
  }
  return null;
}

function extractField(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

async function rebuildShipments() {
  console.log('=== REBUILDING SHIPMENTS FROM BOOKING CONFIRMATIONS ===\n');

  // Get carriers from database
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierByName = new Map<string, string>();
  carriers?.forEach(c => {
    carrierByName.set(c.carrier_name.toLowerCase(), c.id);
  });
  console.log('Carriers in DB:', Array.from(carrierByName.keys()));

  // Get all shipments with their source emails
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, carrier_id, vessel_name, voyage_number, etd, eta, port_of_loading, port_of_discharge, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff');

  console.log('Total shipments:', shipments?.length);

  // Get all source email IDs
  const emailIds = shipments?.map(s => s.created_from_email_id).filter(Boolean) || [];

  // Fetch emails in batches
  const emailMap = new Map<string, any>();
  const batchSize = 50;

  console.log('Fetching source emails...');
  for (let i = 0; i < emailIds.length; i += batchSize) {
    const batch = emailIds.slice(i, i + batchSize);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, body_text, sender_email')
      .in('id', batch);

    emails?.forEach(e => emailMap.set(e.id, e));
  }
  console.log('Emails fetched:', emailMap.size);

  // Also get entity extractions for additional data
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', emailIds);

  const entityByEmail = new Map<string, Map<string, string>>();
  entities?.forEach(e => {
    if (!entityByEmail.has(e.email_id)) {
      entityByEmail.set(e.email_id, new Map());
    }
    // Keep first value for each type
    if (!entityByEmail.get(e.email_id)?.has(e.entity_type)) {
      entityByEmail.get(e.email_id)?.set(e.entity_type, e.entity_value);
    }
  });

  let updated = 0;
  let carrierUpdated = 0;
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
  };

  for (const shipment of shipments || []) {
    const email = emailMap.get(shipment.created_from_email_id);
    if (!email) continue;

    const fullText = `${email.subject || ''} ${email.body_text || ''}`;
    const entityMap = entityByEmail.get(shipment.created_from_email_id) || new Map();

    const updates: Record<string, any> = {};

    // 1. Detect Carrier (if not already set)
    if (!shipment.carrier_id) {
      const carrierName = detectCarrier(fullText);
      if (carrierName) {
        // Find carrier ID
        const carrierId = carrierByName.get(carrierName.toLowerCase());
        if (carrierId) {
          updates.carrier_id = carrierId;
          stats.carrier++;
        }
      }
    }

    // 2. Extract Vessel/Voyage
    if (!shipment.vessel_name) {
      const vessel = extractField(fullText, VESSEL_PATTERNS) || entityMap.get('vessel_name');
      if (vessel) {
        updates.vessel_name = vessel.substring(0, 100);
        stats.vessel++;
      }
    }
    if (!shipment.voyage_number) {
      const voyage = extractField(fullText, VOYAGE_PATTERNS) || entityMap.get('voyage_number');
      if (voyage) {
        updates.voyage_number = voyage.substring(0, 50);
      }
    }

    // 3. Extract Dates
    if (!shipment.etd) {
      const etd = extractDate(fullText, DATE_PATTERNS.etd) || entityMap.get('etd');
      if (etd) {
        updates.etd = etd;
        stats.etd++;
      }
    }
    if (!shipment.eta) {
      const eta = extractDate(fullText, DATE_PATTERNS.eta) || entityMap.get('eta');
      if (eta) {
        updates.eta = eta;
        stats.eta++;
      }
    }

    // 4. Extract Cutoffs
    if (!shipment.si_cutoff) {
      const si = extractDate(fullText, DATE_PATTERNS.si_cutoff) || entityMap.get('si_cutoff');
      if (si) {
        updates.si_cutoff = si;
        stats.si_cutoff++;
      }
    }
    if (!shipment.vgm_cutoff) {
      const vgm = extractDate(fullText, DATE_PATTERNS.vgm_cutoff) || entityMap.get('vgm_cutoff');
      if (vgm) {
        updates.vgm_cutoff = vgm;
        stats.vgm_cutoff++;
      }
    }
    if (!shipment.cargo_cutoff) {
      const cargo = extractDate(fullText, DATE_PATTERNS.cargo_cutoff) || entityMap.get('cargo_cutoff');
      if (cargo) {
        updates.cargo_cutoff = cargo;
        stats.cargo_cutoff++;
      }
    }

    // 5. Extract Ports
    if (!shipment.port_of_loading) {
      const pol = extractField(fullText, PORT_PATTERNS.pol) || entityMap.get('port_of_loading');
      if (pol) {
        updates.port_of_loading = pol.substring(0, 100);
        stats.pol++;
      }
    }
    if (!shipment.port_of_discharge) {
      const pod = extractField(fullText, PORT_PATTERNS.pod) || entityMap.get('port_of_discharge');
      if (pod) {
        updates.port_of_discharge = pod.substring(0, 100);
        stats.pod++;
      }
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
        if (updates.carrier_id) carrierUpdated++;
      } else {
        console.error('Error updating', shipment.booking_number, ':', error.message);
      }
    }
  }

  console.log('\n=== RESULTS ===');
  console.log('Shipments updated:', updated);
  console.log('Carriers linked:', carrierUpdated);
  console.log('\nFields extracted:');
  Object.entries(stats).forEach(([field, count]) => {
    console.log(`  ${field}: ${count}`);
  });

  // Show final coverage
  console.log('\n=== FINAL COVERAGE ===');
  const { data: final } = await supabase
    .from('shipments')
    .select('carrier_id, vessel_name, etd, eta, port_of_loading, port_of_discharge, si_cutoff, vgm_cutoff');

  const total = final?.length || 0;
  const coverage = {
    carrier: final?.filter(s => s.carrier_id).length || 0,
    vessel: final?.filter(s => s.vessel_name).length || 0,
    etd: final?.filter(s => s.etd).length || 0,
    eta: final?.filter(s => s.eta).length || 0,
    pol: final?.filter(s => s.port_of_loading).length || 0,
    pod: final?.filter(s => s.port_of_discharge).length || 0,
    si_cutoff: final?.filter(s => s.si_cutoff).length || 0,
    vgm_cutoff: final?.filter(s => s.vgm_cutoff).length || 0,
  };

  for (const [field, count] of Object.entries(coverage)) {
    const pct = Math.round((count / total) * 100);
    console.log(`  ${field}: ${count}/${total} (${pct}%)`);
  }
}

rebuildShipments().catch(console.error);
