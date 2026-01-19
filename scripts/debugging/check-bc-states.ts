import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  const shipments = await getAllRows<any>(supabase, 'shipments', 'id, booking_number, workflow_state');
  const docs = await getAllRows<any>(supabase, 'shipment_documents', 'shipment_id, document_type');

  // Find shipments with booking confirmation docs
  const shipmentsWithBC = new Set<string>();
  for (const doc of docs) {
    if (doc.document_type === 'booking_confirmation' || doc.document_type === 'booking_amendment') {
      shipmentsWithBC.add(doc.shipment_id);
    }
  }

  // Check their workflow states
  const stateCount: Record<string, number> = {};
  const nullShipments: string[] = [];

  for (const s of shipments) {
    if (shipmentsWithBC.has(s.id)) {
      const state = s.workflow_state || 'NULL';
      stateCount[state] = (stateCount[state] || 0) + 1;
      if (!s.workflow_state) {
        nullShipments.push(s.booking_number);
      }
    }
  }

  console.log('Shipments WITH booking confirmation documents linked:');
  console.log('Total:', shipmentsWithBC.size);
  console.log('');
  console.log('Their current workflow_state:');
  Object.entries(stateCount).sort((a,b) => b[1] - a[1]).forEach(([state, count]) => {
    console.log('  ' + state.padEnd(35) + count);
  });

  if (nullShipments.length > 0) {
    console.log('');
    console.log('Shipments with NULL workflow_state (need backfill):');
    nullShipments.slice(0, 10).forEach(bn => console.log('  - ' + bn));
    if (nullShipments.length > 10) {
      console.log('  ... and ' + (nullShipments.length - 10) + ' more');
    }
  }
}

check();
