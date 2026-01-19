import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Complete STATE_ORDER (same as cohort API)
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
  'entry_summary_received': 168,
  'entry_summary_shared': 172,
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
const DISPLAY_STATES = [
  'booking_confirmation_received',
  'booking_confirmation_shared',
  'si_draft_received',
  'si_draft_sent',
  'checklist_received',
  'checklist_shared',
  'shipping_bill_received',
  'si_confirmed',
  'vgm_submitted',
  'sob_received',
  'bl_received',
  'hbl_draft_sent',
  'hbl_shared',
  'invoice_sent',
  'entry_draft_received',
  'entry_draft_shared',
  'entry_summary_received',
  'entry_summary_shared',
  'arrival_notice_received',
  'arrival_notice_shared',
  'cargo_released',
  'duty_invoice_received',
  'duty_summary_shared',
  'delivery_order_received',
  'delivery_order_shared',
  'container_released',
  'pod_received',
];

const LABELS: Record<string, string> = {
  'booking_confirmation_received': 'BC Received',
  'booking_confirmation_shared': 'BC Shared',
  'si_draft_received': 'SI Draft Received',
  'si_draft_sent': 'SI Draft Sent',
  'si_confirmed': 'SI Confirmed',
  'checklist_received': 'Checklist Received',
  'checklist_shared': 'Checklist Shared',
  'shipping_bill_received': 'LEO/SB Received',
  'vgm_submitted': 'VGM Submitted',
  'sob_received': 'SOB Received',
  'bl_received': 'BL Received',
  'hbl_draft_sent': 'HBL Draft Sent',
  'hbl_shared': 'HBL Shared',
  'invoice_sent': 'Invoice Sent',
  'arrival_notice_received': 'AN Received',
  'arrival_notice_shared': 'AN Shared',
  'entry_draft_received': 'Entry Draft Received',
  'entry_draft_shared': 'Entry Draft Shared',
  'entry_summary_received': 'Entry Summary Received',
  'entry_summary_shared': 'Entry Summary Shared',
  'duty_invoice_received': 'Duty Invoice Received',
  'duty_summary_shared': 'Duty Invoice Shared',
  'cargo_released': 'Cargo Released',
  'delivery_order_received': 'DO Received',
  'delivery_order_shared': 'DO Shared',
  'container_released': 'Container Released',
  'pod_received': 'POD Received',
};

async function run() {
  const { data: shipments } = await supabase.from('shipments').select('workflow_state');

  const total = shipments?.length || 0;

  console.log('=== CUMULATIVE WORKFLOW STATE DISTRIBUTION ===');
  console.log(`Total Shipments: ${total}\n`);
  console.log('State                           Count     %    (at or past this state)');
  console.log('─'.repeat(70));

  for (const state of DISPLAY_STATES) {
    const stateOrder = STATE_ORDER[state];
    // Count shipments at or past this state
    const atOrPast = shipments?.filter(s => {
      const order = STATE_ORDER[s.workflow_state || ''] || 0;
      return order >= stateOrder;
    }).length || 0;

    const pct = Math.round((atOrPast / total) * 100);
    const label = LABELS[state] || state;
    console.log(`${label.padEnd(30)}  ${atOrPast.toString().padStart(5)}   ${pct.toString().padStart(3)}%`);
  }
}

run();
