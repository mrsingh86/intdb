/**
 * Final Root Cause Analysis: Why carrier BC emails are not creating shipments
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function analyze() {
  console.log('='.repeat(80));
  console.log('FINAL ROOT CAUSE ANALYSIS');
  console.log('='.repeat(80));
  console.log('');

  // 1. Get the specific unlinked "via" BC emails
  const unlinkedBookings = [
    '263805268',    // Maersk in.export
    '6440918980',   // COSCO coscon
    '6440918970',   // COSCO coscon
    'INEPBC26016106', // CMA CGM - actually this is an invoice number, not booking
  ];

  for (const bookingNum of unlinkedBookings) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Analyzing booking: ${bookingNum}`);
    console.log('='.repeat(60));

    // Check if shipment exists
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, booking_number, workflow_state, created_from_email_id')
      .eq('booking_number', bookingNum)
      .single();

    if (shipment) {
      console.log(`\nShipment EXISTS: ${shipment.id}`);
      console.log(`  Workflow state: ${shipment.workflow_state}`);
      console.log(`  Created from email: ${shipment.created_from_email_id}`);

      // Check what docs are linked
      const { data: docs } = await supabase
        .from('shipment_documents')
        .select('email_id, document_type')
        .eq('shipment_id', shipment.id);

      console.log(`  Linked documents: ${docs?.length || 0}`);
      for (const doc of docs || []) {
        console.log(`    - ${doc.document_type} (${doc.email_id.substring(0, 8)}...)`);
      }
    } else {
      console.log(`\nShipment DOES NOT EXIST for ${bookingNum}`);
    }

    // Find emails with this booking number in entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id')
      .eq('entity_type', 'booking_number')
      .eq('entity_value', bookingNum);

    console.log(`\nEmails with booking number ${bookingNum}: ${entities?.length || 0}`);

    for (const entity of entities || []) {
      // Get email details
      const { data: email } = await supabase
        .from('raw_emails')
        .select('id, subject, sender_email, true_sender_email, processing_status, received_at')
        .eq('id', entity.email_id)
        .single();

      // Get classification
      const { data: classification } = await supabase
        .from('document_classifications')
        .select('document_type, confidence_score')
        .eq('email_id', entity.email_id)
        .single();

      // Check if linked
      const { data: link } = await supabase
        .from('shipment_documents')
        .select('shipment_id')
        .eq('email_id', entity.email_id)
        .single();

      console.log(`\n  Email: ${entity.email_id.substring(0, 8)}...`);
      console.log(`    Subject: ${email?.subject?.substring(0, 50)}...`);
      console.log(`    Sender: ${email?.sender_email}`);
      console.log(`    True Sender: ${email?.true_sender_email || 'NULL'}`);
      console.log(`    Processing Status: ${email?.processing_status}`);
      console.log(`    Classification: ${classification?.document_type || 'NONE'} (${classification?.confidence_score || 0}%)`);
      console.log(`    Linked to shipment: ${link ? link.shipment_id.substring(0, 8) + '...' : 'NO'}`);

      // Simulate the carrier detection
      const senderEmail = email?.sender_email || '';
      const trueSender = email?.true_sender_email || '';

      // isDirectCarrierEmail check
      const CARRIER_DOMAINS = ['maersk.com', 'hlag.com', 'cma-cgm.com', 'coscon.com', 'msc.com'];
      const checkDomain = (addr: string) => {
        const domain = addr.toLowerCase().split('@')[1] || '';
        return CARRIER_DOMAINS.some(d => domain.includes(d));
      };
      const isDirectCarrier = trueSender ? checkDomain(trueSender) : checkDomain(senderEmail);

      // isKnownCarrierDisplayName check
      const maerskPatterns = ['in.export', 'maersk line export', 'donotreply.*maersk'];
      const isKnownDisplay = maerskPatterns.some(p => new RegExp(p, 'i').test(senderEmail)) ||
                             /india@service\.hlag|hapag|hlcu/i.test(senderEmail) ||
                             /cma cgm website|cma cgm.*noreply/i.test(senderEmail);

      console.log(`    isDirectCarrierEmail: ${isDirectCarrier}`);
      console.log(`    isKnownCarrierDisplayName: ${isKnownDisplay}`);

      // Check for COSCO pattern specifically
      const isCosco = /coscon|cosco/i.test(senderEmail);
      console.log(`    Contains 'coscon/cosco': ${isCosco}`);

      if (!isDirectCarrier && !isKnownDisplay && isCosco) {
        console.log(`    >>> MISSING PATTERN: COSCO "coscon" display name not detected!`);
      }
    }
  }

  // 2. Summary: What patterns are missing?
  console.log('\n');
  console.log('='.repeat(80));
  console.log('ROOT CAUSES IDENTIFIED');
  console.log('='.repeat(80));
  console.log(`
1. MISSING COSCO PATTERN in isKnownCarrierDisplayName():
   - Emails like "coscon via Operations Intoglo <ops@intoglo.com>" are not detected
   - Need to add: /coscon|cosco/i pattern

2. Some "via" emails have true_sender_email = NULL:
   - The original sender header is not being extracted from Gmail
   - Workaround: Parse display name from sender_email for known carrier patterns

3. CLASSIFICATION ISSUE:
   - Some emails classified as "booking_confirmation" are actually:
     - Invoice emails (INEPBC26016106 is an invoice number, not booking)
     - Booking requests (internal emails asking for booking)
   - These should NOT create shipments

FIX REQUIRED:
-------------
1. Add COSCO pattern to isKnownCarrierDisplayName():
   if (/coscon|cosco/i.test(senderLower)) {
     return true;
   }

2. Consider adding more carrier display name patterns:
   - ONE: /one-line|ocean network/i
   - Evergreen: /evergreen/i
   - MSC: /msc|mediterranean shipping/i
  `);

  console.log('\n');
  console.log('='.repeat(80));
  console.log('ANALYSIS COMPLETE');
  console.log('='.repeat(80));
}

analyze().catch(console.error);
