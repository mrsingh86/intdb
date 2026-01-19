import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  const shipments = await getAllRows<{id: string; booking_number: string; workflow_state: string}>(
    supabase, 'shipments', 'id, booking_number, workflow_state'
  );
  
  const docs = await getAllRows<{shipment_id: string; document_type: string; email_id: string}>(
    supabase, 'shipment_documents', 'shipment_id, document_type, email_id'
  );
  
  const emails = await getAllRows<{id: string; email_direction: string}>(
    supabase, 'raw_emails', 'id, email_direction'
  );
  
  const emailDir = new Map(emails.map(e => [e.id, e.email_direction]));
  
  // For each shipment, check what booking confirmations it has
  let hasInbound = 0;
  let hasOutbound = 0;
  let hasBoth = 0;
  let hasNeither = 0;
  let onlyInbound = 0;
  let onlyOutbound = 0;
  
  const missingInbound: string[] = [];
  
  for (const ship of shipments) {
    const shipDocs = docs.filter(d => d.shipment_id === ship.id && d.document_type === 'booking_confirmation');
    
    let inbound = false;
    let outbound = false;
    
    for (const doc of shipDocs) {
      const dir = emailDir.get(doc.email_id);
      if (dir === 'inbound') inbound = true;
      if (dir === 'outbound') outbound = true;
    }
    
    if (inbound && outbound) hasBoth++;
    else if (inbound && !outbound) { onlyInbound++; hasInbound++; }
    else if (!inbound && outbound) { 
      onlyOutbound++; 
      hasOutbound++;
      if (missingInbound.length < 10) missingInbound.push(ship.booking_number);
    }
    else hasNeither++;
    
    if (inbound) hasInbound++;
    if (outbound) hasOutbound++;
  }
  
  console.log('=== BOOKING CONFIRMATION COVERAGE ===');
  console.log('Total shipments:', shipments.length);
  console.log('');
  console.log('Has INBOUND booking conf:', hasInbound);
  console.log('Has OUTBOUND booking conf:', hasOutbound);
  console.log('');
  console.log('Has BOTH inbound + outbound:', hasBoth);
  console.log('Has ONLY inbound:', onlyInbound);
  console.log('Has ONLY outbound (MISSING INBOUND!):', onlyOutbound);
  console.log('Has NEITHER:', hasNeither);
  
  if (missingInbound.length > 0) {
    console.log('\nShipments missing inbound booking confirmation:');
    missingInbound.forEach(b => console.log('  ' + b));
  }
}

check();
