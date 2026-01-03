/**
 * Deep Investigation: "via" Email Processing for Carrier Booking Confirmations
 *
 * Focus: Why are carrier BC emails forwarded via ops@intoglo.com not creating shipments?
 */

import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  console.log('='.repeat(80));
  console.log('DEEP INVESTIGATION: Carrier "via" Emails');
  console.log('='.repeat(80));
  console.log('');

  // Get ALL via emails with full details
  const { data: viaEmails } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject, sender_email, true_sender_email, email_direction, processing_status, received_at')
    .ilike('sender_email', '% via %')
    .order('received_at', { ascending: false });

  console.log(`Total "via" emails: ${viaEmails?.length || 0}`);
  console.log('');

  // Group by sender display name prefix (e.g., "in.export", "coscon", etc.)
  const senderGroups: Record<string, { count: number; samples: typeof viaEmails }> = {};
  for (const email of viaEmails || []) {
    // Extract display name from "Name via Group <email>"
    const match = email.sender_email.match(/^"?([^"<]+?)\s+via\s+/i);
    const displayName = match ? match[1].trim() : 'unknown';
    if (!senderGroups[displayName]) {
      senderGroups[displayName] = { count: 0, samples: [] };
    }
    senderGroups[displayName].count++;
    if ((senderGroups[displayName].samples?.length || 0) < 3) {
      senderGroups[displayName].samples?.push(email);
    }
  }

  console.log('Sender Display Name Distribution:');
  Object.entries(senderGroups)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([name, { count }]) => {
      console.log(`  ${name}: ${count}`);
    });
  console.log('');

  // ========================================================================
  // KEY INSIGHT: Check for carrier patterns in display names
  // ========================================================================
  console.log('CARRIER PATTERN ANALYSIS IN "via" EMAILS:');
  console.log('-'.repeat(40));

  // Known carrier patterns in display names
  const carrierDisplayPatterns = [
    { pattern: /in\.export/i, carrier: 'Maersk' },
    { pattern: /maersk/i, carrier: 'Maersk' },
    { pattern: /coscon/i, carrier: 'COSCO' },
    { pattern: /hapag|hlag/i, carrier: 'Hapag-Lloyd' },
    { pattern: /cma[\s-]?cgm/i, carrier: 'CMA CGM' },
    { pattern: /msc/i, carrier: 'MSC' },
  ];

  for (const { pattern, carrier } of carrierDisplayPatterns) {
    const matching = (viaEmails || []).filter(e => pattern.test(e.sender_email));
    console.log(`\n${carrier} pattern (${pattern.source}):`);
    console.log(`  Total emails: ${matching.length}`);

    if (matching.length > 0) {
      // Get classifications for these
      const ids = matching.map(e => e.id);
      const { data: classifications } = await supabase
        .from('document_classifications')
        .select('email_id, document_type, confidence_score')
        .in('email_id', ids);

      const bcClassifications = classifications?.filter(c => c.document_type === 'booking_confirmation') || [];
      console.log(`  Classified as booking_confirmation: ${bcClassifications.length}`);

      // Check linking
      const { data: links } = await supabase
        .from('shipment_documents')
        .select('email_id, shipment_id')
        .in('email_id', ids);

      console.log(`  Linked to shipments: ${links?.length || 0}`);

      // Sample unlinked
      const linkedIds = new Set((links || []).map(l => l.email_id));
      const unlinkedBCs = bcClassifications.filter(c => !linkedIds.has(c.email_id));

      if (unlinkedBCs.length > 0) {
        console.log(`\n  UNLINKED BC emails from ${carrier}:`);
        for (const bc of unlinkedBCs.slice(0, 3)) {
          const email = matching.find(e => e.id === bc.email_id);
          if (email) {
            console.log(`\n    Email: ${email.id.substring(0, 8)}...`);
            console.log(`    Subject: ${email.subject?.substring(0, 60)}...`);
            console.log(`    Sender: ${email.sender_email}`);
            console.log(`    True Sender: ${email.true_sender_email || '(NONE)'}`);

            // Get entities
            const { data: entities } = await supabase
              .from('entity_extractions')
              .select('entity_type, entity_value')
              .eq('email_id', email.id);

            const bookingNum = entities?.find(e => e.entity_type === 'booking_number');
            console.log(`    Booking Number: ${bookingNum?.entity_value || 'NOT EXTRACTED'}`);

            if (bookingNum?.entity_value) {
              // Check if shipment exists
              const { data: ship } = await supabase
                .from('shipments')
                .select('id, workflow_state')
                .eq('booking_number', bookingNum.entity_value)
                .single();

              if (ship) {
                console.log(`    >>> SHIPMENT EXISTS: ${ship.id.substring(0, 8)}...`);
                console.log(`    >>> BUT EMAIL NOT LINKED!`);
              } else {
                console.log(`    >>> NO SHIPMENT EXISTS`);
                console.log(`    >>> PROBLEM: Carrier BC should create shipment!`);
              }
            }
          }
        }
      }
    }
  }

  // ========================================================================
  // CRITICAL: Check isDirectCarrierEmail logic for these emails
  // ========================================================================
  console.log('\n');
  console.log('='.repeat(80));
  console.log('CRITICAL CHECK: isDirectCarrierEmail() Logic Analysis');
  console.log('='.repeat(80));

  // The orchestrator uses isDirectCarrierEmail() to decide if a BC should create a shipment
  // Let's check what happens for "via" emails

  const CARRIER_DOMAINS = [
    'maersk.com', 'sealand.com',
    'hapag-lloyd.com', 'hlag.com', 'hlag.cloud', 'service.hlag.com',
    'cma-cgm.com', 'apl.com',
    'coscon.com', 'oocl.com',
    'msc.com',
  ];

  console.log('\nSimulating isDirectCarrierEmail() for sample "via" emails:');

  // Get Maersk-like "via" emails
  const maerskViaEmails = (viaEmails || []).filter(e =>
    e.sender_email.toLowerCase().includes('in.export') ||
    e.subject?.toLowerCase().includes('booking confirmation')
  );

  for (const email of maerskViaEmails.slice(0, 5)) {
    console.log(`\n  Email: ${email.id.substring(0, 8)}...`);
    console.log(`  Subject: ${email.subject?.substring(0, 50)}...`);
    console.log(`  sender_email: ${email.sender_email}`);
    console.log(`  true_sender_email: ${email.true_sender_email || 'NULL'}`);

    // Simulate the check
    const senderEmail = email.sender_email || '';
    const trueSender = email.true_sender_email || '';

    // Current logic in orchestrator
    const checkDomain = (addr: string) => {
      const domain = addr.toLowerCase().split('@')[1] || '';
      return CARRIER_DOMAINS.some(d => domain.includes(d));
    };

    const trueSenderIsCarrier = trueSender ? checkDomain(trueSender) : false;
    const senderIsCarrier = checkDomain(senderEmail);

    console.log(`  trueSender is carrier domain: ${trueSenderIsCarrier}`);
    console.log(`  sender is carrier domain: ${senderIsCarrier}`);
    console.log(`  >>> isDirectCarrierEmail() would return: ${trueSenderIsCarrier || senderIsCarrier}`);

    // PROBLEM: For "via" emails:
    // - sender_email is ops@intoglo.com (not carrier)
    // - true_sender_email is often NULL or not set
    // So isDirectCarrierEmail() returns FALSE, and shipment is NOT created!

    if (!trueSenderIsCarrier && !senderIsCarrier) {
      console.log(`  >>> PROBLEM: This carrier email won't create a shipment!`);

      // Check what the display name suggests
      const displayMatch = senderEmail.match(/^"?([^"<]+?)\s+via\s+/i);
      if (displayMatch) {
        console.log(`  >>> Display name "${displayMatch[1]}" suggests this IS from a carrier`);
      }
    }
  }

  // ========================================================================
  // SOLUTION ANALYSIS
  // ========================================================================
  console.log('\n');
  console.log('='.repeat(80));
  console.log('ROOT CAUSE ANALYSIS');
  console.log('='.repeat(80));
  console.log(`
  PROBLEM:
  --------
  Carrier booking confirmations forwarded through Google Groups (ops@intoglo.com)
  have the pattern:
    sender_email: "in.export via Operations Intoglo" <ops@intoglo.com>
    true_sender_email: NULL (not extracted from headers)

  The isDirectCarrierEmail() function checks:
  1. true_sender_email domain - but it's NULL
  2. sender_email domain - but it's @intoglo.com (not carrier)

  Result: Returns FALSE, so no shipment is created from these carrier emails.

  SOLUTIONS:
  ----------
  1. Extract X-Original-Sender or X-Forwarded-For from Gmail headers
     to populate true_sender_email for forwarded emails

  2. Or: Parse the display name in sender_email to detect carrier patterns
     e.g., "in.export via ..." -> Maersk
           "coscon via ..." -> COSCO

  3. Or: Use isCarrierContentBasedEmail() which checks PDF content
     for "BOOKING CONFIRMATION" heading + carrier branding

  The orchestrator already has isCarrierContentBasedEmail() but it only
  supplements isDirectCarrierEmail(), doesn't fix the missing true_sender.
  `);

  // ========================================================================
  // Check how many shipments are affected
  // ========================================================================
  console.log('\nIMPACT ASSESSMENT:');
  console.log('-'.repeat(40));

  // Count via emails that SHOULD have created shipments
  const bcViaEmails = (viaEmails || []).filter(e => {
    // Check if classified as BC
    return true; // We'll filter by classification next
  });

  // Get all classifications for via emails
  const viaEmailIds = (viaEmails || []).map(e => e.id);
  const { data: allViaClassifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('email_id', viaEmailIds);

  const viaBCEmailIds = new Set(
    allViaClassifications?.filter(c => c.document_type === 'booking_confirmation').map(c => c.email_id) || []
  );

  // Get linking status
  const { data: viaLinks } = await supabase
    .from('shipment_documents')
    .select('email_id')
    .in('email_id', viaEmailIds);

  const linkedViaEmailIds = new Set((viaLinks || []).map(l => l.email_id));

  const unlinkedViaBCs = [...viaBCEmailIds].filter(id => !linkedViaEmailIds.has(id));

  console.log(`Total "via" emails: ${viaEmails?.length || 0}`);
  console.log(`Classified as booking_confirmation: ${viaBCEmailIds.size}`);
  console.log(`Linked to shipments: ${linkedViaEmailIds.size}`);
  console.log(`UNLINKED BC "via" emails: ${unlinkedViaBCs.length}`);

  // Get booking numbers for unlinked via BCs
  if (unlinkedViaBCs.length > 0) {
    const { data: unlinkedEntities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_value')
      .in('email_id', unlinkedViaBCs)
      .eq('entity_type', 'booking_number');

    console.log(`\nBooking numbers from unlinked "via" BC emails:`);
    for (const e of unlinkedEntities || []) {
      const email = viaEmails?.find(v => v.id === e.email_id);
      console.log(`  ${e.entity_value}: ${email?.subject?.substring(0, 40)}...`);

      // Check if shipment exists
      const { data: ship } = await supabase
        .from('shipments')
        .select('id, workflow_state')
        .eq('booking_number', e.entity_value)
        .single();

      if (ship) {
        console.log(`    >>> SHIPMENT EXISTS but email not linked`);
      } else {
        console.log(`    >>> NO SHIPMENT - should have been created!`);
      }
    }
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(80));
}

investigate().catch(console.error);
