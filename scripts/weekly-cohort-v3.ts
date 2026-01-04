import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'si_draft_received': 30,
  'si_confirmed': 60,
  'sob_received': 80,
  'mbl_draft_received': 110,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'cargo_released': 192,
  'pod_received': 235,
};

// All states to show
const ALL_STATES = Object.keys(STATE_ORDER).sort((a, b) => STATE_ORDER[a] - STATE_ORDER[b]);

// Get week start (Monday) for a date
function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

interface Shipment { id: string; booking_number: string; workflow_state: string | null }
interface Doc { shipment_id: string; email_id: string; document_type: string }
interface Email { id: string; received_at: string }

async function runCohortAnalysis() {
  console.log('Loading all data with pagination...');

  const shipments = await getAllRows<Shipment>(supabase, 'shipments', 'id, booking_number, workflow_state');
  const docs = await getAllRows<Doc>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type');
  const emails = await getAllRows<Email>(supabase, 'raw_emails', 'id, received_at');

  console.log('Shipments:', shipments.length);
  console.log('Documents:', docs.length);
  console.log('Emails:', emails.length);
  console.log('');

  const emailMap = new Map(emails.map(e => [e.id, e]));
  const shipmentMap = new Map(shipments.map(s => [s.id, s]));

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

  // Group shipments by week of booking confirmation
  const byWeek: Record<string, Shipment[]> = {};
  for (const [shipmentId, bookingDate] of shipmentBookingDate) {
    const shipment = shipmentMap.get(shipmentId);
    if (!shipment) continue;

    const week = getWeekStart(bookingDate);
    if (!byWeek[week]) byWeek[week] = [];
    byWeek[week].push(shipment);
  }

  const weeks = Object.keys(byWeek).sort();

  console.log('WEEKLY COHORT ANALYSIS - Cumulative % at Each State');
  console.log('Based on Booking Confirmation Received Date');
  console.log('═'.repeat(100));
  console.log('');

  // Build header with weeks
  let header = 'State'.padEnd(35);
  for (const week of weeks) {
    header += week.substring(5).padStart(10); // Show MM-DD only
  }
  header += 'TOTAL'.padStart(10);
  console.log(header);
  console.log('─'.repeat(100));

  // For each state, show % for each week
  for (const state of ALL_STATES) {
    const stateOrder = STATE_ORDER[state];
    let row = state.padEnd(35);

    for (const week of weeks) {
      const cohort = byWeek[week];
      const total = cohort.length;

      let reached = 0;
      for (const s of cohort) {
        const shipOrder = STATE_ORDER[s.workflow_state || ''] || 0;
        if (shipOrder >= stateOrder) reached++;
      }

      const pct = total > 0 ? Math.round((reached / total) * 100) : 0;
      row += (pct + '%').padStart(10);
    }

    // Total column
    const allShipments = weeks.flatMap(w => byWeek[w]);
    const allTotal = allShipments.length;
    let totalReached = 0;
    for (const s of allShipments) {
      const shipOrder = STATE_ORDER[s.workflow_state || ''] || 0;
      if (shipOrder >= stateOrder) totalReached++;
    }
    const totalPct = allTotal > 0 ? Math.round((totalReached / allTotal) * 100) : 0;
    row += (totalPct + '%').padStart(10);

    console.log(row);
  }

  console.log('─'.repeat(100));

  // Show count row
  let countRow = 'Shipments'.padEnd(35);
  for (const week of weeks) {
    countRow += byWeek[week].length.toString().padStart(10);
  }
  const allTotal = weeks.reduce((sum, w) => sum + byWeek[w].length, 0);
  countRow += allTotal.toString().padStart(10);
  console.log(countRow);
}

runCohortAnalysis().catch(console.error);
