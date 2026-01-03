/**
 * Investigation Script: Why Inbound Booking Confirmations Are Not Linked
 *
 * Problem: ~70 shipments have NO inbound booking confirmation linked
 * This script investigates the complete data flow.
 */

import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Type definitions
interface RawEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  sender_email: string;
  true_sender_email: string | null;
  email_direction: string | null;
  processing_status: string | null;
  received_at: string;
}

interface DocumentClassification {
  id: string;
  email_id: string;
  document_type: string;
  confidence_score: number;
}

interface EntityExtraction {
  id: string;
  email_id: string;
  entity_type: string;
  entity_value: string;
}

interface ShipmentDocument {
  email_id: string;
  shipment_id: string;
  document_type: string;
}

interface Shipment {
  id: string;
  booking_number: string | null;
  workflow_state: string | null;
  carrier_id: string | null;
  created_from_email_id: string | null;
}

// Carrier domains to check
const CARRIER_DOMAINS = [
  'maersk.com', 'sealand.com',
  'hapag-lloyd.com', 'hlag.com', 'hlag.cloud', 'service.hlag.com',
  'cma-cgm.com', 'apl.com',
  'coscon.com', 'oocl.com',
  'msc.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'one-line.com',
  'yangming.com',
  'zim.com',
];

function isCarrierEmail(senderEmail: string, trueSender: string | null): boolean {
  const check = (email: string) => {
    const lower = email.toLowerCase();
    return CARRIER_DOMAINS.some(d => lower.includes(d));
  };

  if (trueSender && check(trueSender)) return true;
  if (senderEmail && check(senderEmail)) return true;
  return false;
}

function isViaForward(senderEmail: string): boolean {
  return senderEmail.toLowerCase().includes(' via ');
}

async function investigate() {
  console.log('='.repeat(80));
  console.log('INVESTIGATION: Why Inbound Booking Confirmations Are Not Linked');
  console.log('='.repeat(80));
  console.log('');

  // ========================================================================
  // STEP 1: Get all shipments
  // ========================================================================
  console.log('STEP 1: Analyzing Shipments');
  console.log('-'.repeat(40));

  const shipments = await getAllRows<Shipment>(
    supabase, 'shipments', 'id, booking_number, workflow_state, carrier_id, created_from_email_id'
  );
  console.log(`Total shipments: ${shipments.length}`);

  // Group by workflow_state
  const stateGroups: Record<string, number> = {};
  for (const s of shipments) {
    const state = s.workflow_state || 'null';
    stateGroups[state] = (stateGroups[state] || 0) + 1;
  }
  console.log('Workflow state distribution:');
  Object.entries(stateGroups).sort((a, b) => b[1] - a[1]).forEach(([state, count]) => {
    console.log(`  ${state}: ${count}`);
  });
  console.log('');

  // ========================================================================
  // STEP 2: Get all shipment_documents
  // ========================================================================
  console.log('STEP 2: Analyzing Shipment Documents (Linked Emails)');
  console.log('-'.repeat(40));

  const shipmentDocs = await getAllRows<ShipmentDocument>(
    supabase, 'shipment_documents', 'email_id, shipment_id, document_type'
  );
  console.log(`Total shipment_documents: ${shipmentDocs.length}`);

  // Group by document_type
  const docTypeGroups: Record<string, number> = {};
  for (const d of shipmentDocs) {
    const type = d.document_type || 'null';
    docTypeGroups[type] = (docTypeGroups[type] || 0) + 1;
  }
  console.log('Document type distribution in shipment_documents:');
  Object.entries(docTypeGroups).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  console.log('');

  // Find shipments WITH booking_confirmation linked
  const shipmentsWithBC = new Set<string>();
  shipmentDocs.filter(d => d.document_type === 'booking_confirmation')
    .forEach(d => shipmentsWithBC.add(d.shipment_id));
  console.log(`Shipments WITH booking_confirmation linked: ${shipmentsWithBC.size}`);
  console.log(`Shipments WITHOUT booking_confirmation linked: ${shipments.length - shipmentsWithBC.size}`);
  console.log('');

  // ========================================================================
  // STEP 3: Get all document_classifications to see what's being classified
  // ========================================================================
  console.log('STEP 3: Analyzing Document Classifications');
  console.log('-'.repeat(40));

  const classifications = await getAllRows<DocumentClassification>(
    supabase, 'document_classifications', 'id, email_id, document_type, confidence_score'
  );
  console.log(`Total classifications: ${classifications.length}`);

  // Group by document_type
  const classTypeGroups: Record<string, number> = {};
  for (const c of classifications) {
    const type = c.document_type || 'null';
    classTypeGroups[type] = (classTypeGroups[type] || 0) + 1;
  }
  console.log('Classification type distribution:');
  Object.entries(classTypeGroups).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });

  // How many booking_confirmations are classified?
  const bcClassifications = classifications.filter(c => c.document_type === 'booking_confirmation');
  console.log(`\nBooking confirmations classified: ${bcClassifications.length}`);
  console.log('');

  // ========================================================================
  // STEP 4: Check which classified BCs are linked vs not linked
  // ========================================================================
  console.log('STEP 4: Comparing Classified BCs vs Linked BCs');
  console.log('-'.repeat(40));

  const linkedEmailIds = new Set(shipmentDocs.map(d => d.email_id));
  const bcEmailIds = new Set(bcClassifications.map(c => c.email_id));

  const linkedBCEmailIds = [...bcEmailIds].filter(id => linkedEmailIds.has(id));
  const unlinkedBCEmailIds = [...bcEmailIds].filter(id => !linkedEmailIds.has(id));

  console.log(`Classified as booking_confirmation: ${bcEmailIds.size}`);
  console.log(`Linked to a shipment: ${linkedBCEmailIds.length}`);
  console.log(`NOT linked to any shipment: ${unlinkedBCEmailIds.length}`);
  console.log('');

  // ========================================================================
  // STEP 5: Get raw emails for unlinked BCs to understand WHY
  // ========================================================================
  console.log('STEP 5: Analyzing Unlinked Booking Confirmation Emails');
  console.log('-'.repeat(40));

  if (unlinkedBCEmailIds.length > 0) {
    // Get raw emails for unlinked BCs (batch of 50)
    const sampleIds = unlinkedBCEmailIds.slice(0, 50);
    const { data: unlinkedEmails } = await supabase
      .from('raw_emails')
      .select('id, gmail_message_id, subject, sender_email, true_sender_email, email_direction, processing_status, received_at')
      .in('id', sampleIds);

    console.log(`Sample of ${unlinkedEmails?.length || 0} unlinked BC emails:`);
    for (const email of unlinkedEmails || []) {
      const isCarrier = isCarrierEmail(email.sender_email, email.true_sender_email);
      const isVia = isViaForward(email.sender_email);
      console.log(`\n  Email ID: ${email.id.substring(0, 8)}...`);
      console.log(`    Subject: ${email.subject?.substring(0, 70)}...`);
      console.log(`    Sender: ${email.sender_email}`);
      console.log(`    True Sender: ${email.true_sender_email || '(none)'}`);
      console.log(`    Direction: ${email.email_direction || '(null)'}`);
      console.log(`    Is Carrier: ${isCarrier}`);
      console.log(`    Is Via Forward: ${isVia}`);
      console.log(`    Processing Status: ${email.processing_status}`);
    }
    console.log('');
  }

  // ========================================================================
  // STEP 6: Check entity extractions for unlinked BCs
  // ========================================================================
  console.log('STEP 6: Checking Entity Extractions for Unlinked BCs');
  console.log('-'.repeat(40));

  if (unlinkedBCEmailIds.length > 0) {
    const sampleIds = unlinkedBCEmailIds.slice(0, 20);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value')
      .in('email_id', sampleIds);

    // Group by email_id
    const entitiesByEmail: Record<string, EntityExtraction[]> = {};
    for (const e of entities || []) {
      if (!entitiesByEmail[e.email_id]) entitiesByEmail[e.email_id] = [];
      entitiesByEmail[e.email_id].push(e);
    }

    console.log(`Entities for ${Object.keys(entitiesByEmail).length} unlinked BC emails:`);
    for (const [emailId, emailEntities] of Object.entries(entitiesByEmail)) {
      console.log(`\n  Email ${emailId.substring(0, 8)}...:`);
      const bookingNum = emailEntities.find(e => e.entity_type === 'booking_number');
      console.log(`    booking_number: ${bookingNum?.entity_value || '(NOT EXTRACTED)'}`);

      // If booking number was extracted, check if shipment exists
      if (bookingNum?.entity_value) {
        const { data: matchingShipment } = await supabase
          .from('shipments')
          .select('id, workflow_state')
          .eq('booking_number', bookingNum.entity_value)
          .single();

        if (matchingShipment) {
          console.log(`    MATCHING SHIPMENT EXISTS: ${matchingShipment.id.substring(0, 8)}... (state: ${matchingShipment.workflow_state})`);
          console.log(`    >>> WHY NOT LINKED? <<<`);
        } else {
          console.log(`    No matching shipment found for booking ${bookingNum.entity_value}`);
        }
      }
    }
    console.log('');
  }

  // ========================================================================
  // STEP 7: Analyze "via" emails specifically
  // ========================================================================
  console.log('STEP 7: Analyzing "via" Emails (Google Group Forwards)');
  console.log('-'.repeat(40));

  const { data: viaEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email, email_direction')
    .ilike('sender_email', '% via %')
    .limit(100);

  console.log(`Total "via" emails found: ${viaEmails?.length || 0}`);

  // Check direction for via emails
  const viaDirections: Record<string, number> = {};
  for (const email of viaEmails || []) {
    const dir = email.email_direction || 'null';
    viaDirections[dir] = (viaDirections[dir] || 0) + 1;
  }
  console.log('Direction distribution for "via" emails:');
  Object.entries(viaDirections).forEach(([dir, count]) => {
    console.log(`  ${dir}: ${count}`);
  });

  // Check how many via emails are from carriers
  let viaCarrierCount = 0;
  for (const email of viaEmails || []) {
    if (isCarrierEmail(email.sender_email, email.true_sender_email)) {
      viaCarrierCount++;
    }
  }
  console.log(`"via" emails from carriers: ${viaCarrierCount}`);

  // Check classifications for via emails
  const viaEmailIds = (viaEmails || []).map(e => e.id);
  const viaClassifications = classifications.filter(c => viaEmailIds.includes(c.email_id));
  const viaBCClassifications = viaClassifications.filter(c => c.document_type === 'booking_confirmation');
  console.log(`"via" emails classified as booking_confirmation: ${viaBCClassifications.length}`);

  // Check how many are linked
  const viaLinked = viaBCClassifications.filter(c => linkedEmailIds.has(c.email_id));
  console.log(`"via" BC emails linked to shipments: ${viaLinked.length}`);
  console.log(`"via" BC emails NOT linked: ${viaBCClassifications.length - viaLinked.length}`);
  console.log('');

  // Sample unlinked via BC emails
  const unlinkedViaBCs = viaBCClassifications.filter(c => !linkedEmailIds.has(c.email_id));
  if (unlinkedViaBCs.length > 0) {
    console.log('Sample unlinked "via" BC emails:');
    for (const c of unlinkedViaBCs.slice(0, 5)) {
      const email = viaEmails?.find(e => e.id === c.email_id);
      if (email) {
        console.log(`\n  Email: ${email.id.substring(0, 8)}...`);
        console.log(`    Subject: ${email.subject?.substring(0, 60)}...`);
        console.log(`    Sender: ${email.sender_email}`);
        console.log(`    True Sender: ${email.true_sender_email || '(none)'}`);
        console.log(`    Direction: ${email.email_direction}`);

        // Check entities
        const { data: ents } = await supabase
          .from('entity_extractions')
          .select('entity_type, entity_value')
          .eq('email_id', c.email_id);

        const bookingNum = ents?.find(e => e.entity_type === 'booking_number');
        console.log(`    Booking Number: ${bookingNum?.entity_value || '(NOT EXTRACTED)'}`);

        // If extracted, check if shipment exists
        if (bookingNum?.entity_value) {
          const { data: ship } = await supabase
            .from('shipments')
            .select('id, workflow_state, created_from_email_id')
            .eq('booking_number', bookingNum.entity_value)
            .single();

          if (ship) {
            console.log(`    >>> SHIPMENT EXISTS: ${ship.id.substring(0, 8)}... (state: ${ship.workflow_state})`);
            console.log(`    >>> Created from email: ${ship.created_from_email_id?.substring(0, 8) || '(none)'}...`);
          }
        }
      }
    }
    console.log('');
  }

  // ========================================================================
  // STEP 8: Check shipments created_from_email_id
  // ========================================================================
  console.log('STEP 8: Checking Shipment Creation Source');
  console.log('-'.repeat(40));

  const shipmentsWithEmailSource = shipments.filter(s => s.created_from_email_id);
  console.log(`Shipments with created_from_email_id: ${shipmentsWithEmailSource.length}`);
  console.log(`Shipments WITHOUT created_from_email_id: ${shipments.length - shipmentsWithEmailSource.length}`);

  // For shipments WITH email source, check if that email is linked
  let linkedSourceCount = 0;
  for (const s of shipmentsWithEmailSource) {
    const isLinked = shipmentDocs.some(d => d.email_id === s.created_from_email_id && d.shipment_id === s.id);
    if (isLinked) linkedSourceCount++;
  }
  console.log(`Shipments where source email is linked: ${linkedSourceCount}`);
  console.log(`Shipments where source email is NOT linked: ${shipmentsWithEmailSource.length - linkedSourceCount}`);
  console.log('');

  // ========================================================================
  // STEP 9: CRITICAL CHECK - Find carrier BC emails that should be linked
  // ========================================================================
  console.log('STEP 9: CRITICAL - Finding Carrier BC Emails That Should Create/Link Shipments');
  console.log('-'.repeat(40));

  // Get all BC classified emails
  const bcEmailIdsList = [...bcEmailIds];

  // Batch fetch raw emails
  const allBCEmails: RawEmail[] = [];
  for (let i = 0; i < bcEmailIdsList.length; i += 100) {
    const batch = bcEmailIdsList.slice(i, i + 100);
    const { data } = await supabase
      .from('raw_emails')
      .select('id, gmail_message_id, subject, sender_email, true_sender_email, email_direction, processing_status, received_at')
      .in('id', batch);
    if (data) allBCEmails.push(...data);
  }

  // Filter to carrier emails only
  const carrierBCEmails = allBCEmails.filter(e => isCarrierEmail(e.sender_email, e.true_sender_email));
  console.log(`Total BC emails from carriers: ${carrierBCEmails.length}`);

  // Check which are linked
  const linkedCarrierBCs = carrierBCEmails.filter(e => linkedEmailIds.has(e.id));
  const unlinkedCarrierBCs = carrierBCEmails.filter(e => !linkedEmailIds.has(e.id));
  console.log(`Carrier BC emails linked: ${linkedCarrierBCs.length}`);
  console.log(`Carrier BC emails NOT linked: ${unlinkedCarrierBCs.length}`);

  // Deep dive on unlinked carrier BCs
  if (unlinkedCarrierBCs.length > 0) {
    console.log('\nDETAILED ANALYSIS of unlinked carrier BC emails:');
    for (const email of unlinkedCarrierBCs.slice(0, 10)) {
      console.log(`\n  -------`);
      console.log(`  Email ID: ${email.id.substring(0, 8)}...`);
      console.log(`  Subject: ${email.subject}`);
      console.log(`  Sender: ${email.sender_email}`);
      console.log(`  True Sender: ${email.true_sender_email || '(none)'}`);
      console.log(`  Direction: ${email.email_direction}`);
      console.log(`  Processing Status: ${email.processing_status}`);

      // Get entities
      const { data: ents } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', email.id);

      const bookingNum = ents?.find(e => e.entity_type === 'booking_number');
      console.log(`  Booking Number Extracted: ${bookingNum?.entity_value || 'NO'}`);

      if (bookingNum?.entity_value) {
        // Check if shipment exists
        const { data: ship } = await supabase
          .from('shipments')
          .select('id, workflow_state, created_from_email_id')
          .eq('booking_number', bookingNum.entity_value)
          .single();

        if (ship) {
          console.log(`  >>> SHIPMENT EXISTS: ${ship.id.substring(0, 8)}...`);
          console.log(`  >>> Workflow State: ${ship.workflow_state}`);
          console.log(`  >>> Created from: ${ship.created_from_email_id?.substring(0, 8) || 'null'}...`);
          console.log(`  >>> THIS EMAIL SHOULD BE LINKED!`);

          // Check if there's ANY document linked to this shipment
          const linkedDocs = shipmentDocs.filter(d => d.shipment_id === ship.id);
          console.log(`  >>> Docs linked to this shipment: ${linkedDocs.length}`);
          for (const doc of linkedDocs.slice(0, 3)) {
            console.log(`      - ${doc.document_type} (email: ${doc.email_id.substring(0, 8)}...)`);
          }
        } else {
          console.log(`  >>> NO SHIPMENT for booking ${bookingNum.entity_value}`);
          console.log(`  >>> WHY? This carrier BC should have created one!`);
        }
      }
    }
  }

  console.log('\n');
  console.log('='.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(80));
}

investigate().catch(console.error);
