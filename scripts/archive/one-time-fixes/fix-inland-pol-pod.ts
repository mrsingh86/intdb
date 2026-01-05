import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Port normalization mapping
const PORT_NORMALIZATION: Record<string, { name: string; code: string }> = {
  // Indian seaports
  'pipavav': { name: 'Pipavav', code: 'INPAV' },
  'pipavav terminal': { name: 'Pipavav', code: 'INPAV' },
  'mundra': { name: 'Mundra', code: 'INMUN' },
  'mundra adani': { name: 'Mundra', code: 'INMUN' },
  'nhava sheva': { name: 'Nhava Sheva', code: 'INNSA' },
  'jawaharlal nehru': { name: 'Nhava Sheva', code: 'INNSA' },
  'jnpt': { name: 'Nhava Sheva', code: 'INNSA' },
  'nsict': { name: 'Nhava Sheva', code: 'INNSA' },
  'nsigt': { name: 'Nhava Sheva', code: 'INNSA' },
  'hazira': { name: 'Hazira', code: 'INHZA' },
  'chennai': { name: 'Chennai', code: 'INMAA' },
  'kolkata': { name: 'Kolkata', code: 'INCCU' },
  'cochin': { name: 'Cochin', code: 'INCOK' },

  // US seaports
  'houston': { name: 'Houston', code: 'USHOU' },
  'houston barbours cut': { name: 'Houston', code: 'USHOU' },
  'houston bay port': { name: 'Houston', code: 'USHOU' },
  'newark': { name: 'Newark', code: 'USEWR' },
  'port elizabeth': { name: 'Newark', code: 'USEWR' },
  'new york': { name: 'New York', code: 'USNYC' },
  'maher terminal': { name: 'Newark', code: 'USEWR' },
  'charleston': { name: 'Charleston', code: 'USCHS' },
  'wando terminal': { name: 'Charleston', code: 'USCHS' },
  'savannah': { name: 'Savannah', code: 'USSAV' },
  'los angeles': { name: 'Los Angeles', code: 'USLAX' },
  'long beach': { name: 'Long Beach', code: 'USLGB' },
  'norfolk': { name: 'Norfolk', code: 'USORF' },
  'baltimore': { name: 'Baltimore', code: 'USBAL' },
  'sea girt terminal': { name: 'Baltimore', code: 'USBAL' },
  'oakland': { name: 'Oakland', code: 'USOAK' },
  'tampa': { name: 'Tampa', code: 'USTPA' },
};

// Inland locations that should NOT be POL/POD
const INLAND_LOCATIONS = [
  'ludhiana', 'icd sanehwal', 'ludhiana container depot',
  'new delhi', 'tughlakabad', 'delhi',
  'gurgaon', 'gateway rail',
  'patli', 'chawapayal',
  'chicago', 'fort worth', 'dallas', 'columbus', 'indianapolis',
  'maher terminal', // This is a terminal in Newark, not a port
  'wando terminal', // This is a terminal in Charleston
  'sea girt terminal', // This is a terminal in Baltimore
];

function normalizePort(portName: string | null): { name: string; code: string } | null {
  if (!portName) return null;
  const lower = portName.toLowerCase().trim();

  // Direct lookup
  if (PORT_NORMALIZATION[lower]) {
    return PORT_NORMALIZATION[lower];
  }

  // Partial match
  for (const [key, value] of Object.entries(PORT_NORMALIZATION)) {
    if (lower.includes(key) && !INLAND_LOCATIONS.some(inland => lower.includes(inland))) {
      return value;
    }
  }

  return null;
}

function isInlandLocation(locationName: string | null): boolean {
  if (!locationName) return false;
  const lower = locationName.toLowerCase();
  return INLAND_LOCATIONS.some(inland => lower.includes(inland));
}

async function main() {
  console.log('═'.repeat(80));
  console.log('FIXING INLAND POL/POD DATA');
  console.log('═'.repeat(80));

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, port_of_loading, port_of_loading_code, port_of_discharge, port_of_discharge_code, place_of_receipt, place_of_delivery');

  let fixedCount = 0;
  const issues: string[] = [];

  for (const s of shipments || []) {
    const updates: Record<string, any> = {};
    const reasons: string[] = [];

    // Check if POL is an inland location
    if (isInlandLocation(s.port_of_loading)) {
      // Try to find actual seaport from place_of_receipt or default to common ports
      const polLower = (s.port_of_loading || '').toLowerCase();

      if (polLower.includes('ludhiana') || polLower.includes('sanehwal')) {
        // Ludhiana typically ships through Pipavav or Mundra
        updates.port_of_loading = 'Pipavav';
        updates.port_of_loading_code = 'INPAV';
        updates.place_of_receipt = s.port_of_loading; // Move to place_of_receipt
        reasons.push(`POL: ${s.port_of_loading} → Pipavav (inland moved to place_of_receipt)`);
      } else if (polLower.includes('delhi') || polLower.includes('gurgaon') || polLower.includes('tughlakabad')) {
        // Delhi area typically ships through JNPT or Mundra
        updates.port_of_loading = 'Nhava Sheva';
        updates.port_of_loading_code = 'INNSA';
        updates.place_of_receipt = s.port_of_loading;
        reasons.push(`POL: ${s.port_of_loading} → Nhava Sheva (inland moved to place_of_receipt)`);
      }
    }

    // Normalize POL name and add missing code
    const polNorm = normalizePort(updates.port_of_loading || s.port_of_loading);
    if (polNorm) {
      if (!updates.port_of_loading && polNorm.name !== s.port_of_loading) {
        updates.port_of_loading = polNorm.name;
        reasons.push(`POL normalized: ${s.port_of_loading} → ${polNorm.name}`);
      }
      if (!s.port_of_loading_code || s.port_of_loading_code === 'INNSA' && !s.port_of_loading?.toLowerCase().includes('nhava')) {
        updates.port_of_loading_code = polNorm.code;
        reasons.push(`POL code: ${s.port_of_loading_code || 'null'} → ${polNorm.code}`);
      }
    }

    // Check if POD contains terminal name (should be just port)
    const podLower = (s.port_of_discharge || '').toLowerCase();
    if (podLower.includes('terminal') || podLower.includes('maher') || podLower.includes('wando') || podLower.includes('sea girt')) {
      const podNorm = normalizePort(s.port_of_discharge);
      if (podNorm) {
        // Move terminal info to place_of_delivery if not set
        if (!s.place_of_delivery && s.port_of_discharge) {
          updates.place_of_delivery = s.port_of_discharge;
        }
        updates.port_of_discharge = podNorm.name;
        updates.port_of_discharge_code = podNorm.code;
        reasons.push(`POD normalized: ${s.port_of_discharge} → ${podNorm.name}`);
      }
    }

    // Add missing POD code
    if (!s.port_of_discharge_code && s.port_of_discharge) {
      const podNorm = normalizePort(s.port_of_discharge);
      if (podNorm) {
        updates.port_of_discharge_code = podNorm.code;
        reasons.push(`POD code added: ${podNorm.code}`);
      }
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', s.id);

      if (error) {
        console.log(`❌ ${s.booking_number}: ${error.message}`);
        issues.push(s.booking_number);
      } else {
        console.log(`✅ ${s.booking_number}:`);
        reasons.forEach(r => console.log(`   ${r}`));
        fixedCount++;
      }
    }
  }

  console.log('\n' + '═'.repeat(80));
  console.log(`SUMMARY: Fixed ${fixedCount} shipments`);
  if (issues.length > 0) {
    console.log(`Issues: ${issues.join(', ')}`);
  }
}

main().catch(console.error);
