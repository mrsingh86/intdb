import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function analyze() {
  console.log('=== COMPLETE BC ANALYSIS ===\n');

  // Get all data
  const classifications = await getAllRows<{email_id: string; document_type: string}>(
    supabase, 'document_classifications', 'email_id, document_type'
  );
  
  const emails = await getAllRows<{id: string; sender_email: string; email_direction: string}>(
    supabase, 'raw_emails', 'id, sender_email, email_direction'
  );
  const emailMap = new Map(emails.map(e => [e.id, e]));
  
  const shipmentDocs = await getAllRows<{email_id: string; document_type: string}>(
    supabase, 'shipment_documents', 'email_id, document_type'
  );
  const linkedBCEmailIds = new Set(
    shipmentDocs.filter(d => d.document_type === 'booking_confirmation').map(d => d.email_id)
  );
  const linkedAnyEmailIds = new Set(shipmentDocs.map(d => d.email_id));

  // Filter for booking confirmations
  const bcClassifications = classifications.filter(c => c.document_type === 'booking_confirmation');
  
  console.log('Total booking_confirmation classifications:', bcClassifications.length);
  
  // Categorize
  let inboundLinked = 0;
  let inboundUnlinked = 0;
  let outboundLinked = 0;
  let outboundUnlinked = 0;
  
  const unlinkedInbound: string[] = [];
  
  for (const bc of bcClassifications) {
    const email = emailMap.get(bc.email_id);
    const direction = email?.email_direction || 'unknown';
    const isLinked = linkedAnyEmailIds.has(bc.email_id);
    
    if (direction === 'inbound') {
      if (isLinked) inboundLinked++;
      else {
        inboundUnlinked++;
        if (unlinkedInbound.length < 20) {
          unlinkedInbound.push(email?.sender_email?.substring(0, 60) || 'unknown');
        }
      }
    } else {
      if (isLinked) outboundLinked++;
      else outboundUnlinked++;
    }
  }
  
  console.log('\n=== BOOKING CONFIRMATION BY DIRECTION & LINKAGE ===');
  console.log('INBOUND (from carriers):');
  console.log('  Linked to shipments:', inboundLinked);
  console.log('  NOT linked:', inboundUnlinked);
  console.log('\nOUTBOUND (from Intoglo):');
  console.log('  Linked to shipments:', outboundLinked);
  console.log('  NOT linked:', outboundUnlinked);
  
  if (unlinkedInbound.length > 0) {
    console.log('\n=== SAMPLE UNLINKED INBOUND BCs ===');
    unlinkedInbound.forEach(s => console.log('  ' + s));
  }
  
  // Check how many shipments have ONLY outbound BC
  const shipments = await getAllRows<{id: string; booking_number: string; workflow_state: string}>(
    supabase, 'shipments', 'id, booking_number, workflow_state'
  );
  
  // Group BC links by shipment
  const bcByShipment = new Map<string, {inbound: number; outbound: number}>();
  
  for (const doc of shipmentDocs.filter(d => d.document_type === 'booking_confirmation')) {
    // Find shipment for this doc
    const shipDoc = shipmentDocs.find(sd => sd.email_id === doc.email_id);
    if (!shipDoc) continue;
    
    // Get direction
    const email = emailMap.get(doc.email_id);
    const direction = email?.email_direction || 'unknown';
    
    // This is getting complex - let me simplify
  }
  
  console.log('\n=== SHIPMENTS SUMMARY ===');
  console.log('Total shipments:', shipments.length);
  
  // Count by workflow state
  const stateCount: Record<string, number> = {};
  shipments.forEach(s => {
    stateCount[s.workflow_state || 'null'] = (stateCount[s.workflow_state || 'null'] || 0) + 1;
  });
  
  console.log('\nWorkflow states:');
  Object.entries(stateCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => console.log('  ' + state.padEnd(35) + count));
}

analyze();
