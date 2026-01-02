/**
 * Workflow State Distribution Summary
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE = 1000;

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await supabase.from(table).select(select).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data && data.length > 0) {
      all = all.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return all;
}

/**
 * Detect if email is outbound (from Intoglo) using TRUE sender.
 * Carrier emails forwarded via ops@intoglo.com should be INBOUND.
 */
function isOutbound(trueSender: string | null): boolean {
  if (!trueSender) return false;
  const s = trueSender.toLowerCase();
  return s.includes('@intoglo.com') || s.includes('@intoglo.in');
}

function getWorkflowState(docType: string, outbound: boolean): string | null {
  const mappings: Record<string, string> = {
    'booking_confirmation:inbound': 'booking_confirmation_received',
    'booking_amendment:inbound': 'booking_confirmation_received',
    'booking_confirmation:outbound': 'booking_confirmation_shared',
    'booking_amendment:outbound': 'booking_confirmation_shared',
    'booking_cancellation:inbound': 'booking_cancelled',
    'invoice:inbound': 'commercial_invoice_received',
    'commercial_invoice:inbound': 'commercial_invoice_received',
    'invoice:outbound': 'invoice_sent',
    'freight_invoice:outbound': 'invoice_sent',
    'shipping_instruction:inbound': 'si_draft_received',
    'si_submission:inbound': 'si_draft_received',
    'si_draft:inbound': 'si_draft_received',
    'shipping_instruction:outbound': 'si_confirmed',
    'si_confirmation:outbound': 'si_confirmed',
    'bill_of_lading:inbound': 'hbl_draft_sent',
    'house_bl:inbound': 'hbl_draft_sent',
    'bl_draft:inbound': 'hbl_draft_sent',
    'bill_of_lading:outbound': 'hbl_released',
    'house_bl:outbound': 'hbl_released',
    'arrival_notice:inbound': 'arrival_notice_received',
    'arrival_notice:outbound': 'arrival_notice_shared',
    'customs_document:inbound': 'customs_invoice_received',
    'customs_invoice:inbound': 'customs_invoice_received',
    'customs_document:outbound': 'duty_summary_shared',
    'delivery_order:inbound': 'cargo_released',
    'container_release:inbound': 'cargo_released',
    'delivery_order:outbound': 'delivery_order_shared',
    'proof_of_delivery:inbound': 'pod_received',
    'pod_confirmation:inbound': 'pod_received',
  };
  const key = docType + ':' + (outbound ? 'outbound' : 'inbound');
  return mappings[key] || null;
}

async function main() {
  console.log('Fetching data (using true_sender_email for direction)...');

  const [docs, emails, classifications] = await Promise.all([
    fetchAll<{ email_id: string; shipment_id: string; document_type: string }>('shipment_documents', 'email_id,shipment_id,document_type'),
    fetchAll<{ id: string; true_sender_email: string }>('raw_emails', 'id,true_sender_email'),
    fetchAll<{ email_id: string; document_type: string }>('document_classifications', 'email_id,document_type'),
  ]);

  // Create lookups - use true_sender_email for direction detection
  const emailTrueSenders = new Map(emails.map(e => [e.id, e.true_sender_email || '']));
  const classificationMap = new Map(classifications.map(c => [c.email_id, c.document_type]));

  // Count by workflow state
  const stateCounts: Record<string, number> = {};
  const uniqueShipmentsByState: Record<string, Set<string>> = {};

  for (const d of docs) {
    const trueSender = emailTrueSenders.get(d.email_id) || '';
    const outbound = isOutbound(trueSender);
    const docType = classificationMap.get(d.email_id) || d.document_type || 'unknown';
    const state = getWorkflowState(docType, outbound);

    if (state) {
      stateCounts[state] = (stateCounts[state] || 0) + 1;
      if (!uniqueShipmentsByState[state]) uniqueShipmentsByState[state] = new Set();
      uniqueShipmentsByState[state].add(d.shipment_id);
    }
  }

  // Get total shipments
  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    WORKFLOW STATE DISTRIBUTION (FINAL)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Total shipments:', totalShipments);
  console.log('Total linked documents:', docs.length);
  console.log('');

  // Group by phase
  const phases: Record<string, string[]> = {
    'PRE-DEPARTURE': [
      'booking_confirmation_received', 'booking_confirmation_shared',
      'commercial_invoice_received', 'si_draft_received', 'si_confirmed', 'hbl_draft_sent'
    ],
    'IN-TRANSIT': ['invoice_sent', 'hbl_released'],
    'ARRIVAL': [
      'arrival_notice_received', 'arrival_notice_shared',
      'customs_invoice_received', 'duty_summary_shared', 'cargo_released', 'delivery_order_shared'
    ],
    'DELIVERY': ['pod_received'],
    'CANCELLED': ['booking_cancelled']
  };

  console.log('State'.padEnd(35) + 'Docs'.padStart(6) + 'Shipments'.padStart(12) + 'Coverage'.padStart(10));
  console.log('─'.repeat(63));

  for (const [phase, states] of Object.entries(phases)) {
    console.log('');
    console.log(phase);
    for (const state of states) {
      const count = stateCounts[state] || 0;
      const shipments = uniqueShipmentsByState[state]?.size || 0;
      const coverage = totalShipments && totalShipments > 0 ? ((shipments / totalShipments) * 100).toFixed(0) + '%' : '0%';
      console.log('  ' + state.padEnd(33) + count.toString().padStart(6) + shipments.toString().padStart(12) + coverage.padStart(10));
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
