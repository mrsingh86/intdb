import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const now = new Date();

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('RECOMMENDED STATUS UPDATES');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Get all shipments with their documents
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, status, etd, eta');

  const recommendations: {
    booking: string;
    currentStatus: string;
    recommendedStatus: string;
    reason: string;
  }[] = [];

  for (const s of shipments || []) {
    // Get documents for this shipment
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type')
      .eq('shipment_id', s.id);

    const docTypes = new Set(docs?.map(d => d.document_type) || []);
    const etd = s.etd ? new Date(s.etd) : null;
    const eta = s.eta ? new Date(s.eta) : null;

    // Rule 1: Draft → Booked (has booking_confirmation)
    if (s.status === 'draft' && docTypes.has('booking_confirmation')) {
      recommendations.push({
        booking: s.booking_number,
        currentStatus: 'draft',
        recommendedStatus: 'booked',
        reason: 'Has booking_confirmation document'
      });
    }

    // Rule 2: Booked → In Transit (ETD passed OR has BL)
    if (s.status === 'booked') {
      if (etd && etd < now) {
        recommendations.push({
          booking: s.booking_number,
          currentStatus: 'booked',
          recommendedStatus: 'in_transit',
          reason: 'ETD (' + s.etd + ') has passed'
        });
      } else if (docTypes.has('bill_of_lading')) {
        recommendations.push({
          booking: s.booking_number,
          currentStatus: 'booked',
          recommendedStatus: 'in_transit',
          reason: 'Has bill_of_lading (BL issued = cargo shipped)'
        });
      }
    }

    // Rule 3: Draft → In Transit (ETD passed AND has booking)
    if (s.status === 'draft' && etd && etd < now && docTypes.has('booking_confirmation')) {
      // Already recommended draft→booked, but this should go to in_transit
      const existing = recommendations.find(r => r.booking === s.booking_number);
      if (existing) {
        existing.recommendedStatus = 'in_transit';
        existing.reason = 'Has booking_confirmation AND ETD (' + s.etd + ') passed';
      }
    }

    // Rule 4: In Transit → Arrived (has arrival_notice OR ETA passed significantly)
    if (s.status === 'in_transit') {
      if (docTypes.has('arrival_notice')) {
        recommendations.push({
          booking: s.booking_number,
          currentStatus: 'in_transit',
          recommendedStatus: 'arrived',
          reason: 'Has arrival_notice document'
        });
      } else if (eta && eta < now) {
        // ETA passed - might be arrived
        const daysPastETA = Math.floor((now.getTime() - eta.getTime()) / (1000 * 60 * 60 * 24));
        if (daysPastETA > 3) {
          recommendations.push({
            booking: s.booking_number,
            currentStatus: 'in_transit',
            recommendedStatus: 'arrived',
            reason: 'ETA (' + s.eta + ') passed ' + daysPastETA + ' days ago'
          });
        }
      }
    }
  }

  // Group by recommended action
  const draftToBooked = recommendations.filter(r => r.currentStatus === 'draft' && r.recommendedStatus === 'booked');
  const draftToTransit = recommendations.filter(r => r.currentStatus === 'draft' && r.recommendedStatus === 'in_transit');
  const bookedToTransit = recommendations.filter(r => r.currentStatus === 'booked' && r.recommendedStatus === 'in_transit');
  const transitToArrived = recommendations.filter(r => r.currentStatus === 'in_transit' && r.recommendedStatus === 'arrived');

  console.log('\n1. DRAFT → BOOKED (' + draftToBooked.length + ' shipments):');
  draftToBooked.slice(0, 5).forEach(r => {
    console.log('   ' + r.booking + ': ' + r.reason);
  });
  if (draftToBooked.length > 5) console.log('   ... and ' + (draftToBooked.length - 5) + ' more');

  console.log('\n2. DRAFT → IN_TRANSIT (' + draftToTransit.length + ' shipments):');
  draftToTransit.forEach(r => {
    console.log('   ' + r.booking + ': ' + r.reason);
  });

  console.log('\n3. BOOKED → IN_TRANSIT (' + bookedToTransit.length + ' shipments):');
  bookedToTransit.forEach(r => {
    console.log('   ' + r.booking + ': ' + r.reason);
  });

  console.log('\n4. IN_TRANSIT → ARRIVED (' + transitToArrived.length + ' shipments):');
  transitToArrived.forEach(r => {
    console.log('   ' + r.booking + ': ' + r.reason);
  });

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SUMMARY: ' + recommendations.length + ' status updates recommended');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // SQL to apply updates
  console.log('\n-- SQL TO APPLY UPDATES:');

  if (draftToBooked.length > 0) {
    const bookings = draftToBooked.map(r => "'" + r.booking + "'").join(', ');
    console.log('\n-- Draft → Booked');
    console.log("UPDATE shipments SET status = 'booked' WHERE booking_number IN (" + bookings + ") AND status = 'draft';");
  }

  if (draftToTransit.length > 0) {
    const bookings = draftToTransit.map(r => "'" + r.booking + "'").join(', ');
    console.log('\n-- Draft → In Transit');
    console.log("UPDATE shipments SET status = 'in_transit' WHERE booking_number IN (" + bookings + ") AND status = 'draft';");
  }

  if (bookedToTransit.length > 0) {
    const bookings = bookedToTransit.map(r => "'" + r.booking + "'").join(', ');
    console.log('\n-- Booked → In Transit');
    console.log("UPDATE shipments SET status = 'in_transit' WHERE booking_number IN (" + bookings + ") AND status = 'booked';");
  }

  if (transitToArrived.length > 0) {
    const bookings = transitToArrived.map(r => "'" + r.booking + "'").join(', ');
    console.log('\n-- In Transit → Arrived');
    console.log("UPDATE shipments SET status = 'arrived' WHERE booking_number IN (" + bookings + ") AND status = 'in_transit';");
  }
}

main().catch(console.error);
