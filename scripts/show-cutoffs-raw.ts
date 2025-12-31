/**
 * Show Raw Cutoff Values from Database
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function showCutoffsRaw() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         CUTOFFS - RAW DATABASE VALUES                                                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff')
    .not('si_cutoff', 'is', null)
    .order('booking_number');

  console.log('┌──────────────────┬──────────────┬──────────────┬──────────────────────────┬──────────────────────────┬──────────────────────────┐');
  console.log('│ Booking          │ ETD          │ ETA          │ SI Cutoff (Raw)          │ VGM Cutoff (Raw)         │ Cargo Cutoff (Raw)       │');
  console.log('├──────────────────┼──────────────┼──────────────┼──────────────────────────┼──────────────────────────┼──────────────────────────┤');

  for (const s of shipments || []) {
    const bn = (s.booking_number || '').substring(0, 16).padEnd(16);
    const etd = (s.etd || '---').substring(0, 12).padEnd(12);
    const eta = (s.eta || '---').substring(0, 12).padEnd(12);
    const si = (s.si_cutoff || '---').substring(0, 24).padEnd(24);
    const vgm = (s.vgm_cutoff || '---').substring(0, 24).padEnd(24);
    const cargo = (s.cargo_cutoff || '---').substring(0, 24).padEnd(24);

    console.log(`│ ${bn} │ ${etd} │ ${eta} │ ${si} │ ${vgm} │ ${cargo} │`);
  }

  console.log('└──────────────────┴──────────────┴──────────────┴──────────────────────────┴──────────────────────────┴──────────────────────────┘');

  // Check what's in entity_extractions for cutoffs
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('SAMPLE: Raw Entity Values for Booking 22970937');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════\n');

  // Find email for this booking
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select(`
      entity_type,
      entity_value,
      email_id
    `)
    .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta'])
    .order('entity_type');

  // Group by booking
  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .eq('entity_type', 'booking_number')
    .eq('entity_value', '22970937');

  const emailIds = bookingEntities?.map(e => e.email_id) || [];

  const { data: cutoffEntities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value')
    .in('email_id', emailIds)
    .in('entity_type', ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'etd', 'eta']);

  console.log('Entity Type       | Raw Value from Email');
  console.log('──────────────────┼────────────────────────────────────');

  for (const e of cutoffEntities || []) {
    console.log(`${e.entity_type.padEnd(18)}| ${e.entity_value}`);
  }
}

showCutoffsRaw().catch(console.error);
