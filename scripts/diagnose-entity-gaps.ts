/**
 * Diagnose Entity Gaps
 *
 * Finds booking confirmations with entities that aren't flowing to shipments.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function diagnoseGaps() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         DIAGNOSE ENTITY GAPS                                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get all booking confirmations
  const { data: bookings } = await supabase
    .from('document_classifications')
    .select(`
      id,
      email_id,
      document_type,
      raw_emails!inner(subject, sender_email)
    `)
    .eq('document_type', 'booking_confirmation');

  if (!bookings) {
    console.error('No bookings found');
    return;
  }

  console.log(`Found ${bookings.length} booking confirmations\n`);

  // For each booking, check entities and shipment linkage
  let linkedCount = 0;
  let unlinkedCount = 0;
  let missingEntities: any[] = [];

  for (const booking of bookings) {
    // Get entities for this email
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', booking.email_id);

    const entityTypes = entities?.map(e => e.entity_type) || [];
    const hasEtd = entityTypes.includes('etd');
    const hasEta = entityTypes.includes('eta');
    const hasSiCutoff = entityTypes.includes('si_cutoff');
    const hasVgmCutoff = entityTypes.includes('vgm_cutoff');

    // Get booking number entity
    const bookingNumber = entities?.find(e => e.entity_type === 'booking_number')?.entity_value;

    // Check if linked to a shipment
    const { data: linkedShipment } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', booking.email_id)
      .single();

    const isLinked = !!linkedShipment;

    if (isLinked) {
      linkedCount++;

      // Check if shipment has the entities
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id, booking_number, etd, eta, si_cutoff, vgm_cutoff')
        .eq('id', linkedShipment.shipment_id)
        .single();

      if (shipment) {
        const missing: string[] = [];
        if (hasEtd && !shipment.etd) missing.push('etd');
        if (hasEta && !shipment.eta) missing.push('eta');
        if (hasSiCutoff && !shipment.si_cutoff) missing.push('si_cutoff');
        if (hasVgmCutoff && !shipment.vgm_cutoff) missing.push('vgm_cutoff');

        if (missing.length > 0) {
          missingEntities.push({
            bookingNumber,
            subject: (booking as any).raw_emails?.subject?.substring(0, 40),
            entityHas: entityTypes.join(', '),
            shipmentMissing: missing.join(', '),
            shipmentId: shipment.id
          });
        }
      }
    } else {
      unlinkedCount++;
      console.log(`❌ NOT LINKED: ${(booking as any).raw_emails?.subject?.substring(0, 50)}`);
      console.log(`   Booking #: ${bookingNumber || 'N/A'}`);
      console.log(`   Entities: ${entityTypes.length > 0 ? entityTypes.join(', ') : 'none'}`);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Linked to shipments:    ${linkedCount}/${bookings.length}`);
  console.log(`NOT linked:             ${unlinkedCount}/${bookings.length}`);

  if (missingEntities.length > 0) {
    console.log(`\n⚠️  ${missingEntities.length} shipments have entities not applied:`);
    for (const m of missingEntities) {
      console.log(`\n  ${m.bookingNumber || 'N/A'}: ${m.subject}...`);
      console.log(`    Entities have: ${m.entityHas}`);
      console.log(`    Shipment missing: ${m.shipmentMissing}`);
    }
  }

  // Show entity extraction stats for booking confirmations
  console.log('\n' + '═'.repeat(70));
  console.log('ENTITY EXTRACTION STATS (Booking Confirmations Only)');
  console.log('═'.repeat(70));

  const emailIds = bookings.map(b => b.email_id);
  const { data: allEntities } = await supabase
    .from('entity_extractions')
    .select('entity_type')
    .in('email_id', emailIds);

  if (allEntities) {
    const typeCounts: Record<string, number> = {};
    allEntities.forEach(e => {
      typeCounts[e.entity_type] = (typeCounts[e.entity_type] || 0) + 1;
    });

    console.log(`\nFrom ${bookings.length} booking confirmations:`);
    Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        const pct = Math.round(count / bookings.length * 100);
        console.log(`  ${type.padEnd(25)} ${String(count).padStart(3)}  (${pct}%)`);
      });
  }
}

diagnoseGaps().catch(console.error);
