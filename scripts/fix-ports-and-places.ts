/**
 * Fix Ports and Places
 *
 * 1. Populate place_of_receipt (POR) and place_of_delivery (POFD) from entities
 * 2. Extract port codes from POL/POD where embedded (e.g., "MUNDRA (INMUN)" -> code: INMUN)
 * 3. Normalize port names
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Port code extraction regex - matches (XXXXX) pattern
const PORT_CODE_REGEX = /\(([A-Z]{5})\)/;

// Known port normalizations
const PORT_NORMALIZATIONS: Record<string, { name: string; code: string }> = {
  // India ports
  'mundra': { name: 'Mundra', code: 'INMUN' },
  'mundra (inmun)': { name: 'Mundra', code: 'INMUN' },
  'mundra port & s.e.z.': { name: 'Mundra', code: 'INMUN' },
  'mundra int.cont.ter. pvt. ltd.': { name: 'Mundra', code: 'INMUN' },
  'adani mundra container terminal t2': { name: 'Mundra', code: 'INMUN' },
  'adani cma mundra container terminal': { name: 'Mundra', code: 'INMUN' },
  'nhava sheva': { name: 'Nhava Sheva (JNPT)', code: 'INNSA' },
  'jawaharlal nehru nsict dpw': { name: 'Nhava Sheva (JNPT)', code: 'INNSA' },
  'nhava sheva india gateway terminal': { name: 'Nhava Sheva (JNPT)', code: 'INNSA' },
  'pipavav terminal': { name: 'Pipavav', code: 'INPAV' },
  'pipavav': { name: 'Pipavav', code: 'INPAV' },
  'adani hazira port pvt. ltd': { name: 'Hazira', code: 'INHZA' },
  'hazira': { name: 'Hazira', code: 'INHZA' },

  // US ports
  'newark - maher terminal': { name: 'Newark', code: 'USEWR' },
  'new york, ny maher terminal (usnyc)': { name: 'New York', code: 'USNYC' },
  'port liberty new york llc': { name: 'New York', code: 'USNYC' },
  'savannah, ga': { name: 'Savannah', code: 'USSAV' },
  'houston barbours cut terminal': { name: 'Houston', code: 'USHOU' },
  'baltimore, md sea girt terminal (usbal)': { name: 'Baltimore', code: 'USBAL' },
  'norfolk, va (usorf)': { name: 'Norfolk', code: 'USORF' },
  'norfolk virginia intl gateway n195': { name: 'Norfolk', code: 'USORF' },
  'norfolk, va norfolk intl term\'l (usorf)': { name: 'Norfolk', code: 'USORF' },
  'new orleans, la': { name: 'New Orleans', code: 'USMSY' },
  'los angeles': { name: 'Los Angeles', code: 'USLAX' },
  'lsa apm terminal pier 400( w185 )': { name: 'Los Angeles', code: 'USLAX' },
  'long beach': { name: 'Long Beach', code: 'USLGB' },
  'long beach container terminal, llc': { name: 'Long Beach', code: 'USLGB' },
  'charleston': { name: 'Charleston', code: 'USCHS' },
  'sc state pa-wando welch tml': { name: 'Charleston', code: 'USCHS' },
  'bay port container terminal': { name: 'Houston', code: 'USHOU' },
  'tampa': { name: 'Tampa', code: 'USTPA' },
  'ports america-port of tampa ctn tml': { name: 'Tampa', code: 'USTPA' },

  // Canada ports
  'montreal racine terminal': { name: 'Montreal', code: 'CAMTR' },
  'montreal racine terminal 395, 2591': { name: 'Montreal', code: 'CAMTR' },
  'toronto': { name: 'Toronto', code: 'CATOR' },
};

function normalizePort(portName: string | null): { name: string; code: string } | null {
  if (!portName) return null;

  const lower = portName.toLowerCase().trim();

  // Check direct match
  if (PORT_NORMALIZATIONS[lower]) {
    return PORT_NORMALIZATIONS[lower];
  }

  // Try to extract code from parentheses
  const codeMatch = portName.match(PORT_CODE_REGEX);
  if (codeMatch) {
    const code = codeMatch[1];
    const name = portName.replace(PORT_CODE_REGEX, '').trim().replace(/,\s*$/, '');
    return { name, code };
  }

  // Partial match
  for (const [key, value] of Object.entries(PORT_NORMALIZATIONS)) {
    if (lower.includes(key) || key.includes(lower)) {
      return value;
    }
  }

  return null;
}

async function fixPortsAndPlaces() {
  console.log('='.repeat(70));
  console.log('FIXING PORTS AND PLACES');
  console.log('='.repeat(70));

  const stats = {
    placesFixed: 0,
    polNormalized: 0,
    podNormalized: 0,
    polCodeAdded: 0,
    podCodeAdded: 0,
  };

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id, port_of_loading, port_of_loading_code, port_of_discharge, port_of_discharge_code, place_of_receipt, place_of_delivery');

  for (const shipment of shipments || []) {
    const updates: Record<string, any> = {};

    // 1. Get entities for places
    if (shipment.created_from_email_id) {
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', shipment.created_from_email_id);

      const entityMap: Record<string, string> = {};
      entities?.forEach(e => {
        if (!entityMap[e.entity_type]) {
          entityMap[e.entity_type] = e.entity_value;
        }
      });

      // Populate place_of_receipt if missing
      if (!shipment.place_of_receipt && entityMap['place_of_receipt']) {
        updates.place_of_receipt = entityMap['place_of_receipt'];
      }

      // Populate place_of_delivery if missing
      if (!shipment.place_of_delivery && entityMap['place_of_delivery']) {
        updates.place_of_delivery = entityMap['place_of_delivery'];
      }

      // Populate POL/POD from entities if missing
      if (!shipment.port_of_loading && entityMap['port_of_loading']) {
        updates.port_of_loading = entityMap['port_of_loading'];
      }
      if (!shipment.port_of_discharge && entityMap['port_of_discharge']) {
        updates.port_of_discharge = entityMap['port_of_discharge'];
      }
    }

    // 2. Normalize POL
    const polToNormalize = updates.port_of_loading || shipment.port_of_loading;
    if (polToNormalize) {
      const normalized = normalizePort(polToNormalize);
      if (normalized) {
        if (normalized.name !== polToNormalize) {
          updates.port_of_loading = normalized.name;
          stats.polNormalized++;
        }
        if (!shipment.port_of_loading_code && normalized.code) {
          updates.port_of_loading_code = normalized.code;
          stats.polCodeAdded++;
        }
      }
    }

    // 3. Normalize POD
    const podToNormalize = updates.port_of_discharge || shipment.port_of_discharge;
    if (podToNormalize) {
      const normalized = normalizePort(podToNormalize);
      if (normalized) {
        if (normalized.name !== podToNormalize) {
          updates.port_of_discharge = normalized.name;
          stats.podNormalized++;
        }
        if (!shipment.port_of_discharge_code && normalized.code) {
          updates.port_of_discharge_code = normalized.code;
          stats.podCodeAdded++;
        }
      }
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();

      const hasPlaceUpdate = updates.place_of_receipt || updates.place_of_delivery;
      if (hasPlaceUpdate) stats.placesFixed++;

      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (!error && Object.keys(updates).length > 1) {
        console.log(`${shipment.booking_number}: ${Object.keys(updates).filter(k => k !== 'updated_at').join(', ')}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`Places (POR/POFD) fixed: ${stats.placesFixed}`);
  console.log(`POL normalized: ${stats.polNormalized}`);
  console.log(`POD normalized: ${stats.podNormalized}`);
  console.log(`POL codes added: ${stats.polCodeAdded}`);
  console.log(`POD codes added: ${stats.podCodeAdded}`);

  // Final stats
  console.log('\n=== FINAL COVERAGE ===\n');

  const { data: final } = await supabase
    .from('shipments')
    .select('port_of_loading, port_of_loading_code, port_of_discharge, port_of_discharge_code, place_of_receipt, place_of_delivery');

  const total = final?.length || 0;
  const withPol = final?.filter(s => s.port_of_loading).length || 0;
  const withPolCode = final?.filter(s => s.port_of_loading_code).length || 0;
  const withPod = final?.filter(s => s.port_of_discharge).length || 0;
  const withPodCode = final?.filter(s => s.port_of_discharge_code).length || 0;
  const withPor = final?.filter(s => s.place_of_receipt).length || 0;
  const withPofd = final?.filter(s => s.place_of_delivery).length || 0;

  console.log(`Total shipments: ${total}`);
  console.log(`With POL: ${withPol} (${Math.round(withPol/total*100)}%)`);
  console.log(`With POL code: ${withPolCode} (${Math.round(withPolCode/total*100)}%)`);
  console.log(`With POD: ${withPod} (${Math.round(withPod/total*100)}%)`);
  console.log(`With POD code: ${withPodCode} (${Math.round(withPodCode/total*100)}%)`);
  console.log(`With POR (inland origin): ${withPor} (${Math.round(withPor/total*100)}%)`);
  console.log(`With POFD (inland dest): ${withPofd} (${Math.round(withPofd/total*100)}%)`);
}

fixPortsAndPlaces().catch(console.error);
