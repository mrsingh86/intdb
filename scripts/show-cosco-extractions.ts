#!/usr/bin/env npx tsx
/**
 * Show COSCO successful extractions
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get COSCO carrier ID
  const { data: carriers } = await supabase
    .from('carriers')
    .select('id, carrier_name')
    .ilike('carrier_name', '%cosco%');

  const coscoId = carriers?.[0]?.id;
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                    COSCO EXTRACTION STATUS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  console.log('Carrier:', carriers?.[0]?.carrier_name);

  // Get all COSCO shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff, etd, eta, vessel_name')
    .eq('carrier_id', coscoId)
    .order('created_at', { ascending: false });

  console.log('Total COSCO shipments:', shipments?.length);

  // Categorize
  const withAllCutoffs = shipments?.filter(s => s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff) || [];
  const withAnyCutoff = shipments?.filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff) || [];
  const withNone = shipments?.filter(s => s.si_cutoff === null && s.vgm_cutoff === null && s.cargo_cutoff === null) || [];

  console.log('\nWith ALL 3 cutoffs:', withAllCutoffs.length);
  console.log('With ANY cutoff:', withAnyCutoff.length);
  console.log('With NO cutoffs:', withNone.length);

  console.log('\n' + '═'.repeat(70));
  console.log('✅ SUCCESSFUL EXTRACTIONS (All 3 Cutoffs)');
  console.log('═'.repeat(70));

  for (const s of withAllCutoffs) {
    console.log('\n📦 ' + s.booking_number);
    console.log('   SI Cutoff:    ' + s.si_cutoff);
    console.log('   VGM Cutoff:   ' + s.vgm_cutoff);
    console.log('   Cargo Cutoff: ' + s.cargo_cutoff);
    console.log('   ETD: ' + (s.etd || 'N/A') + ' | ETA: ' + (s.eta || 'N/A'));
    console.log('   Vessel: ' + (s.vessel_name || 'N/A'));
  }

  if (withAnyCutoff.length > withAllCutoffs.length) {
    console.log('\n' + '═'.repeat(70));
    console.log('⚠️  PARTIAL EXTRACTIONS (Some Cutoffs)');
    console.log('═'.repeat(70));

    const partial = withAnyCutoff.filter(s => {
      const hasAll = s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff;
      return !hasAll;
    });

    for (const s of partial) {
      console.log('\n📦 ' + s.booking_number);
      console.log('   SI: ' + (s.si_cutoff || '❌ missing'));
      console.log('   VGM: ' + (s.vgm_cutoff || '❌ missing'));
      console.log('   Cargo: ' + (s.cargo_cutoff || '❌ missing'));
    }
  }

  if (withNone.length > 0) {
    console.log('\n' + '═'.repeat(70));
    console.log('❌ MISSING ALL CUTOFFS');
    console.log('═'.repeat(70));

    for (const s of withNone) {
      console.log('   ' + s.booking_number);
    }
  }

  // Summary
  const successRate = shipments?.length ? Math.round((withAllCutoffs.length / shipments.length) * 100) : 0;
  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY: ' + withAllCutoffs.length + '/' + shipments?.length + ' (' + successRate + '%) have all 3 cutoffs');
  console.log('═'.repeat(70));
}

main().catch(console.error);
