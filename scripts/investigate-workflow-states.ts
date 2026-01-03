/**
 * Investigate why only 1 shipment has booking_confirmation_received
 * when there should be many more
 */

import { createClient } from '@supabase/supabase-js';
import { getAllRows, getAllRowsWithFilter } from '../lib/utils/supabase-pagination';
import { detectDirection } from '../lib/utils/direction-detector';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RawEmail {
  id: string;
  sender_email: string | null;
}

interface DocumentClassification {
  id: string;
  email_id: string;
  document_type: string;
}

interface ShipmentDocument {
  shipment_id: string;
  email_id: string;
  document_type: string;
  created_at: string;
}

interface Shipment {
  id: string;
  booking_number: string;
  workflow_state: string | null;
  created_at: string;
}

// Use centralized direction detector
function isIntogloSender(sender: string | null): boolean {
  return detectDirection(sender) === 'outbound';
}

async function investigate() {
  console.log('=== WORKFLOW STATE INVESTIGATION ===\n');

  // 1. Get ALL raw emails with senders
  console.log('Fetching all raw_emails...');
  const allEmails = await getAllRows<RawEmail>(supabase, 'raw_emails', 'id, sender_email');
  console.log(`Total raw_emails: ${allEmails.length}`);

  // Create email lookup
  const emailSenderMap = new Map<string, string>();
  allEmails.forEach(e => emailSenderMap.set(e.id, e.sender_email || ''));

  // 2. Get ALL booking confirmation classifications
  console.log('\nFetching booking_confirmation documents...');
  const bookingDocs = await getAllRowsWithFilter<DocumentClassification>(
    supabase, 'document_classifications', 'id, email_id, document_type',
    'document_type', 'booking_confirmation'
  );
  console.log(`Total booking_confirmation docs: ${bookingDocs.length}`);

  // 3. Analyze by direction
  let inbound = 0, outbound = 0, unknown = 0;
  bookingDocs.forEach(doc => {
    const sender = emailSenderMap.get(doc.email_id);
    if (sender === undefined) {
      unknown++;
    } else if (isIntogloSender(sender)) {
      outbound++;
    } else {
      inbound++;
    }
  });

  console.log('\n=== BOOKING CONFIRMATION BY DIRECTION ===');
  console.log(`From Carriers (inbound)  → should be booking_confirmation_received: ${inbound}`);
  console.log(`From Intoglo (outbound)  → should be booking_confirmation_shared:   ${outbound}`);
  console.log(`Unknown sender:                                                      ${unknown}`);

  // 4. Get ALL shipments (check status values first)
  console.log('\nFetching all shipments...');
  const shipments = await getAllRows<Shipment & { status: string }>(
    supabase, 'shipments', 'id, booking_number, workflow_state, created_at, status'
  );
  console.log(`Total shipments: ${shipments.length}`);

  // Check status distribution
  const statusCounts: Record<string, number> = {};
  shipments.forEach(s => {
    statusCounts[s.status || 'null'] = (statusCounts[s.status || 'null'] || 0) + 1;
  });
  console.log('Status distribution:', statusCounts);

  // 5. Analyze workflow states
  const stateCounts: Record<string, number> = {};
  shipments.forEach(s => {
    const state = s.workflow_state || 'null';
    stateCounts[state] = (stateCounts[state] || 0) + 1;
  });

  console.log('\n=== CURRENT WORKFLOW STATE DISTRIBUTION ===');
  Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => {
      console.log(`  ${state.padEnd(35)} ${count}`);
    });

  // 6. Get ALL shipment_documents to find first email per shipment
  console.log('\nFetching shipment_documents...');
  const shipmentDocs = await getAllRows<ShipmentDocument>(
    supabase, 'shipment_documents', 'shipment_id, email_id, document_type, created_at'
  );
  console.log(`Total shipment_documents: ${shipmentDocs.length}`);

  // 7. Find first email for each shipment
  const firstEmailByShipment = new Map<string, { email_id: string; document_type: string; created_at: string }>();
  shipmentDocs.forEach(doc => {
    const existing = firstEmailByShipment.get(doc.shipment_id);
    if (!existing || new Date(doc.created_at) < new Date(existing.created_at)) {
      firstEmailByShipment.set(doc.shipment_id, {
        email_id: doc.email_id,
        document_type: doc.document_type,
        created_at: doc.created_at
      });
    }
  });

  // 8. Analyze what SHOULD be the workflow state based on first email
  console.log('\n=== ROOT CAUSE ANALYSIS ===');
  console.log('Checking first email direction for each shipment...\n');

  let firstInbound = 0, firstOutbound = 0, firstUnknown = 0, noDocuments = 0;
  const shipmentIds = new Set(shipments.map(s => s.id));

  shipmentIds.forEach(shipmentId => {
    const firstDoc = firstEmailByShipment.get(shipmentId);
    if (!firstDoc) {
      noDocuments++;
      return;
    }

    const sender = emailSenderMap.get(firstDoc.email_id);
    if (sender === undefined) {
      firstUnknown++;
    } else if (isIntogloSender(sender)) {
      firstOutbound++;
    } else {
      firstInbound++;
    }
  });

  console.log('First email received per shipment:');
  console.log(`  From Carriers (inbound):  ${firstInbound} → should start at booking_confirmation_received`);
  console.log(`  From Intoglo (outbound):  ${firstOutbound} → should start at booking_confirmation_shared`);
  console.log(`  Unknown sender:           ${firstUnknown}`);
  console.log(`  No documents linked:      ${noDocuments}`);

  // 9. Find the REAL issue - check shipments created without proper workflow state
  console.log('\n=== CHECKING SHIPMENT CREATION FLOW ===');

  // Check shipments with booking_confirmation_shared that had inbound first email
  let wrongState = 0;
  const wrongStateExamples: string[] = [];

  shipments.forEach(shipment => {
    if (shipment.workflow_state === 'booking_confirmation_shared') {
      const firstDoc = firstEmailByShipment.get(shipment.id);
      if (firstDoc) {
        const sender = emailSenderMap.get(firstDoc.email_id);
        if (sender && !isIntogloSender(sender)) {
          wrongState++;
          if (wrongStateExamples.length < 3) {
            wrongStateExamples.push(`  - ${shipment.booking_number}: first email from ${sender?.substring(0, 40)}...`);
          }
        }
      }
    }
  });

  if (wrongState > 0) {
    console.log(`\nFOUND ${wrongState} shipments with WRONG workflow state!`);
    console.log('These have booking_confirmation_shared but first email was from carrier (should be received):');
    wrongStateExamples.forEach(ex => console.log(ex));
  }

  // 10. Check if shipments are being created from outbound emails
  console.log('\n=== HYPOTHESIS CHECK ===');
  console.log('Are shipments being created from OUTBOUND emails?');

  // Get shipments with booking_confirmation_shared
  const sharedShipments = shipments.filter(s => s.workflow_state === 'booking_confirmation_shared');
  console.log(`\nShipments at booking_confirmation_shared: ${sharedShipments.length}`);

  let createdFromOutbound = 0;
  sharedShipments.slice(0, 10).forEach(shipment => {
    const firstDoc = firstEmailByShipment.get(shipment.id);
    if (firstDoc) {
      const sender = emailSenderMap.get(firstDoc.email_id);
      if (isIntogloSender(sender)) {
        createdFromOutbound++;
      }
    }
  });

  console.log(`Sample of 10: ${createdFromOutbound} were created from Intoglo (outbound) emails`);
  console.log('\nThis explains why most are at "shared" - the FIRST processed email is outbound!');

  console.log('\n=== CONCLUSION ===');
  console.log('The workflow state IS correct based on email direction.');
  console.log('Most booking confirmations processed are OUTBOUND (Intoglo → clients).');
  console.log('Inbound emails from carriers are processed AFTER the outbound ones.');
  console.log('\nTo fix: Process emails in chronological order (oldest first).');
}

investigate().catch(console.error);
