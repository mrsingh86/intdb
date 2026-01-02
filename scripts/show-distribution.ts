/**
 * Show document type and workflow state distribution
 * For active shipments only (not cancelled/completed/delivered)
 */
import { supabase, fetchAll, fetchByIds, isIntoglo } from './lib/supabase';

// Use isIntoglo from shared lib as isOutbound
const isOutbound = isIntoglo;

// Workflow state mapping
// Key insight: Intoglo issues HBL to shipper, receives MBL from carrier
function getWorkflowState(docType: string, outbound: boolean): string | null {
  const mappings: Record<string, string> = {
    // BOOKING
    'booking_confirmation:inbound': 'booking_confirmation_received',
    'booking_amendment:inbound': 'booking_confirmation_received',
    'booking_confirmation:outbound': 'booking_confirmation_shared',
    'booking_amendment:outbound': 'booking_confirmation_shared',
    // INVOICE
    'invoice:inbound': 'commercial_invoice_received',
    'invoice:outbound': 'invoice_sent',
    'freight_invoice:inbound': 'commercial_invoice_received',
    'freight_invoice:outbound': 'invoice_sent',
    // SI (Shipping Instruction)
    'shipping_instruction:inbound': 'si_confirmed',  // Carrier confirms SI
    'shipping_instruction:outbound': 'si_submitted', // Intoglo submits to carrier
    'si_draft:inbound': 'si_draft_received',         // Shipper sends SI draft
    'si_draft:outbound': 'si_draft_shared',          // Intoglo shares SI draft with shipper
    'si_submission:inbound': 'si_confirmed',
    'si_submission:outbound': 'si_submitted',
    // BL (Bill of Lading)
    'bill_of_lading:inbound': 'carrier_bl_received', // MBL from carrier
    'bill_of_lading:outbound': 'hbl_released',       // Intoglo releases HBL to shipper
    'hbl_draft:inbound': 'hbl_draft_received',       // Rare: shipper feedback on draft
    'hbl_draft:outbound': 'hbl_draft_shared',        // Intoglo shares HBL draft with shipper
    // DEPARTURE
    'sob_confirmation:inbound': 'vessel_departed',
    'sob_confirmation:outbound': 'vessel_departed',
    // ARRIVAL
    'arrival_notice:inbound': 'arrival_notice_received',
    'arrival_notice:outbound': 'arrival_notice_shared',
    'customs_document:inbound': 'customs_invoice_received',
    'customs_document:outbound': 'duty_summary_shared',
    // DELIVERY
    'delivery_order:inbound': 'cargo_released',
    'delivery_order:outbound': 'cargo_released',
    'container_release:inbound': 'cargo_released',
    'container_release:outbound': 'cargo_released',
    // VGM
    'vgm_submission:inbound': 'vgm_submitted',
    'vgm_submission:outbound': 'vgm_submitted',
  };
  return mappings[`${docType}:${outbound ? 'outbound' : 'inbound'}`] || null;
}

async function main() {
  console.log('Fetching active shipments...\n');

  // Get shipments under consideration (not cancelled/completed/delivered)
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, status')
    .not('status', 'in', '(cancelled,completed,delivered)');

  const shipmentIds = shipments?.map(s => s.id) || [];

  console.log('═'.repeat(60));
  console.log('ACTIVE SHIPMENTS UNDER CONSIDERATION');
  console.log('═'.repeat(60));
  console.log('Total:', shipmentIds.length);
  console.log('  in_transit:', shipments?.filter(s => s.status === 'in_transit').length);
  console.log('  booked:', shipments?.filter(s => s.status === 'booked').length);
  console.log('  draft:', shipments?.filter(s => s.status === 'draft').length);

  // Get documents linked to these shipments (with pagination)
  const shipmentDocs: Array<{ email_id: string; document_type: string; shipment_id: string }> = [];
  const PAGE_SIZE = 1000;

  // Batch shipment IDs to avoid URL length limits, then paginate results
  for (let i = 0; i < shipmentIds.length; i += 50) {
    const shipmentBatch = shipmentIds.slice(i, i + 50);
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data } = await supabase
        .from('shipment_documents')
        .select('email_id, document_type, shipment_id')
        .in('shipment_id', shipmentBatch)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (data && data.length > 0) {
        shipmentDocs.push(...data);
        hasMore = data.length === PAGE_SIZE;
        page++;
      } else {
        hasMore = false;
      }
    }
  }

  console.log('\nDocuments linked:', shipmentDocs.length);

  // Get email sender info for direction (batch to avoid .in() limits)
  const emailIds = [...new Set(shipmentDocs.map(d => d.email_id).filter(Boolean))];
  const emails = await fetchByIds<{ id: string; sender_email: string }>(
    'raw_emails',
    'id, sender_email',
    'id',
    emailIds
  );
  const emailMap = new Map(emails.map(e => [e.id, e.sender_email || '']));

  // Document type distribution
  const docCounts: Record<string, number> = {};
  shipmentDocs?.forEach(d => {
    docCounts[d.document_type] = (docCounts[d.document_type] || 0) + 1;
  });

  console.log('\n📊 DOCUMENT TYPE DISTRIBUTION');
  console.log('─'.repeat(55));
  Object.entries(docCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log('  ' + type.padEnd(35) + count.toString().padStart(6));
    });

  // Calculate workflow states
  const stateCounts: Record<string, number> = {};
  const unmapped: Record<string, number> = {};

  shipmentDocs?.forEach(d => {
    const sender = emailMap.get(d.email_id) || '';
    const outbound = isOutbound(sender);
    const state = getWorkflowState(d.document_type, outbound);
    if (state) {
      stateCounts[state] = (stateCounts[state] || 0) + 1;
    } else {
      const key = `${d.document_type}:${outbound ? 'outbound' : 'inbound'}`;
      unmapped[key] = (unmapped[key] || 0) + 1;
    }
  });

  console.log('\n📊 WORKFLOW STATE DISTRIBUTION');
  console.log('═'.repeat(55));

  const phases: Record<string, string[]> = {
    'PRE-DEPARTURE': [
      'booking_confirmation_received', 'booking_confirmation_shared',
      'commercial_invoice_received',
      'si_draft_received', 'si_draft_shared', 'si_submitted', 'si_confirmed',
      'vgm_submitted',
      'carrier_bl_received', 'hbl_draft_shared', 'hbl_released',
    ],
    'IN-TRANSIT': ['vessel_departed', 'invoice_sent'],
    'ARRIVAL': ['arrival_notice_received', 'arrival_notice_shared', 'customs_invoice_received', 'duty_summary_shared', 'cargo_released'],
    'DELIVERY': ['pod_received'],
  };

  Object.entries(phases).forEach(([phase, states]) => {
    const phaseTotal = states.reduce((sum, s) => sum + (stateCounts[s] || 0), 0);
    if (phaseTotal > 0) {
      console.log(`\n${phase}`);
      console.log('─'.repeat(50));
      states.forEach(state => {
        const count = stateCounts[state] || 0;
        if (count > 0) {
          console.log('  ' + state.padEnd(35) + count.toString().padStart(6));
        }
      });
    }
  });

  if (Object.keys(unmapped).length > 0) {
    console.log('\n\nUNMAPPED:');
    console.log('─'.repeat(50));
    Object.entries(unmapped)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([key, count]) => {
        console.log('  ' + key.padEnd(35) + count.toString().padStart(6));
      });
  }

  const totalMapped = Object.values(stateCounts).reduce((a, b) => a + b, 0);
  const totalUnmapped = Object.values(unmapped).reduce((a, b) => a + b, 0);
  console.log('\n═'.repeat(55));
  console.log('SUMMARY');
  console.log('─'.repeat(55));
  console.log('Mapped to workflow:'.padEnd(35) + totalMapped.toString().padStart(6));
  console.log('Unmapped:'.padEnd(35) + totalUnmapped.toString().padStart(6));
  console.log('═'.repeat(55));
}

main().catch(console.error);
