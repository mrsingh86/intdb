#!/usr/bin/env npx tsx
/**
 * Show ONLY booking confirmation emails for success vs failed cases
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function showBookingConfirmations() {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║   BOOKING CONFIRMATION EMAILS - SUCCESS vs FAILED COMPARISON       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get booking confirmation emails
  const { data: bcClassifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  const bcEmailIds = bcClassifications?.map(c => c.email_id) || [];
  console.log('Total booking confirmation emails:', bcEmailIds.length);

  // Get these emails with details
  const { data: bcEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, sender_email')
    .in('id', bcEmailIds);

  // Get all shipments
  const { data: shipments } = await supabase.from('shipments').select('*');

  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  // For each carrier, find booking confirmation that led to success vs one that didn't
  for (const carrier of carriers || []) {
    console.log('\n' + '═'.repeat(80));
    console.log(`CARRIER: ${carrier.carrier_name}`);
    console.log('═'.repeat(80));

    const carrierShipments = shipments?.filter(s => s.carrier_id === carrier.id) || [];

    // Find shipment WITH all cutoffs
    const successShipment = carrierShipments.find(s =>
      s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff
    );

    // Find shipment WITHOUT any cutoffs
    const failedShipment = carrierShipments.find(s =>
      s.si_cutoff === null && s.vgm_cutoff === null && s.cargo_cutoff === null
    );

    // For SUCCESS shipment - find its booking confirmation email
    if (successShipment) {
      console.log('\n✅ SUCCESS SHIPMENT:');
      console.log(`   Booking: ${successShipment.booking_number}`);
      console.log(`   SI: ${successShipment.si_cutoff} | VGM: ${successShipment.vgm_cutoff} | Cargo: ${successShipment.cargo_cutoff}`);

      // Find booking confirmation for this shipment
      const bn = successShipment.booking_number || '';
      const searchTerm = bn.substring(0, Math.min(bn.length, 8));

      const matchingBc = bcEmails?.find(e =>
        e.subject?.includes(searchTerm) || e.body_text?.includes(searchTerm)
      );

      if (matchingBc) {
        console.log('\n   BOOKING CONFIRMATION EMAIL FOUND:');
        console.log(`   Subject: ${matchingBc.subject}`);
        console.log(`   From: ${matchingBc.sender_email}`);
        console.log(`   Body length: ${matchingBc.body_text?.length || 0} chars`);

        if (matchingBc.body_text && matchingBc.body_text.length > 0) {
          console.log('\n   --- EMAIL CONTENT ---');
          console.log(matchingBc.body_text.substring(0, 3000));
          if (matchingBc.body_text.length > 3000) console.log('   ... [truncated]');
        }

        // Check for PDF
        const { data: pdfs } = await supabase
          .from('raw_attachments')
          .select('filename, extracted_text')
          .eq('email_id', matchingBc.id)
          .ilike('mime_type', '%pdf%');

        if (pdfs && pdfs.length > 0) {
          console.log(`\n   --- PDF: ${pdfs[0].filename} ---`);
          if (pdfs[0].extracted_text) {
            console.log(pdfs[0].extracted_text.substring(0, 2000));
          }
        }
      } else {
        console.log('\n   [No booking confirmation email found for this shipment]');
      }
    }

    // For FAILED shipment - find its booking confirmation email (if any)
    if (failedShipment) {
      console.log('\n\n❌ FAILED SHIPMENT:');
      console.log(`   Booking: ${failedShipment.booking_number}`);
      console.log(`   SI: NULL | VGM: NULL | Cargo: NULL`);

      const bn = failedShipment.booking_number || '';
      const searchTerm = bn.substring(0, Math.min(bn.length, 8));

      const matchingBc = bcEmails?.find(e =>
        e.subject?.includes(searchTerm) || e.body_text?.includes(searchTerm)
      );

      if (matchingBc) {
        console.log('\n   BOOKING CONFIRMATION EMAIL FOUND:');
        console.log(`   Subject: ${matchingBc.subject}`);
        console.log(`   From: ${matchingBc.sender_email}`);
        console.log(`   Body length: ${matchingBc.body_text?.length || 0} chars`);

        if (matchingBc.body_text && matchingBc.body_text.length > 0) {
          console.log('\n   --- EMAIL CONTENT ---');
          console.log(matchingBc.body_text.substring(0, 3000));
          if (matchingBc.body_text.length > 3000) console.log('   ... [truncated]');
        } else {
          console.log('\n   [EMAIL BODY IS EMPTY - 0 chars]');
        }

        // Check for PDF
        const { data: pdfs } = await supabase
          .from('raw_attachments')
          .select('filename, extracted_text')
          .eq('email_id', matchingBc.id)
          .ilike('mime_type', '%pdf%');

        if (pdfs && pdfs.length > 0) {
          console.log(`\n   --- PDF: ${pdfs[0].filename} ---`);
          if (pdfs[0].extracted_text) {
            console.log(pdfs[0].extracted_text.substring(0, 2000));
          } else {
            console.log('   [No extracted text from PDF]');
          }
        } else {
          console.log('\n   [NO PDF ATTACHMENTS]');
        }
      } else {
        console.log('\n   [NO BOOKING CONFIRMATION EMAIL EXISTS FOR THIS SHIPMENT]');
        console.log('   This shipment only has other document types (arrival notices, invoices, etc.)');
      }
    }
  }
}

showBookingConfirmations().catch(console.error);
