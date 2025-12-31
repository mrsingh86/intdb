/**
 * Normalize Ports - Extract codes and standardize names
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Port code extraction - (XXXXX) or just find known codes
const CODE_REGEX = /\(([A-Z]{5})\)/;

// Known port mappings
const INDIA_PORTS: Record<string, { name: string; code: string }> = {
  'mundra': { name: 'Mundra', code: 'INMUN' },
  'nhava sheva': { name: 'Nhava Sheva (JNPT)', code: 'INNSA' },
  'jnpt': { name: 'Nhava Sheva (JNPT)', code: 'INNSA' },
  'pipavav': { name: 'Pipavav', code: 'INPAV' },
  'hazira': { name: 'Hazira', code: 'INHZA' },
  'chennai': { name: 'Chennai', code: 'INMAA' },
  'kolkata': { name: 'Kolkata', code: 'INCCU' },
  'cochin': { name: 'Cochin', code: 'INCOK' },
  'tuticorin': { name: 'Tuticorin', code: 'INTUT' },
};

const US_PORTS: Record<string, { name: string; code: string }> = {
  'newark': { name: 'Newark', code: 'USEWR' },
  'new york': { name: 'New York', code: 'USNYC' },
  'savannah': { name: 'Savannah', code: 'USSAV' },
  'houston': { name: 'Houston', code: 'USHOU' },
  'baltimore': { name: 'Baltimore', code: 'USBAL' },
  'norfolk': { name: 'Norfolk', code: 'USORF' },
  'new orleans': { name: 'New Orleans', code: 'USMSY' },
  'los angeles': { name: 'Los Angeles', code: 'USLAX' },
  'long beach': { name: 'Long Beach', code: 'USLGB' },
  'charleston': { name: 'Charleston', code: 'USCHS' },
  'tampa': { name: 'Tampa', code: 'USTPA' },
  'oakland': { name: 'Oakland', code: 'USOAK' },
  'seattle': { name: 'Seattle', code: 'USSEA' },
  'miami': { name: 'Miami', code: 'USMIA' },
  'bay port': { name: 'Houston (Bay Port)', code: 'USHOU' },
  'maher': { name: 'Newark (Maher)', code: 'USEWR' },
};

const CANADA_PORTS: Record<string, { name: string; code: string }> = {
  'montreal': { name: 'Montreal', code: 'CAMTR' },
  'toronto': { name: 'Toronto', code: 'CATOR' },
  'vancouver': { name: 'Vancouver', code: 'CAVAN' },
};

function normalizePort(portValue: string | null): { name: string; code: string } | null {
  if (!portValue) return null;

  const lower = portValue.toLowerCase();

  // First try to extract code from parentheses
  const codeMatch = portValue.match(CODE_REGEX);
  if (codeMatch) {
    const code = codeMatch[1];
    // Clean the name - remove the code part
    let name = portValue.replace(CODE_REGEX, '').trim();
    name = name.replace(/,\s*$/, '').trim();
    return { name, code };
  }

  // Check India ports
  for (const [key, value] of Object.entries(INDIA_PORTS)) {
    if (lower.includes(key)) {
      return value;
    }
  }

  // Check US ports
  for (const [key, value] of Object.entries(US_PORTS)) {
    if (lower.includes(key)) {
      return value;
    }
  }

  // Check Canada ports
  for (const [key, value] of Object.entries(CANADA_PORTS)) {
    if (lower.includes(key)) {
      return value;
    }
  }

  return null;
}

async function normalizePorts() {
  console.log('='.repeat(70));
  console.log('NORMALIZING PORTS');
  console.log('='.repeat(70));

  const stats = { polNormalized: 0, podNormalized: 0, polCodeAdded: 0, podCodeAdded: 0 };

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, port_of_loading, port_of_loading_code, port_of_discharge, port_of_discharge_code');

  for (const s of shipments || []) {
    const updates: Record<string, any> = {};

    // Normalize POL
    if (s.port_of_loading) {
      const normalized = normalizePort(s.port_of_loading);
      if (normalized) {
        if (!s.port_of_loading_code) {
          updates.port_of_loading_code = normalized.code;
          stats.polCodeAdded++;
        }
        // Only update name if significantly different
        if (normalized.name !== s.port_of_loading && s.port_of_loading.length > normalized.name.length + 5) {
          updates.port_of_loading = normalized.name;
          stats.polNormalized++;
        }
      }
    }

    // Normalize POD
    if (s.port_of_discharge) {
      const normalized = normalizePort(s.port_of_discharge);
      if (normalized) {
        if (!s.port_of_discharge_code) {
          updates.port_of_discharge_code = normalized.code;
          stats.podCodeAdded++;
        }
        if (normalized.name !== s.port_of_discharge && s.port_of_discharge.length > normalized.name.length + 5) {
          updates.port_of_discharge = normalized.name;
          stats.podNormalized++;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await supabase.from('shipments').update(updates).eq('id', s.id);
      console.log(`${s.booking_number}: ${Object.keys(updates).filter(k => k !== 'updated_at').join(', ')}`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`POL codes added: ${stats.polCodeAdded}`);
  console.log(`POD codes added: ${stats.podCodeAdded}`);
  console.log(`POL names normalized: ${stats.polNormalized}`);
  console.log(`POD names normalized: ${stats.podNormalized}`);

  // Final coverage
  const { data: final } = await supabase
    .from('shipments')
    .select('port_of_loading_code, port_of_discharge_code');

  const withPolCode = final?.filter(s => s.port_of_loading_code).length || 0;
  const withPodCode = final?.filter(s => s.port_of_discharge_code).length || 0;

  console.log(`\nFinal coverage:`);
  console.log(`  With POL code: ${withPolCode}/${final?.length}`);
  console.log(`  With POD code: ${withPodCode}/${final?.length}`);
}

normalizePorts().catch(console.error);
