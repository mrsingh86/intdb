/**
 * Backfill Workflow States from Documents
 *
 * Updates shipment workflow_state based on linked documents.
 * Uses the WorkflowStateService.autoTransitionFromDocument() for each document.
 */

import { createClient } from '@supabase/supabase-js';
import { WorkflowStateService } from '../lib/services/workflow-state-service';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const workflowService = new WorkflowStateService(supabase);

interface ShipmentDoc {
  id: string;
  shipment_id: string;
  email_id: string;
  document_type: string;
  created_at: string;
}

interface Email {
  id: string;
  received_at: string;
}

interface Shipment {
  id: string;
  booking_number: string;
  workflow_state: string | null;
}

async function backfillWorkflowStates() {
  console.log('=== BACKFILL WORKFLOW STATES FROM DOCUMENTS ===\n');

  // Load all data
  console.log('Loading data...');
  const [shipments, docs, emails] = await Promise.all([
    getAllRows<Shipment>(supabase, 'shipments', 'id, booking_number, workflow_state'),
    getAllRows<ShipmentDoc>(supabase, 'shipment_documents', 'id, shipment_id, email_id, document_type, created_at'),
    getAllRows<Email>(supabase, 'raw_emails', 'id, received_at'),
  ]);

  console.log(`  Shipments: ${shipments.length}`);
  console.log(`  Documents: ${docs.length}`);
  console.log(`  Emails: ${emails.length}\n`);

  const emailMap = new Map(emails.map(e => [e.id, e]));
  const shipmentMap = new Map(shipments.map(s => [s.id, s]));

  // Group documents by shipment, sorted by email received_at
  const docsByShipment = new Map<string, ShipmentDoc[]>();
  for (const doc of docs) {
    if (!docsByShipment.has(doc.shipment_id)) {
      docsByShipment.set(doc.shipment_id, []);
    }
    docsByShipment.get(doc.shipment_id)!.push(doc);
  }

  // Sort each shipment's docs by email received_at
  for (const [shipmentId, shipmentDocs] of docsByShipment) {
    shipmentDocs.sort((a, b) => {
      const emailA = emailMap.get(a.email_id);
      const emailB = emailMap.get(b.email_id);
      const dateA = emailA?.received_at || a.created_at;
      const dateB = emailB?.received_at || b.created_at;
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    });
  }

  // Process each shipment
  console.log('Processing shipments...\n');
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const stateChanges: { booking: string; from: string; to: string }[] = [];

  for (const [shipmentId, shipmentDocs] of docsByShipment) {
    const shipment = shipmentMap.get(shipmentId);
    if (!shipment) continue;

    const oldState = shipment.workflow_state;

    // Process each document in chronological order
    for (const doc of shipmentDocs) {
      try {
        await workflowService.autoTransitionFromDocument(
          shipmentId,
          doc.document_type,
          doc.email_id
        );
      } catch (error) {
        // Ignore errors - some transitions won't be valid
      }
    }

    // Check if state changed
    const { data: updatedShipment } = await supabase
      .from('shipments')
      .select('workflow_state')
      .eq('id', shipmentId)
      .single();

    const newState = updatedShipment?.workflow_state;
    if (newState !== oldState) {
      updated++;
      stateChanges.push({
        booking: shipment.booking_number || shipmentId.substring(0, 8),
        from: oldState || 'null',
        to: newState || 'null',
      });
    } else {
      skipped++;
    }
  }

  console.log('=== RESULTS ===\n');
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (no change): ${skipped}`);
  console.log(`Errors: ${errors}\n`);

  if (stateChanges.length > 0) {
    console.log('State Changes (first 20):');
    stateChanges.slice(0, 20).forEach(c => {
      console.log(`  ${c.booking}: ${c.from} → ${c.to}`);
    });
  }

  // Show final distribution
  console.log('\n=== FINAL WORKFLOW STATE DISTRIBUTION ===\n');
  const { data: finalStates } = await supabase
    .from('shipments')
    .select('workflow_state');

  const stateCounts: Record<string, number> = {};
  finalStates?.forEach(s => {
    const state = s.workflow_state || 'null';
    stateCounts[state] = (stateCounts[state] || 0) + 1;
  });

  Object.entries(stateCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, count]) => {
      console.log(`  ${count.toString().padStart(4)} ${state}`);
    });
}

backfillWorkflowStates().catch(console.error);
