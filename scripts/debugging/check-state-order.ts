import { createClient } from '@supabase/supabase-js';
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
  'checklist_received': 40,
  'checklist_shared': 42,
  'shipping_bill_received': 48,
  'si_confirmed': 60,
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
  'pod_received': 235,
};

async function run() {
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state');

  const missing: string[] = [];
  const statesWithOrder: Record<string, { count: number; order: number }> = {};

  for (const s of shipments || []) {
    const state = s.workflow_state || 'NULL';
    const order = STATE_ORDER[state];

    if (order === undefined && state !== 'NULL') {
      if (!missing.includes(state)) missing.push(state);
    }

    if (!statesWithOrder[state]) {
      statesWithOrder[state] = { count: 0, order: order || -1 };
    }
    statesWithOrder[state].count++;
  }

  console.log('=== STATES WITH ORDER VALUES ===\n');
  Object.entries(statesWithOrder)
    .sort((a, b) => a[1].order - b[1].order)
    .forEach(([state, info]) => {
      const orderStr = info.order === -1 ? 'MISSING' : info.order.toString();
      console.log(`  ${info.count.toString().padStart(4)}  ${state.padEnd(35)} order: ${orderStr}`);
    });

  if (missing.length > 0) {
    console.log('\n=== STATES MISSING FROM STATE_ORDER ===\n');
    missing.forEach(s => console.log('  - ' + s));
    console.log('\nThese states have order=-1, so they show as "not reached" for any state!');
  }
}

run();
