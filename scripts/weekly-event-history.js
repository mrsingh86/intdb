require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// State order for display
const STATE_ORDER = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'commercial_invoice_received': 20,
  'packing_list_received': 25,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'si_submitted': 55,
  'si_confirmed': 60,
  'vgm_pending': 62,
  'vgm_submitted': 65,
  'vgm_confirmed': 68,
  'container_gated_in': 72,
  'sob_received': 80,
  'sob_shared': 85,
  'isf_filed': 100,
  'isf_confirmed': 105,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_released': 130,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'invoice_paid': 140,
  'entry_draft_received': 153,
  'entry_draft_shared': 156,
  'entry_summary_received': 168,
  'entry_summary_shared': 172,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'customs_cleared': 190,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'delivery_order_shared': 210,
  'container_released': 220,
  'delivered': 230,
  'pod_received': 235,
  'booking_cancelled': 999,
};

// Extended funnel states - all key milestones
const FUNNEL_STATES = [
  'booking_confirmation_received',
  'booking_confirmation_shared',
  'si_draft_received',
  'si_confirmed',
  'vgm_confirmed',
  'sob_received',
  'bl_received',
  'hbl_shared',
  'invoice_sent',
  'entry_summary_received',
  'arrival_notice_received',
  'duty_invoice_received',
  'delivery_order_received',
  'container_released',
  'pod_received',
];

// Short names for display
const STATE_SHORT_NAMES = {
  'booking_confirmation_received': 'BC_R',
  'booking_confirmation_shared': 'BC_S',
  'si_draft_received': 'SI_R',
  'si_confirmed': 'SI_C',
  'vgm_confirmed': 'VGM',
  'sob_received': 'SOB',
  'bl_received': 'BL_R',
  'hbl_shared': 'HBL_S',
  'invoice_sent': 'INV',
  'entry_summary_received': 'ENTRY',
  'arrival_notice_received': 'AN_R',
  'duty_invoice_received': 'DUTY',
  'delivery_order_received': 'DO',
  'container_released': 'REL',
  'pod_received': 'POD',
};

async function getAllRows(table, selectCols = '*') {
  const allRows = [];
  let offset = 0;
  const batchSize = 1000;
  while (true) {
    const { data, error } = await supabase.from(table).select(selectCols).range(offset, offset + batchSize - 1);
    if (error || !data || data.length === 0) break;
    allRows.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return allRows;
}

function getWeekStart(dateStr) {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  return monday.toISOString().substring(0, 10);
}

function getWeekLabel(weekStart) {
  const date = new Date(weekStart);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const day = date.getDate();
  return `${month} ${day}`;
}

async function generateWeeklyReport() {
  console.log('='.repeat(180));
  console.log('WEEKLY EVENT HISTORY - EXTENDED WORKFLOW STATES (by First Email Received)');
  console.log('='.repeat(180));

  // Fetch data
  const shipments = await getAllRows('shipments', 'id, booking_number, created_at, workflow_state');
  const events = await getAllRows('shipment_workflow_events', 'shipment_id, workflow_state, occurred_at');
  const docs = await getAllRows('shipment_documents', 'shipment_id, email_id');
  const emails = await getAllRows('raw_emails', 'id, received_at');

  console.log('\nData: ' + shipments.length + ' shipments, ' + events.length + ' events\n');

  // Build email date lookup
  const emailDateMap = new Map();
  for (const email of emails) {
    emailDateMap.set(email.id, email.received_at);
  }

  // Find first email date for each shipment
  const shipmentFirstEmail = new Map();
  for (const doc of docs) {
    const emailDate = emailDateMap.get(doc.email_id);
    if (emailDate) {
      const existing = shipmentFirstEmail.get(doc.shipment_id);
      if (!existing || new Date(emailDate) < new Date(existing)) {
        shipmentFirstEmail.set(doc.shipment_id, emailDate);
      }
    }
  }

  // Build event lookup: shipment_id -> Set of states reached
  const shipmentStates = new Map();
  for (const event of events) {
    if (!shipmentStates.has(event.shipment_id)) {
      shipmentStates.set(event.shipment_id, new Set());
    }
    shipmentStates.get(event.shipment_id).add(event.workflow_state);
  }

  // Group shipments by week of first email
  const weeklyData = {};
  for (const shipment of shipments) {
    const firstEmailDate = shipmentFirstEmail.get(shipment.id);
    if (!firstEmailDate) continue;

    const weekStart = getWeekStart(firstEmailDate);
    if (!weeklyData[weekStart]) {
      weeklyData[weekStart] = {
        shipments: [],
        stateCounts: {},
      };
    }
    weeklyData[weekStart].shipments.push({
      ...shipment,
      firstEmailDate,
    });

    const states = shipmentStates.get(shipment.id) || new Set();
    for (const state of states) {
      weeklyData[weekStart].stateCounts[state] = (weeklyData[weekStart].stateCounts[state] || 0) + 1;
    }
  }

  const sortedWeeks = Object.keys(weeklyData).sort();

  // Print extended summary table
  console.log('='.repeat(180));
  console.log('WEEKLY SUMMARY - ALL KEY WORKFLOW STATES');
  console.log('='.repeat(180));

  // Header
  let header = 'Week'.padEnd(10) + 'Tot'.padStart(4);
  for (const state of FUNNEL_STATES) {
    header += (STATE_SHORT_NAMES[state] || state.substring(0, 5)).padStart(8);
  }
  console.log(header);
  console.log('-'.repeat(180));

  for (const week of sortedWeeks) {
    const data = weeklyData[week];
    const total = data.shipments.length;
    let row = getWeekLabel(week).padEnd(10) + total.toString().padStart(4);

    for (const state of FUNNEL_STATES) {
      const count = data.stateCounts[state] || 0;
      row += count.toString().padStart(8);
    }
    console.log(row);
  }

  // Totals row
  console.log('-'.repeat(180));
  let totalRow = 'TOTAL'.padEnd(10) + shipments.length.toString().padStart(4);
  for (const state of FUNNEL_STATES) {
    let stateTotal = 0;
    for (const week of sortedWeeks) {
      stateTotal += weeklyData[week].stateCounts[state] || 0;
    }
    totalRow += stateTotal.toString().padStart(8);
  }
  console.log(totalRow);

  // Percentage table
  console.log('\n');
  console.log('='.repeat(180));
  console.log('WEEKLY SUMMARY - PERCENTAGE OF SHIPMENTS REACHING EACH STATE');
  console.log('='.repeat(180));

  header = 'Week'.padEnd(10) + 'Tot'.padStart(4);
  for (const state of FUNNEL_STATES) {
    header += (STATE_SHORT_NAMES[state] || state.substring(0, 5)).padStart(8);
  }
  console.log(header);
  console.log('-'.repeat(180));

  for (const week of sortedWeeks) {
    const data = weeklyData[week];
    const total = data.shipments.length;
    let row = getWeekLabel(week).padEnd(10) + total.toString().padStart(4);

    for (const state of FUNNEL_STATES) {
      const count = data.stateCounts[state] || 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      row += (pct + '%').padStart(8);
    }
    console.log(row);
  }

  // ALL states breakdown per week
  console.log('\n\n');
  console.log('='.repeat(180));
  console.log('COMPLETE STATE BREAKDOWN BY WEEK');
  console.log('='.repeat(180));

  for (const week of sortedWeeks) {
    const data = weeklyData[week];
    const total = data.shipments.length;

    console.log('\n### Week of ' + week + ' (' + total + ' shipments)');
    console.log('-'.repeat(100));

    // Sort all states by order
    const sortedStates = Object.entries(data.stateCounts)
      .map(([state, count]) => ({ state, count, order: STATE_ORDER[state] || 500 }))
      .sort((a, b) => a.order - b.order);

    // Group by phase
    const phases = {
      'PRE_DEPARTURE': sortedStates.filter(s => s.order < 100),
      'IN_TRANSIT': sortedStates.filter(s => s.order >= 100 && s.order < 150),
      'PRE_ARRIVAL/CUSTOMS': sortedStates.filter(s => s.order >= 150 && s.order < 180),
      'ARRIVAL': sortedStates.filter(s => s.order >= 180 && s.order < 220),
      'DELIVERY': sortedStates.filter(s => s.order >= 220 && s.order < 999),
      'CANCELLED': sortedStates.filter(s => s.order === 999),
    };

    for (const [phase, states] of Object.entries(phases)) {
      if (states.length === 0) continue;

      console.log('\n  ' + phase + ':');
      for (const { state, count } of states) {
        const pct = Math.round((count / total) * 100);
        const bar = '█'.repeat(Math.min(Math.round(pct / 2), 40));
        console.log('    ' + state.padEnd(35) + count.toString().padStart(4) + ' (' + (pct + '%').padStart(4) + ')  ' + bar);
      }
    }
  }

  // Visual funnel
  console.log('\n\n');
  console.log('='.repeat(180));
  console.log('VISUAL FUNNEL - WORKFLOW PROGRESSION BY WEEK');
  console.log('='.repeat(180));

  console.log('\nLegend: ████ 80%+  ███░ 60-79%  ██░░ 40-59%  █░░░ 20-39%  ░░░░ 1-19%  ---- 0%\n');

  header = 'Week'.padEnd(10);
  for (const state of FUNNEL_STATES) {
    header += (STATE_SHORT_NAMES[state] || state.substring(0, 6)).padStart(9);
  }
  console.log(header);
  console.log('-'.repeat(150));

  for (const week of sortedWeeks) {
    const data = weeklyData[week];
    const total = data.shipments.length;
    let row = getWeekLabel(week).padEnd(10);

    for (const state of FUNNEL_STATES) {
      const count = data.stateCounts[state] || 0;
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;

      let indicator = '';
      if (pct >= 80) indicator = '████';
      else if (pct >= 60) indicator = '███░';
      else if (pct >= 40) indicator = '██░░';
      else if (pct >= 20) indicator = '█░░░';
      else if (pct > 0) indicator = '░░░░';
      else indicator = '----';

      row += (indicator + pct).padStart(9);
    }
    console.log(row);
  }

  // Customs/Entry specific analysis
  console.log('\n\n');
  console.log('='.repeat(100));
  console.log('CUSTOMS & ENTRY SUMMARY (US Import States)');
  console.log('='.repeat(100));

  const customsStates = [
    'isf_filed', 'isf_confirmed',
    'entry_draft_received', 'entry_draft_shared',
    'entry_summary_received', 'entry_summary_shared',
    'customs_cleared',
    'duty_invoice_received', 'duty_summary_shared',
  ];

  console.log('\nWeek'.padEnd(12) + customsStates.map(s => s.replace('_received', '_R').replace('_shared', '_S').replace('entry_', 'E_').replace('summary', 'sum').substring(0, 10).padStart(12)).join(''));
  console.log('-'.repeat(100));

  for (const week of sortedWeeks) {
    const data = weeklyData[week];
    const total = data.shipments.length;
    let row = getWeekLabel(week).padEnd(12);

    for (const state of customsStates) {
      const count = data.stateCounts[state] || 0;
      row += count.toString().padStart(12);
    }
    console.log(row);
  }

  // Total customs
  console.log('-'.repeat(100));
  let customsTotalRow = 'TOTAL'.padEnd(12);
  for (const state of customsStates) {
    let stateTotal = 0;
    for (const week of sortedWeeks) {
      stateTotal += weeklyData[week].stateCounts[state] || 0;
    }
    customsTotalRow += stateTotal.toString().padStart(12);
  }
  console.log(customsTotalRow);

  console.log('\n' + '='.repeat(180));
}

generateWeeklyReport().catch(console.error);
