/**
 * Analyze Missing Shipment Data
 *
 * Investigates why shipments are missing route/ETA/ETD data:
 * 1. Check field completeness in shipments table
 * 2. Check if entity_extractions HAS this data but it wasn't copied
 * 3. Sample shipments to understand the gap
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyze() {
  console.log('='.repeat(80));
  console.log('     ANALYZING MISSING SHIPMENT DATA (Route, ETA, ETD)');
  console.log('='.repeat(80));
  console.log('');

  // 1. Get all shipments with field counts
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, port_of_loading, port_of_discharge, etd, eta, vessel_name, source_email_id');

  if (error) {
    console.error('Error fetching shipments:', error.message);
    return;
  }

  const total = shipments?.length || 0;

  // Count populated fields
  const stats = {
    booking_number: 0,
    port_of_loading: 0,
    port_of_discharge: 0,
    etd: 0,
    eta: 0,
    vessel_name: 0,
    source_email_id: 0
  };

  for (const s of shipments || []) {
    if (s.booking_number) stats.booking_number++;
    if (s.port_of_loading) stats.port_of_loading++;
    if (s.port_of_discharge) stats.port_of_discharge++;
    if (s.etd) stats.etd++;
    if (s.eta) stats.eta++;
    if (s.vessel_name) stats.vessel_name++;
    if (s.source_email_id) stats.source_email_id++;
  }

  console.log('SHIPMENT FIELD COMPLETENESS:');
  console.log('-'.repeat(60));
  console.log(`  Total shipments:     ${total}`);
  console.log('');
  console.log('  FIELD                    COUNT     COVERAGE');
  console.log('  ' + '-'.repeat(50));

  for (const [field, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round(count / total * 100);
    const bar = '#'.repeat(Math.floor(pct / 5)) + '.'.repeat(20 - Math.floor(pct / 5));
    console.log(`  ${field.padEnd(22)} ${String(count).padStart(5)}/${total}  [${bar}] ${pct}%`);
  }

  // 2. Find shipments MISSING route data
  const missingRoute = (shipments || []).filter(s => !s.port_of_loading && !s.port_of_discharge);
  const missingDates = (shipments || []).filter(s => !s.etd && !s.eta);
  const missingAll = (shipments || []).filter(s => !s.port_of_loading && !s.port_of_discharge && !s.etd && !s.eta);

  console.log('');
  console.log('MISSING DATA SUMMARY:');
  console.log('-'.repeat(60));
  console.log(`  Missing route (POL + POD):    ${missingRoute.length}`);
  console.log(`  Missing dates (ETD + ETA):    ${missingDates.length}`);
  console.log(`  Missing BOTH route + dates:   ${missingAll.length}`);
  console.log('');

  // 3. Sample shipments missing data - check their source emails
  console.log('INVESTIGATING: Do source emails have this data in entity_extractions?');
  console.log('-'.repeat(60));
  console.log('');

  // Take sample of shipments missing route/dates that have source_email_id
  const sampleMissing = missingAll.filter(s => s.source_email_id).slice(0, 10);

  if (sampleMissing.length === 0) {
    console.log('  No shipments with source_email_id found among missing data.');

    // Check shipments WITHOUT source_email_id
    const noSourceEmail = missingAll.filter(s => !s.source_email_id);
    console.log(`  Shipments missing data AND missing source_email_id: ${noSourceEmail.length}`);
    console.log('');
    console.log('  This explains the gap: Shipments created without source email tracking');
    console.log('  cannot be enriched from entity_extractions.');
  } else {
    console.log(`  Checking ${sampleMissing.length} sample shipments...`);
    console.log('');

    for (const shipment of sampleMissing) {
      // Get entities for this email
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', shipment.source_email_id);

      const routeTypes = ['port_of_loading', 'port_of_discharge', 'pol', 'pod', 'origin_port', 'destination_port'];
      const dateTypes = ['etd', 'eta', 'departure_date', 'arrival_date', 'estimated_departure', 'estimated_arrival'];

      const routeEntities = (entities || []).filter(e =>
        routeTypes.some(rt => e.entity_type.toLowerCase().includes(rt.toLowerCase()))
      );
      const dateEntities = (entities || []).filter(e =>
        dateTypes.some(dt => e.entity_type.toLowerCase().includes(dt.toLowerCase()))
      );

      console.log(`  Booking ${shipment.booking_number}:`);
      console.log(`    Source email: ${shipment.source_email_id.substring(0, 8)}...`);
      console.log(`    Total entities: ${(entities || []).length}`);
      console.log(`    Route entities: ${routeEntities.length} ${routeEntities.length > 0 ? '-> ' + routeEntities.map(e => e.entity_type + '=' + e.entity_value).join(', ') : ''}`);
      console.log(`    Date entities:  ${dateEntities.length} ${dateEntities.length > 0 ? '-> ' + dateEntities.map(e => e.entity_type + '=' + e.entity_value).join(', ') : ''}`);
      console.log('');
    }
  }

  // 4. Check entity_extractions for route/date entity types
  console.log('');
  console.log('ENTITY TYPES IN entity_extractions TABLE:');
  console.log('-'.repeat(60));

  const { data: allEntities } = await supabase
    .from('entity_extractions')
    .select('entity_type');

  const typeCounts: Record<string, number> = {};
  for (const e of allEntities || []) {
    typeCounts[e.entity_type] = (typeCounts[e.entity_type] || 0) + 1;
  }

  // Filter to route/date related types
  const routeDateTypes = Object.entries(typeCounts)
    .filter(([type]) => {
      const lower = type.toLowerCase();
      return lower.includes('port') || lower.includes('pol') || lower.includes('pod') ||
             lower.includes('etd') || lower.includes('eta') || lower.includes('departure') ||
             lower.includes('arrival') || lower.includes('vessel') || lower.includes('route');
    })
    .sort((a, b) => b[1] - a[1]);

  if (routeDateTypes.length === 0) {
    console.log('  NO route/date entity types found in entity_extractions!');
    console.log('');
    console.log('  ROOT CAUSE: AI extraction is NOT extracting POL/POD/ETD/ETA.');
    console.log('  The classification/extraction prompts need to include these fields.');
  } else {
    console.log('  Route/date related entity types:');
    for (const [type, count] of routeDateTypes) {
      console.log(`    ${type.padEnd(25)} ${count}`);
    }
  }

  // 5. Show ALL entity types for reference
  console.log('');
  console.log('ALL ENTITY TYPES (top 20):');
  console.log('-'.repeat(60));

  const allTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [type, count] of allTypes) {
    console.log(`  ${type.padEnd(30)} ${count}`);
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('                           ANALYSIS COMPLETE');
  console.log('='.repeat(80));
}

analyze().catch(console.error);
