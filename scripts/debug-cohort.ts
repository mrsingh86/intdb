import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'si_confirmed': 60,
  'vgm_submitted': 65,
  'sob_received': 80,
  'mbl_draft_received': 110,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'cargo_released': 192,
  'pod_received': 235,
};

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

async function debug() {
  const shipments = await getAllRows<any>(supabase, 'shipments', 'id, booking_number, workflow_state');
  const docs = await getAllRows<any>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type');
  const emails = await getAllRows<any>(supabase, 'raw_emails', 'id, received_at');

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

  // Check week 2025-12-08
  const targetWeek = '2025-12-08';
  const cohort = byWeek[targetWeek] || [];

  console.log('Debugging week:', targetWeek);
  console.log('Cohort size:', cohort.length);
  console.log('');

  // Check each shipment
  let reached = 0;
  let notReached = 0;

  for (const s of cohort) {
    const order = STATE_ORDER[s.workflow_state] || 0;
    if (order >= 10) { // booking_confirmation_received order
      reached++;
    } else {
      notReached++;
      console.log('NOT REACHED:', s.booking_number, '| workflow_state:', s.workflow_state, '| order:', order);
    }
  }

  console.log('');
  console.log('Reached booking_confirmation_received:', reached);
  console.log('Not reached:', notReached);
  console.log('Percentage:', Math.round((reached / cohort.length) * 100) + '%');
}

debug();
