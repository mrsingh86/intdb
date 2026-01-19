/**
 * Analyze available dates for categorized delay calculation
 * Run: npx tsx scripts/debugging/analyze-delay-categories.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('========================================');
  console.log('DELAY CATEGORY ANALYSIS');
  console.log('========================================\n');

  // 1. Check what date fields exist in shipments table
  console.log('--- SHIPMENTS TABLE: Date Fields Availability ---\n');

  const { data: shipmentSample } = await supabase
    .from('shipments')
    .select('*')
    .limit(1);

  if (shipmentSample && shipmentSample.length > 0) {
    const dateFields = Object.keys(shipmentSample[0]).filter(k =>
      k.includes('date') || k.includes('cutoff') || k.includes('eta') ||
      k.includes('etd') || k.includes('arrival') || k.includes('departure')
    );
    console.log('Date-related fields in shipments table:');
    for (const f of dateFields.sort()) {
      console.log(`  - ${f}`);
    }
  }

  // 2. Check what date fields exist in chronicle table
  console.log('\n--- CHRONICLE TABLE: Date Fields Availability ---\n');

  const { data: chronicleSample } = await supabase
    .from('chronicle')
    .select('*')
    .limit(1);

  if (chronicleSample && chronicleSample.length > 0) {
    const dateFields = Object.keys(chronicleSample[0]).filter(k =>
      k.includes('date') || k.includes('cutoff') || k.includes('eta') ||
      k.includes('etd') || k.includes('arrival') || k.includes('departure') ||
      k.includes('ata') || k.includes('atd')
    );
    console.log('Date-related fields in chronicle table:');
    for (const f of dateFields.sort()) {
      console.log(`  - ${f}`);
    }
  }

  // 3. Analyze cutoff date availability
  console.log('\n--- CUTOFF DATE AVAILABILITY IN CHRONICLE ---\n');

  const cutoffFields = ['si_cutoff', 'vgm_cutoff', 'doc_cutoff', 'cargo_cutoff'];

  for (const field of cutoffFields) {
    const { count } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact' })
      .not(field, 'is', null);

    console.log(`  ${field}: ${count || 0} records with data`);
  }

  // 4. Analyze ETD/ETA sources
  console.log('\n--- ETD/ETA SOURCE ANALYSIS ---\n');

  // From booking confirmations
  const { count: bookingEtdCount } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact' })
    .eq('document_type', 'booking_confirmation')
    .not('etd', 'is', null);
  console.log(`  ETD from booking_confirmation: ${bookingEtdCount || 0}`);

  // From arrival notices
  const { count: arrivalEtaCount } = await supabase
    .from('chronicle')
    .select('id', { count: 'exact' })
    .eq('document_type', 'arrival_notice')
    .not('eta', 'is', null);
  console.log(`  ETA from arrival_notice: ${arrivalEtaCount || 0}`);

  // 5. Sample data with all dates
  console.log('\n--- SAMPLE SHIPMENT WITH ALL DATES ---\n');

  // Find a shipment with chronicle data
  const { data: richShipment } = await supabase
    .from('chronicle')
    .select('shipment_id, etd, eta, si_cutoff, vgm_cutoff, doc_cutoff, cargo_cutoff, document_type')
    .not('shipment_id', 'is', null)
    .not('etd', 'is', null)
    .limit(10);

  if (richShipment) {
    const shipmentDates: Record<string, any> = {};

    for (const c of richShipment) {
      if (!shipmentDates[c.shipment_id]) {
        shipmentDates[c.shipment_id] = {
          etd: null, eta: null, si_cutoff: null, vgm_cutoff: null,
          doc_cutoff: null, cargo_cutoff: null, sources: []
        };
      }
      const sd = shipmentDates[c.shipment_id];
      if (c.etd) sd.etd = c.etd;
      if (c.eta) sd.eta = c.eta;
      if (c.si_cutoff) sd.si_cutoff = c.si_cutoff;
      if (c.vgm_cutoff) sd.vgm_cutoff = c.vgm_cutoff;
      if (c.doc_cutoff) sd.doc_cutoff = c.doc_cutoff;
      if (c.cargo_cutoff) sd.cargo_cutoff = c.cargo_cutoff;
      sd.sources.push(c.document_type);
    }

    // Show one with good coverage
    for (const [shipId, dates] of Object.entries(shipmentDates)) {
      const filledCount = Object.values(dates).filter(v => v !== null && !Array.isArray(v)).length;
      if (filledCount >= 3) {
        console.log(`Shipment: ${shipId.slice(0, 8)}`);
        console.log(`  ETD: ${dates.etd || 'N/A'}`);
        console.log(`  ETA: ${dates.eta || 'N/A'}`);
        console.log(`  SI Cutoff: ${dates.si_cutoff || 'N/A'}`);
        console.log(`  VGM Cutoff: ${dates.vgm_cutoff || 'N/A'}`);
        console.log(`  Doc Cutoff: ${dates.doc_cutoff || 'N/A'}`);
        console.log(`  Cargo Cutoff: ${dates.cargo_cutoff || 'N/A'}`);
        console.log(`  Sources: ${[...new Set(dates.sources)].join(', ')}`);
        break;
      }
    }
  }

  // 6. Propose categorized delay logic
  console.log('\n\n========================================');
  console.log('PROPOSED DELAY CATEGORIES');
  console.log('========================================\n');

  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│ DELAY CATEGORY          │ REFERENCE DATE      │ PRIMARY SOURCE              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. SI_DELAY             │ si_cutoff           │ booking_confirmation        │
│    "SI submission late" │                     │ booking_amendment           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. VGM_DELAY            │ vgm_cutoff          │ booking_confirmation        │
│    "VGM submission late"│                     │ vgm_request                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. DOC_DELAY            │ doc_cutoff          │ booking_confirmation        │
│    "Documentation late" │                     │                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. CARGO_DELAY          │ cargo_cutoff        │ booking_confirmation        │
│    "Cargo delivery late"│                     │                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. DEPARTURE_DELAY      │ etd                 │ booking_confirmation (pri)  │
│    "Shipment not sailed"│                     │ schedule_update (secondary) │
├─────────────────────────────────────────────────────────────────────────────┤
│ 6. ARRIVAL_DELAY        │ eta                 │ arrival_notice (primary)    │
│    "Shipment not arrived│                     │ booking_confirmation (sec)  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 7. DELIVERY_DELAY       │ delivery_date or    │ arrival_notice              │
│    "Not delivered"      │ last_free_day       │ delivery_order              │
└─────────────────────────────────────────────────────────────────────────────┘

STAGE → DELAY CATEGORY MAPPING:

  PENDING, BOOKED      → Check SI_DELAY, VGM_DELAY, DOC_DELAY, CARGO_DELAY
  SI_SUBMITTED         → Check VGM_DELAY, DOC_DELAY, DEPARTURE_DELAY
  BL_ISSUED            → Check DEPARTURE_DELAY
  DEPARTED             → Check ARRIVAL_DELAY
  ARRIVED              → Check DELIVERY_DELAY
`);

  // 7. Show example calculations
  console.log('\n--- EXAMPLE: How Delays Would Be Calculated ---\n');

  // Find a shipment with stage and dates
  const { data: exampleShipments } = await supabase
    .from('v_shipment_intelligence')
    .select('shipment_id, stage, days_overdue, current_blocker')
    .not('days_overdue', 'is', null)
    .limit(5);

  if (exampleShipments) {
    for (const ex of exampleShipments) {
      // Get dates from chronicle
      const { data: dates } = await supabase
        .from('chronicle')
        .select('etd, eta, si_cutoff, vgm_cutoff')
        .eq('shipment_id', ex.shipment_id)
        .not('etd', 'is', null)
        .limit(1)
        .single();

      const { data: shipDates } = await supabase
        .from('shipments')
        .select('etd, eta')
        .eq('id', ex.shipment_id)
        .single();

      const now = new Date();
      const etd = shipDates?.etd ? new Date(shipDates.etd) : (dates?.etd ? new Date(dates.etd) : null);
      const eta = shipDates?.eta ? new Date(shipDates.eta) : (dates?.eta ? new Date(dates.eta) : null);
      const siCutoff = dates?.si_cutoff ? new Date(dates.si_cutoff) : null;
      const vgmCutoff = dates?.vgm_cutoff ? new Date(dates.vgm_cutoff) : null;

      console.log(`Shipment: ${ex.shipment_id.slice(0, 8)} | Stage: ${ex.stage}`);
      console.log(`  Current days_overdue: ${ex.days_overdue} (generic)`);
      console.log(`  Blocker: ${ex.current_blocker?.slice(0, 50) || 'None'}`);

      // Calculate category-specific delays
      if (ex.stage === 'PENDING' || ex.stage === 'BOOKED') {
        if (siCutoff && siCutoff < now) {
          const siDelay = Math.floor((now.getTime() - siCutoff.getTime()) / (1000*60*60*24));
          console.log(`  → SI_DELAY: ${siDelay} days past SI cutoff`);
        }
        if (vgmCutoff && vgmCutoff < now) {
          const vgmDelay = Math.floor((now.getTime() - vgmCutoff.getTime()) / (1000*60*60*24));
          console.log(`  → VGM_DELAY: ${vgmDelay} days past VGM cutoff`);
        }
      }

      if (ex.stage === 'BL_ISSUED' || ex.stage === 'SI_SUBMITTED') {
        if (etd && etd < now) {
          const deptDelay = Math.floor((now.getTime() - etd.getTime()) / (1000*60*60*24));
          console.log(`  → DEPARTURE_DELAY: ${deptDelay} days past ETD`);
        }
      }

      if (ex.stage === 'ARRIVED') {
        if (eta && eta < now) {
          const arrDelay = Math.floor((now.getTime() - eta.getTime()) / (1000*60*60*24));
          console.log(`  → ARRIVAL_DELAY: ${arrDelay} days past ETA (for reference)`);
        }
        // For arrived, we should look at delivery delay
        console.log(`  → DELIVERY_DELAY: Should calculate from last_free_day or delivery_date`);
      }

      console.log('');
    }
  }

  console.log('\n✅ Analysis complete!');
}

main().catch(console.error);
