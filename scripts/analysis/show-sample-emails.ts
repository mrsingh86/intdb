#!/usr/bin/env npx tsx
/**
 * Show sample emails for successful and failed extraction cases
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function showSamples() {
  // Get carriers
  const { data: carriers } = await supabase.from('carriers').select('id, carrier_name');
  const carrierMap = new Map(carriers?.map(c => [c.id, c.carrier_name]));

  // Get all shipments
  const { data: shipments } = await supabase.from('shipments').select('*');

  for (const carrier of carriers || []) {
    console.log('\n' + '═'.repeat(80));
    console.log(`CARRIER: ${carrier.carrier_name}`);
    console.log('═'.repeat(80));

    const carrierShipments = shipments?.filter(s => s.carrier_id === carrier.id) || [];

    // SUCCESS CASE - shipment with all 3 cutoffs
    const successShipment = carrierShipments.find(s =>
      s.si_cutoff && s.vgm_cutoff && s.cargo_cutoff
    );

    // FAILED CASE - shipment missing all cutoffs
    const failedShipment = carrierShipments.find(s =>
      s.si_cutoff === null && s.vgm_cutoff === null && s.cargo_cutoff === null
    );

    // Show SUCCESS case
    if (successShipment) {
      console.log('\n✅ SUCCESS CASE:');
      console.log('─'.repeat(40));
      console.log(`Booking: ${successShipment.booking_number}`);
      console.log(`SI Cutoff: ${successShipment.si_cutoff}`);
      console.log(`VGM Cutoff: ${successShipment.vgm_cutoff}`);
      console.log(`Cargo Cutoff: ${successShipment.cargo_cutoff}`);

      // Find related email
      const bn = successShipment.booking_number;
      if (bn) {
        const searchTerm = bn.substring(0, Math.min(bn.length, 10));
        const { data: emails } = await supabase
          .from('raw_emails')
          .select('id, subject, body_text, sender_email')
          .or(`subject.ilike.%${searchTerm}%,body_text.ilike.%${searchTerm}%`)
          .limit(1);

        if (emails && emails.length > 0) {
          const email = emails[0];
          console.log(`\nEMAIL SUBJECT: ${email.subject}`);
          console.log(`FROM: ${email.sender_email}`);
          console.log(`BODY LENGTH: ${email.body_text?.length || 0} chars`);

          // Show body excerpt
          const body = email.body_text || '';
          if (body.length > 0) {
            console.log('\n--- EMAIL BODY (first 2000 chars) ---');
            console.log(body.substring(0, 2000));
            if (body.length > 2000) console.log('\n... [truncated]');
          }

          // Check for PDF attachments
          const { data: pdfs } = await supabase
            .from('raw_attachments')
            .select('filename, extracted_text')
            .eq('email_id', email.id)
            .ilike('mime_type', '%pdf%');

          if (pdfs && pdfs.length > 0) {
            console.log(`\n--- PDF ATTACHMENTS (${pdfs.length}) ---`);
            for (const pdf of pdfs.slice(0, 1)) {
              console.log(`Filename: ${pdf.filename}`);
              if (pdf.extracted_text) {
                console.log(`Text (first 1500 chars):`);
                console.log(pdf.extracted_text.substring(0, 1500));
                if (pdf.extracted_text.length > 1500) console.log('... [truncated]');
              }
            }
          }
        } else {
          console.log('\n[No related email found in database]');
        }
      }
    } else {
      console.log('\n✅ SUCCESS CASE: None found for this carrier');
    }

    // Show FAILED case
    if (failedShipment) {
      console.log('\n\n❌ FAILED CASE:');
      console.log('─'.repeat(40));
      console.log(`Booking: ${failedShipment.booking_number}`);
      console.log(`SI Cutoff: ${failedShipment.si_cutoff || 'NULL'}`);
      console.log(`VGM Cutoff: ${failedShipment.vgm_cutoff || 'NULL'}`);
      console.log(`Cargo Cutoff: ${failedShipment.cargo_cutoff || 'NULL'}`);

      // Find related email
      const bn = failedShipment.booking_number;
      if (bn) {
        const searchTerm = bn.substring(0, Math.min(bn.length, 10));
        const { data: emails } = await supabase
          .from('raw_emails')
          .select('id, subject, body_text, sender_email')
          .or(`subject.ilike.%${searchTerm}%,body_text.ilike.%${searchTerm}%`)
          .limit(1);

        if (emails && emails.length > 0) {
          const email = emails[0];
          console.log(`\nEMAIL SUBJECT: ${email.subject}`);
          console.log(`FROM: ${email.sender_email}`);
          console.log(`BODY LENGTH: ${email.body_text?.length || 0} chars`);

          const body = email.body_text || '';
          if (body.length > 0) {
            console.log('\n--- EMAIL BODY (first 2000 chars) ---');
            console.log(body.substring(0, 2000));
            if (body.length > 2000) console.log('\n... [truncated]');
          }

          // Check for PDF attachments
          const { data: pdfs } = await supabase
            .from('raw_attachments')
            .select('filename, extracted_text')
            .eq('email_id', email.id)
            .ilike('mime_type', '%pdf%');

          if (pdfs && pdfs.length > 0) {
            console.log(`\n--- PDF ATTACHMENTS (${pdfs.length}) ---`);
            for (const pdf of pdfs.slice(0, 1)) {
              console.log(`Filename: ${pdf.filename}`);
              if (pdf.extracted_text) {
                console.log(`Text (first 1500 chars):`);
                console.log(pdf.extracted_text.substring(0, 1500));
                if (pdf.extracted_text.length > 1500) console.log('... [truncated]');
              } else {
                console.log('[No extracted text]');
              }
            }
          } else {
            console.log('\n[No PDF attachments]');
          }
        } else {
          console.log('\n[No related email found in database]');
        }
      }
    } else {
      console.log('\n\n❌ FAILED CASE: None found (all shipments have cutoffs!)');
    }
  }
}

showSamples().catch(console.error);
