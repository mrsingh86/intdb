/**
 * Analyze shipment linking distribution by identifier type
 *
 * Shows how documents are matched to shipments:
 * - By booking number
 * - By BL number
 * - By container number
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function analyze() {
  console.log('Fetching data from Supabase...\n');

  // Fetch all linked documents
  const { data: links, error: linksError } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id');

  if (linksError) throw linksError;

  // Fetch all shipments with identifiers
  const { data: shipments, error: shipmentsError } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, container_number_primary');

  if (shipmentsError) throw shipmentsError;

  // Fetch entity extractions for linking identifiers
  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number');

  const { data: blEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'bl_number');

  const { data: containerEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'container_number');

  // Build lookups
  const shipmentMap = new Map(shipments?.map(s => [s.id, s]) || []);

  const emailIdentifiers: Record<string, { booking: string[]; bl: string[]; container: string[] }> = {};

  bookingEntities?.forEach(e => {
    if (!emailIdentifiers[e.email_id]) emailIdentifiers[e.email_id] = { booking: [], bl: [], container: [] };
    emailIdentifiers[e.email_id].booking.push(e.entity_value);
  });

  blEntities?.forEach(e => {
    if (!emailIdentifiers[e.email_id]) emailIdentifiers[e.email_id] = { booking: [], bl: [], container: [] };
    emailIdentifiers[e.email_id].bl.push(e.entity_value);
  });

  containerEntities?.forEach(e => {
    if (!emailIdentifiers[e.email_id]) emailIdentifiers[e.email_id] = { booking: [], bl: [], container: [] };
    emailIdentifiers[e.email_id].container.push(e.entity_value);
  });

  // Analyze matches
  const stats = {
    by_booking: 0,
    by_bl: 0,
    by_container: 0,
    by_booking_bl: 0,
    by_booking_container: 0,
    by_bl_container: 0,
    by_all_three: 0,
    no_entities: 0,
    has_entities_no_match: 0
  };

  links?.forEach(link => {
    const shipment = shipmentMap.get(link.shipment_id);
    const ids = emailIdentifiers[link.email_id];

    if (!shipment) return;

    if (!ids) {
      stats.no_entities++;
      return;
    }

    const matched: string[] = [];

    if (shipment.booking_number && ids.booking.includes(shipment.booking_number)) {
      matched.push('booking');
    }
    if (shipment.bl_number && ids.bl.includes(shipment.bl_number)) {
      matched.push('bl');
    }
    if (shipment.container_number_primary && ids.container.includes(shipment.container_number_primary)) {
      matched.push('container');
    }

    if (matched.length === 0) {
      stats.has_entities_no_match++;
    } else if (matched.length === 1) {
      stats[`by_${matched[0]}` as keyof typeof stats]++;
    } else if (matched.length === 2) {
      const key = `by_${matched.sort().join('_')}` as keyof typeof stats;
      if (key in stats) stats[key]++;
    } else {
      stats.by_all_three++;
    }
  });

  // Print results
  const total = links?.length || 0;
  const pct = (n: number) => ((n / total) * 100).toFixed(1);

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║        SHIPMENT LINKING DISTRIBUTION BY IDENTIFIER TYPE          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Total linked documents: ${total}`);
  console.log('');
  console.log('MATCHED BY SINGLE IDENTIFIER:');
  console.log('─'.repeat(55));
  console.log(`  Booking Number only:     ${stats.by_booking.toString().padStart(5)}  (${pct(stats.by_booking)}%)`);
  console.log(`  BL Number only:          ${stats.by_bl.toString().padStart(5)}  (${pct(stats.by_bl)}%)`);
  console.log(`  Container Number only:   ${stats.by_container.toString().padStart(5)}  (${pct(stats.by_container)}%)`);
  console.log('');
  console.log('MATCHED BY MULTIPLE IDENTIFIERS:');
  console.log('─'.repeat(55));
  console.log(`  Booking + BL:            ${stats.by_booking_bl.toString().padStart(5)}  (${pct(stats.by_booking_bl)}%)`);
  console.log(`  Booking + Container:     ${stats.by_booking_container.toString().padStart(5)}  (${pct(stats.by_booking_container)}%)`);
  console.log(`  BL + Container:          ${stats.by_bl_container.toString().padStart(5)}  (${pct(stats.by_bl_container)}%)`);
  console.log(`  All three:               ${stats.by_all_three.toString().padStart(5)}  (${pct(stats.by_all_three)}%)`);
  console.log('');
  console.log('NOT MATCHED:');
  console.log('─'.repeat(55));
  console.log(`  No entities extracted:   ${stats.no_entities.toString().padStart(5)}  (${pct(stats.no_entities)}%)`);
  console.log(`  Has entities, no match:  ${stats.has_entities_no_match.toString().padStart(5)}  (${pct(stats.has_entities_no_match)}%)`);

  const totalMatched = stats.by_booking + stats.by_bl + stats.by_container +
    stats.by_booking_bl + stats.by_booking_container + stats.by_bl_container + stats.by_all_three;

  console.log('');
  console.log('═'.repeat(55));
  console.log('SUMMARY:');
  console.log(`  Traceable matches:       ${totalMatched.toString().padStart(5)}  (${pct(totalMatched)}%)`);
  console.log(`  Untraceable (legacy):    ${(stats.no_entities + stats.has_entities_no_match).toString().padStart(5)}  (${pct(stats.no_entities + stats.has_entities_no_match)}%)`);
  console.log('');
  console.log('SHIPMENT IDENTIFIER COVERAGE:');
  console.log('─'.repeat(55));
  console.log(`  With Booking #:          ${shipments?.filter(s => s.booking_number).length.toString().padStart(5)}  of ${shipments?.length}`);
  console.log(`  With BL #:               ${shipments?.filter(s => s.bl_number).length.toString().padStart(5)}  of ${shipments?.length}`);
  console.log(`  With Container #:        ${shipments?.filter(s => s.container_number_primary).length.toString().padStart(5)}  of ${shipments?.length}`);
  console.log('');
  console.log('ENTITY EXTRACTION COVERAGE:');
  console.log('─'.repeat(55));
  console.log(`  Emails with booking #:   ${new Set(bookingEntities?.map(e => e.email_id)).size}`);
  console.log(`  Emails with BL #:        ${new Set(blEntities?.map(e => e.email_id)).size}`);
  console.log(`  Emails with container #: ${new Set(containerEntities?.map(e => e.email_id)).size}`);
}

analyze().catch(console.error);
