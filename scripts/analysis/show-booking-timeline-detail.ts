/**
 * Show Booking Timeline with True Sender
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function showBookingDetail(bookingNumber: string) {
  console.log(`\n═══════════════════════════════════════════════════════════════════════════════════════`);
  console.log(`BOOKING: ${bookingNumber} - DOCUMENT TIMELINE`);
  console.log(`═══════════════════════════════════════════════════════════════════════════════════════\n`);

  // Find shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('booking_number', bookingNumber)
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  // Get linked documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('email_id, document_type, is_primary')
    .eq('shipment_id', shipment.id);

  const emailIds = docs?.map(d => d.email_id) || [];

  // Get email details with true_sender
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender, received_at')
    .in('id', emailIds)
    .order('received_at', { ascending: true });

  // Create lookup for doc info
  const docMap = new Map(docs?.map(d => [d.email_id, d]) || []);

  // Show cutoffs
  console.log('┌─ CUTOFFS ─────────────────────────────────────────────────────────────────────────────┐');
  console.log(`│  SI Cutoff:    ${shipment.si_cutoff || '---'}`.padEnd(90) + '│');
  console.log(`│  VGM Cutoff:   ${shipment.vgm_cutoff || '---'}`.padEnd(90) + '│');
  console.log(`│  Cargo Cutoff: ${shipment.cargo_cutoff || '---'}`.padEnd(90) + '│');
  console.log('└───────────────────────────────────────────────────────────────────────────────────────┘\n');

  // Show timeline
  console.log('┌─ DOCUMENT TIMELINE (Chronological Order) ────────────────────────────────────────────┐');
  console.log('│                                                                                      │');

  for (const email of emails || []) {
    const doc = docMap.get(email.id);
    const primary = doc?.is_primary ? '★' : ' ';
    const docType = (doc?.document_type || 'unknown').padEnd(22);

    // Format received date
    const received = new Date(email.received_at);
    const dateStr = received.toLocaleString('en-IN', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    // Determine sender type
    const sender = email.true_sender || email.sender_email;
    const senderLower = sender.toLowerCase();

    let senderType = 'INTERNAL';
    let senderDisplay = sender;

    if (senderLower.includes('hlag.com') || senderLower.includes('hapag')) {
      senderType = 'HAPAG-LLOYD';
      senderDisplay = sender;
    } else if (senderLower.includes('maersk')) {
      senderType = 'MAERSK';
      senderDisplay = sender;
    } else if (senderLower.includes('intoglo')) {
      senderType = 'INTOGLO';
      senderDisplay = sender;
    }

    const subject = email.subject?.substring(0, 45) || 'N/A';

    console.log(`│ ${primary} ${dateStr.padEnd(14)} │ ${docType} │ ${senderType.padEnd(12)} │`);
    console.log(`│                    │ ${subject.padEnd(22)} │ ${senderDisplay.substring(0, 35).padEnd(35)} │`);
    console.log('│                    │                        │                                     │');
  }

  console.log('└───────────────────────────────────────────────────────────────────────────────────────┘');

  // Explain the flow
  console.log('\n📝 DOCUMENT FLOW EXPLANATION:');
  console.log('───────────────────────────────────────────────────────────────────────────────────────');

  // Group by type and sender
  const internalDocs = emails?.filter(e => {
    const s = (e.true_sender || e.sender_email).toLowerCase();
    return s.includes('intoglo') || s.includes('pricing');
  }) || [];

  const carrierDocs = emails?.filter(e => {
    const s = (e.true_sender || e.sender_email).toLowerCase();
    return s.includes('hlag') || s.includes('hapag') || s.includes('maersk');
  }) || [];

  if (internalDocs.length > 0) {
    console.log(`\n  INTERNAL (${internalDocs.length} emails):`);
    internalDocs.forEach(e => {
      const doc = docMap.get(e.id);
      console.log(`    → ${doc?.document_type}: ${e.subject?.substring(0, 50)}...`);
    });
  }

  if (carrierDocs.length > 0) {
    console.log(`\n  CARRIER (${carrierDocs.length} emails):`);
    carrierDocs.forEach(e => {
      const doc = docMap.get(e.id);
      console.log(`    → ${doc?.document_type}: ${e.subject?.substring(0, 50)}...`);
    });
  }

  console.log('\n  NOTE: "booking_amendment" from INTOGLO = internal change request');
  console.log('        "booking_confirmation" from HAPAG = carrier official confirmation');
}

// Show for booking 22970937
showBookingDetail('22970937').catch(console.error);
