import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Complete STATE_ORDER from database
const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'commercial_invoice_received': 20,
  'packing_list_received': 25,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'checklist_received': 40,
  'checklist_shared': 42,
  'checklist_shipper_approved': 44,
  'checklist_approved': 46,
  'shipping_bill_received': 48,
  'si_submitted': 55,
  'si_confirmed': 60,
  'vgm_submitted': 65,
  'vgm_confirmed': 68,
  'container_gated_in': 72,
  'sob_received': 80,
  'sob_shared': 85,
  'vessel_departed': 90,
  'isf_filed': 100,
  'isf_confirmed': 105,
  'mbl_draft_received': 110,
  'mbl_approved': 115,
  'mbl_received': 118,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_approved': 125,
  'hbl_released': 130,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'invoice_paid': 140,
  'docs_sent_to_broker': 150,
  'entry_draft_received': 153,
  'entry_draft_shared': 156,
  'entry_customer_approved': 159,
  'entry_approved': 162,
  'entry_filed': 165,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'customs_cleared': 190,
  'cargo_released': 192,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'delivery_order_shared': 210,
  'container_released': 220,
  'out_for_delivery': 225,
  'delivered': 230,
  'pod_received': 235,
  'empty_returned': 240,
  'shipment_closed': 245,
  'booking_cancelled': 999,
};

// Key milestones to display
const MILESTONES = [
  'booking_confirmation_received',
  'booking_confirmation_shared',
  'si_confirmed',
  'sob_received',
  'bl_received',
  'hbl_shared',
  'invoice_sent',
  'arrival_notice_shared',
  'cargo_released',
];

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

async function runCohortAnalysis() {
  console.log('Loading all data...');

  const shipments = await getAllRows<any>(supabase, 'shipments', 'id, booking_number, workflow_state');
  const docs = await getAllRows<any>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type');
  const emails = await getAllRows<any>(supabase, 'raw_emails', 'id, received_at');

  console.log('Shipments:', shipments.length);
  console.log('Documents:', docs.length);
  console.log('Emails:', emails.length);
  console.log('');

  const emailMap = new Map(emails.map((e: any) => [e.id, e]));
  const shipmentMap = new Map(shipments.map((s: any) => [s.id, s]));

  // Find earliest booking confirmation email date for each shipment
  const shipmentBookingDate = new Map<string, string>();
  for (const doc of docs) {
    if (doc.document_type === 'booking_confirmation' || doc.document_type === 'booking_amendment') {
      const email = emailMap.get(doc.email_id);
      if (!email || !email.received_at) continue;

      const receivedAt = new Date(email.received_at);
      const existing = shipmentBookingDate.get(doc.shipment_id);
      if (!existing || receivedAt < new Date(existing)) {
        shipmentBookingDate.set(doc.shipment_id, email.received_at);
      }
    }
  }

  // Group by week
  const byWeek: Record<string, any[]> = {};
  for (const [shipmentId, bookingDate] of shipmentBookingDate) {
    const shipment = shipmentMap.get(shipmentId);
    if (!shipment) continue;
    const week = getWeekStart(bookingDate);
    if (!byWeek[week]) byWeek[week] = [];
    byWeek[week].push(shipment);
  }

  const weeks = Object.keys(byWeek).sort();

  console.log('WEEKLY COHORT ANALYSIS - Cumulative % at Each Milestone');
  console.log('Cohort = Shipments by Booking Confirmation Received Date');
  console.log('═'.repeat(120));
  console.log('');

  // Header
  let header = 'State'.padEnd(30);
  for (const week of weeks) {
    header += week.substring(5).padStart(10);
  }
  header += 'TOTAL'.padStart(10);
  console.log(header);
  console.log('─'.repeat(120));

  // For each milestone
  for (const state of MILESTONES) {
    const stateOrder = STATE_ORDER[state];
    let row = state.padEnd(30);

    for (const week of weeks) {
      const cohort = byWeek[week];
      const total = cohort.length;

      let reached = 0;
      for (const s of cohort) {
        const shipOrder = STATE_ORDER[s.workflow_state] || 0;
        if (shipOrder >= stateOrder) reached++;
      }

      const pct = total > 0 ? Math.round((reached / total) * 100) : 0;
      row += (pct + '%').padStart(10);
    }

    // Total
    const allShipments = weeks.flatMap(w => byWeek[w]);
    const allTotal = allShipments.length;
    let totalReached = 0;
    for (const s of allShipments) {
      const shipOrder = STATE_ORDER[s.workflow_state] || 0;
      if (shipOrder >= stateOrder) totalReached++;
    }
    const totalPct = allTotal > 0 ? Math.round((totalReached / allTotal) * 100) : 0;
    row += (totalPct + '%').padStart(10);

    console.log(row);
  }

  console.log('─'.repeat(120));

  // Count row
  let countRow = 'Shipments'.padEnd(30);
  for (const week of weeks) {
    countRow += byWeek[week].length.toString().padStart(10);
  }
  const allTotal = weeks.reduce((sum, w) => sum + byWeek[w].length, 0);
  countRow += allTotal.toString().padStart(10);
  console.log(countRow);
}

runCohortAnalysis();
