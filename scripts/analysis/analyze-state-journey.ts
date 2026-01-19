/**
 * Analyze Workflow State Journey
 *
 * Shows distribution of ALL states each shipment has passed through
 * (based on all their documents), not just the current highest state.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Direction-aware document type to workflow state mapping
 */
const DIRECTION_WORKFLOW_MAPPING: Record<string, { state: string; order: number }> = {
  // PRE_DEPARTURE
  'booking_confirmation:inbound': { state: 'booking_confirmation_received', order: 10 },
  'booking_amendment:inbound': { state: 'booking_confirmation_received', order: 10 },
  'booking_confirmation:outbound': { state: 'booking_confirmation_shared', order: 15 },
  'booking_amendment:outbound': { state: 'booking_confirmation_shared', order: 15 },

  'invoice:inbound': { state: 'commercial_invoice_received', order: 20 },
  'commercial_invoice:inbound': { state: 'commercial_invoice_received', order: 20 },
  'packing_list:inbound': { state: 'packing_list_received', order: 25 },

  'shipping_instruction:inbound': { state: 'si_draft_received', order: 30 },
  'si_draft:inbound': { state: 'si_draft_received', order: 30 },

  'si_submission:outbound': { state: 'si_submitted', order: 55 },
  'si_submission:inbound': { state: 'si_confirmed', order: 60 },
  'si_confirmation:inbound': { state: 'si_confirmed', order: 60 },

  'vgm_submission:outbound': { state: 'vgm_submitted', order: 65 },
  'vgm_submission:inbound': { state: 'vgm_confirmed', order: 68 },

  // IN_TRANSIT
  'bill_of_lading:inbound': { state: 'mbl_draft_received', order: 110 },
  'bill_of_lading:outbound': { state: 'hbl_released', order: 130 },
  'house_bl:outbound': { state: 'hbl_released', order: 130 },

  'freight_invoice:outbound': { state: 'invoice_sent', order: 135 },
  'invoice:outbound': { state: 'invoice_sent', order: 135 },

  // ARRIVAL
  'arrival_notice:inbound': { state: 'arrival_notice_received', order: 180 },
  'arrival_notice:outbound': { state: 'arrival_notice_shared', order: 185 },

  'customs_document:inbound': { state: 'duty_invoice_received', order: 195 },
  'customs_document:outbound': { state: 'duty_summary_shared', order: 200 },

  'delivery_order:inbound': { state: 'delivery_order_received', order: 205 },
  'delivery_order:outbound': { state: 'delivery_order_shared', order: 210 },

  // DELIVERY
  'container_release:inbound': { state: 'container_released', order: 220 },
  'container_release:outbound': { state: 'container_released', order: 220 },
};

// Carrier subject patterns for detecting forwarded emails
const carrierSubjectPatterns = [
  /^booking confirmation\s*:\s*\d+/i,
  /^bkg\s*#?\s*\d+/i,
  /amendment.*booking/i,
  /booking.*amendment/i,
  /^\[hapag/i,
  /^\[msc\]/i,
  /^one booking/i,
  /^cosco shipping line/i,
  /^cma cgm -/i,
];

// Carrier domain patterns
const carrierDomains = [
  '@maersk.com', '@hapag-lloyd.com', '@hlag.com',
  '@cma-cgm.com', '@cmacgm.com', '@customer.cmacgm-group.com',
  '@msc.com', '@evergreen-marine.com', '@oocl.com',
  '@coscon.com', '@cosco.com', '@yangming.com', '@one-line.com', '@zim.com'
];

function getDirection(senderEmail: string, trueSenderEmail: string, subject: string): 'inbound' | 'outbound' {
  const sender = senderEmail.toLowerCase();
  const trueSender = (trueSenderEmail || '').toLowerCase();
  const subj = subject.toLowerCase();

  // If true_sender has a carrier domain, it's definitely INBOUND
  const trueSenderIsCarrier = carrierDomains.some(d => trueSender.includes(d));
  const senderIsCarrier = carrierDomains.some(d => sender.includes(d));

  if (trueSenderIsCarrier || senderIsCarrier) {
    return 'inbound';
  }

  // Detect "via Operations" pattern in sender display name
  const isForwardedVia = sender.includes('via operations') ||
    sender.includes('via ops') ||
    sender.includes('via pricing') ||
    sender.includes('via nam');

  const carrierPatterns = [
    'maersk', 'hapag', 'hlag', 'cma-cgm', 'cmacgm', 'msc',
    'evergreen', 'oocl', 'cosco', 'yangming', 'one-line', 'zim',
    'in.export', 'in.import', 'booking.confirmation', 'cma cgm'
  ];
  const hasCarrierInName = carrierPatterns.some(p => sender.includes(p));

  const isCarrierSubject = carrierSubjectPatterns.some(p => p.test(subj));

  if (isForwardedVia || hasCarrierInName || isCarrierSubject) {
    return 'inbound';
  }

  const isIntoglo = sender.includes('@intoglo.com') || sender.includes('@intoglo.in');
  return isIntoglo ? 'outbound' : 'inbound';
}

async function analyzeStateJourney() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              WORKFLOW STATE JOURNEY ANALYSIS');
  console.log('              (All states passed through, not just current)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get all shipments with their documents
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number');

  console.log(`Analyzing ${shipments?.length || 0} shipments...\n`);

  // Track state distribution
  const stateCount: Record<string, number> = {};
  const shipmentStates: Record<string, Set<string>> = {};

  for (const shipment of shipments || []) {
    const { data: documents } = await supabase
      .from('shipment_documents')
      .select(`
        document_type,
        raw_emails!inner(sender_email, true_sender_email, subject)
      `)
      .eq('shipment_id', shipment.id);

    const states = new Set<string>();

    for (const doc of documents || []) {
      if (!doc.document_type) continue;

      const rawEmail = (doc as any).raw_emails || {};
      const direction = getDirection(
        rawEmail.sender_email || '',
        rawEmail.true_sender_email || '',
        rawEmail.subject || ''
      );

      const mappingKey = `${doc.document_type}:${direction}`;
      const mapping = DIRECTION_WORKFLOW_MAPPING[mappingKey];

      if (mapping) {
        states.add(mapping.state);
        stateCount[mapping.state] = (stateCount[mapping.state] || 0) + 1;
      }
    }

    shipmentStates[shipment.booking_number] = states;
  }

  // Print state distribution (how many shipments have reached each state)
  console.log('STATE DISTRIBUTION (shipments that have reached each state):');
  console.log('─'.repeat(60));

  const sortedStates = Object.entries(stateCount)
    .sort((a, b) => {
      const orderA = Object.values(DIRECTION_WORKFLOW_MAPPING).find(m => m.state === a[0])?.order || 999;
      const orderB = Object.values(DIRECTION_WORKFLOW_MAPPING).find(m => m.state === b[0])?.order || 999;
      return orderA - orderB;
    });

  for (const [state, count] of sortedStates) {
    const pct = ((count / (shipments?.length || 1)) * 100).toFixed(1);
    console.log(`  ${state.padEnd(35)} ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Print phase summary
  console.log('\n\nPHASE SUMMARY:');
  console.log('─'.repeat(60));

  const phaseStates: Record<string, string[]> = {
    'PRE_DEPARTURE': ['booking_confirmation_received', 'booking_confirmation_shared', 'commercial_invoice_received', 'packing_list_received', 'si_draft_received', 'si_submitted', 'si_confirmed', 'vgm_submitted', 'vgm_confirmed'],
    'IN_TRANSIT': ['mbl_draft_received', 'hbl_released', 'invoice_sent'],
    'ARRIVAL': ['arrival_notice_received', 'arrival_notice_shared', 'duty_invoice_received', 'duty_summary_shared', 'delivery_order_received', 'delivery_order_shared'],
    'DELIVERY': ['container_released'],
  };

  for (const [phase, states] of Object.entries(phaseStates)) {
    const phaseCount = Object.entries(stateCount)
      .filter(([state]) => states.includes(state))
      .reduce((sum, [, count]) => sum + count, 0);

    // Count unique shipments that have reached this phase
    let shipmentsInPhase = 0;
    for (const [, shipmentStateSet] of Object.entries(shipmentStates)) {
      if (states.some(s => shipmentStateSet.has(s))) {
        shipmentsInPhase++;
      }
    }

    console.log(`  ${phase.padEnd(20)} ${shipmentsInPhase.toString().padStart(4)} shipments have reached this phase`);
  }

  // Sample: Show journey for a few shipments
  console.log('\n\nSAMPLE JOURNEYS (first 10 shipments):');
  console.log('─'.repeat(60));

  let count = 0;
  for (const [bookingNumber, states] of Object.entries(shipmentStates)) {
    if (count >= 10) break;
    if (states.size === 0) continue;

    const sortedJourney = Array.from(states).sort((a, b) => {
      const orderA = Object.values(DIRECTION_WORKFLOW_MAPPING).find(m => m.state === a)?.order || 999;
      const orderB = Object.values(DIRECTION_WORKFLOW_MAPPING).find(m => m.state === b)?.order || 999;
      return orderA - orderB;
    });

    console.log(`\n  ${bookingNumber}:`);
    console.log(`    ${sortedJourney.join(' → ')}`);
    count++;
  }

  console.log('\n');
}

analyzeStateJourney().catch(console.error);
