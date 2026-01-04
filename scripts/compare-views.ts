/**
 * Compare Cumulative vs Document-Based Views
 */
import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'checklist_received': 40,
  'checklist_shared': 42,
  'shipping_bill_received': 48,
  'si_confirmed': 60,
  'vgm_submitted': 65,
  'sob_received': 80,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'entry_draft_received': 153,
  'entry_draft_shared': 156,
  'entry_summary_received': 168,
  'entry_summary_shared': 172,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'cargo_released': 192,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'delivery_order_shared': 210,
  'container_released': 220,
  'pod_received': 235,
};

const STATE_TO_DOCS: Record<string, { types: string[]; direction: 'inbound' | 'outbound' }> = {
  'booking_confirmation_received': { types: ['booking_confirmation', 'booking_amendment'], direction: 'inbound' },
  'booking_confirmation_shared': { types: ['booking_confirmation', 'booking_amendment'], direction: 'outbound' },
  'si_draft_received': { types: ['si_draft', 'shipping_instruction'], direction: 'inbound' },
  'si_draft_sent': { types: ['si_draft', 'shipping_instruction'], direction: 'outbound' },
  'checklist_received': { types: ['checklist'], direction: 'inbound' },
  'checklist_shared': { types: ['checklist'], direction: 'outbound' },
  'shipping_bill_received': { types: ['shipping_bill', 'leo_copy'], direction: 'inbound' },
  'si_confirmed': { types: ['si_submission', 'si_confirmation'], direction: 'inbound' },
  'vgm_submitted': { types: ['vgm_submission', 'vgm_confirmation'], direction: 'inbound' },
  'sob_received': { types: ['sob_confirmation'], direction: 'inbound' },
  'bl_received': { types: ['bill_of_lading', 'house_bl'], direction: 'inbound' },
  'hbl_draft_sent': { types: ['bill_of_lading', 'house_bl', 'hbl_draft'], direction: 'outbound' },
  'hbl_shared': { types: ['bill_of_lading', 'house_bl'], direction: 'outbound' },
  'invoice_sent': { types: ['invoice', 'freight_invoice'], direction: 'outbound' },
  'entry_draft_received': { types: ['draft_entry', 'customs_document'], direction: 'inbound' },
  'entry_draft_shared': { types: ['draft_entry'], direction: 'outbound' },
  'entry_summary_received': { types: ['entry_summary'], direction: 'inbound' },
  'entry_summary_shared': { types: ['entry_summary'], direction: 'outbound' },
  'arrival_notice_received': { types: ['arrival_notice', 'shipment_notice'], direction: 'inbound' },
  'arrival_notice_shared': { types: ['arrival_notice'], direction: 'outbound' },
  'cargo_released': { types: ['container_release'], direction: 'inbound' },
  'duty_invoice_received': { types: ['duty_invoice'], direction: 'inbound' },
  'duty_summary_shared': { types: ['duty_invoice'], direction: 'outbound' },
  'delivery_order_received': { types: ['delivery_order'], direction: 'inbound' },
  'delivery_order_shared': { types: ['delivery_order'], direction: 'outbound' },
  'container_released': { types: ['container_release'], direction: 'outbound' },
  'pod_received': { types: ['proof_of_delivery', 'pod_confirmation'], direction: 'inbound' },
};

const LABELS: Record<string, string> = {
  'booking_confirmation_received': 'BC Received',
  'booking_confirmation_shared': 'BC Shared',
  'si_draft_received': 'SI Draft Received',
  'si_draft_sent': 'SI Draft Sent',
  'checklist_received': 'Checklist Received',
  'checklist_shared': 'Checklist Shared',
  'shipping_bill_received': 'LEO/SB Received',
  'si_confirmed': 'SI Confirmed',
  'vgm_submitted': 'VGM Submitted',
  'sob_received': 'SOB Received',
  'bl_received': 'BL Received',
  'hbl_draft_sent': 'HBL Draft Sent',
  'hbl_shared': 'HBL Shared',
  'invoice_sent': 'Invoice Sent',
  'entry_draft_received': 'Entry Draft Received',
  'entry_draft_shared': 'Entry Draft Shared',
  'entry_summary_received': 'Entry Summary Received',
  'entry_summary_shared': 'Entry Summary Shared',
  'arrival_notice_received': 'AN Received',
  'arrival_notice_shared': 'AN Shared',
  'cargo_released': 'Cargo Released',
  'duty_invoice_received': 'Duty Invoice Received',
  'duty_summary_shared': 'Duty Invoice Shared',
  'delivery_order_received': 'DO Received',
  'delivery_order_shared': 'DO Shared',
  'container_released': 'Container Released',
  'pod_received': 'POD Received',
};

interface Shipment {
  id: string;
  workflow_state: string | null;
}

interface Doc {
  shipment_id: string;
  email_id: string;
  document_type: string;
}

interface Email {
  id: string;
  sender_email: string | null;
  email_direction: string | null;
}

function getDirection(email: Email): 'inbound' | 'outbound' {
  if (email.email_direction) return email.email_direction as 'inbound' | 'outbound';
  const sender = (email.sender_email || '').toLowerCase();
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) return 'outbound';
  return 'inbound';
}

async function run() {
  const [shipments, docs, emails] = await Promise.all([
    getAllRows<Shipment>(supabase, 'shipments', 'id, workflow_state'),
    getAllRows<Doc>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type'),
    getAllRows<Email>(supabase, 'raw_emails', 'id, sender_email, email_direction'),
  ]);

  const total = shipments.length;
  const emailMap = new Map(emails.map(e => [e.id, e]));

  // Build doc index: shipmentId -> Set of 'docType:direction'
  const shipmentDocIndex = new Map<string, Set<string>>();
  for (const doc of docs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const dir = getDirection(email);
    const key = `${doc.document_type}:${dir}`;
    if (!shipmentDocIndex.has(doc.shipment_id)) {
      shipmentDocIndex.set(doc.shipment_id, new Set());
    }
    shipmentDocIndex.get(doc.shipment_id)!.add(key);
  }

  // Sort states
  const sortedStates = Object.entries(STATE_ORDER).sort((a, b) => a[1] - b[1]).map(e => e[0]);

  console.log('=== WORKFLOW STATE COMPARISON: CUMULATIVE vs DOCUMENT-BASED ===');
  console.log(`Total Shipments: ${total}\n`);
  console.log('State                      Cumulative        Document-Based       Delta');
  console.log('                          (at or past)      (actual docs)');
  console.log('─'.repeat(80));

  for (const state of sortedStates) {
    const stateOrder = STATE_ORDER[state];
    const label = LABELS[state] || state;

    // Cumulative count
    const cumulative = shipments.filter(s => {
      const order = STATE_ORDER[s.workflow_state || ''] || 0;
      return order >= stateOrder;
    }).length;
    const cumPct = Math.round((cumulative / total) * 100);

    // Document-based count
    const docConfig = STATE_TO_DOCS[state];
    let docBased = 0;
    if (docConfig) {
      for (const [, docSet] of shipmentDocIndex) {
        for (const docType of docConfig.types) {
          if (docSet.has(`${docType}:${docConfig.direction}`)) {
            docBased++;
            break;
          }
        }
      }
    }
    const docPct = Math.round((docBased / total) * 100);

    // Delta
    const delta = cumulative - docBased;
    const deltaStr = delta > 0 ? `+${delta}` : delta.toString();
    const warning = delta > 10 ? ' ⚠' : '';

    console.log(
      `${label.padEnd(25)} ${`${cumulative} (${cumPct}%)`.padStart(12)}      ${`${docBased} (${docPct}%)`.padStart(12)}        ${deltaStr.padStart(4)}${warning}`
    );
  }

  console.log('\n' + '─'.repeat(80));
  console.log('\nLegend:');
  console.log('  Cumulative:     Shipments at this state OR any later state (assumes linear flow)');
  console.log('  Document-Based: Shipments with actual document of this type linked');
  console.log('  Delta:          Difference (positive = cumulative assumes more than docs show)');
  console.log('  ⚠:              Large gap (>10) - may indicate missing document links or skipped states');
}

run().catch(console.error);
