/**
 * Document Journey Grid - Shipments (Y) x Document Stages (X)
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function documentGrid() {
  // Document stages in chronological order (X-axis)
  const stages = [
    'BKG',  // Booking
    'INV',  // Invoice
    'PKG',  // Packing
    'SI',   // Shipping Instructions
    'VGM',  // VGM
    'BL-D', // BL Draft
    'BL-R', // BL Released
    'ARR',  // Arrival
    'CUS',  // Customs
    'DEL'   // Delivery
  ];

  // Map document types to stages
  const docToStage: Record<string, string> = {
    'booking_confirmation': 'BKG',
    'booking_request': 'BKG',
    'booking_amendment': 'BKG',
    'commercial_invoice': 'INV',
    'proforma_invoice': 'INV',
    'invoice': 'INV',
    'tax_invoice': 'INV',
    'packing_list': 'PKG',
    'si_draft': 'SI',
    'shipping_instruction': 'SI',
    'si_submission': 'SI',
    'bl_instruction': 'SI',
    'sob_confirmation': 'SI',
    'checklist': 'SI',
    'forwarding_note': 'SI',
    'vgm_confirmation': 'VGM',
    'vgm_submission': 'VGM',
    'bl_draft': 'BL-D',
    'hbl_draft': 'BL-D',
    'bill_of_lading': 'BL-D',
    'bl_released': 'BL-R',
    'hbl_released': 'BL-R',
    'telex_release': 'BL-R',
    'arrival_notice': 'ARR',
    'customs_clearance': 'CUS',
    'customs_document': 'CUS',
    'isf_filing': 'CUS',
    'duty_entry': 'CUS',
    'delivery_order': 'DEL',
    'pod_confirmation': 'DEL',
    'pickup_notification': 'DEL',
    'delivery_coordination': 'DEL',
  };

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state')
    .order('created_at', { ascending: true });

  // Build the grid
  const grid: { booking: string; stages: Record<string, boolean>; workflow: string }[] = [];

  for (const ship of shipments || []) {
    const { data: docs } = await supabase
      .from('document_lifecycle')
      .select('document_type')
      .eq('shipment_id', ship.id);

    const stageStatus: Record<string, boolean> = {};
    for (const stage of stages) {
      stageStatus[stage] = false;
    }

    for (const doc of docs || []) {
      const stage = docToStage[doc.document_type];
      if (stage) {
        stageStatus[stage] = true;
      }
    }

    grid.push({
      booking: (ship.booking_number || 'N/A').substring(0, 20),
      stages: stageStatus,
      workflow: ship.workflow_state || ''
    });
  }

  // Print header
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('                    DOCUMENT JOURNEY GRID - ALL SHIPMENTS');
  console.log('                    Y-Axis: Shipments | X-Axis: Document Stages');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Stages: BKG=Booking | INV=Invoice | PKG=Packing | SI=Shipping Instr | VGM=VGM');
  console.log('        BL-D=BL Draft | BL-R=BL Released | ARR=Arrival | CUS=Customs | DEL=Delivery');
  console.log('');
  console.log('Legend: ● = Received | ○ = Not received');
  console.log('');

  // Column headers
  const header = 'BOOKING #'.padEnd(22) + '│' + stages.map(s => s.padStart(5)).join('│') + '│ WORKFLOW';
  console.log(header);
  console.log('─'.repeat(22) + '┼' + stages.map(() => '─────').join('┼') + '┼' + '─'.repeat(20));

  // Print each row
  for (const row of grid) {
    const cells = stages.map(stage => {
      const val = row.stages[stage] ? '  ●  ' : '  ○  ';
      return val;
    }).join('│');

    console.log(row.booking.padEnd(22) + '│' + cells + '│ ' + row.workflow);
  }

  console.log('─'.repeat(22) + '┴' + stages.map(() => '─────').join('┴') + '┴' + '─'.repeat(20));

  // Summary row
  const totals = stages.map(stage => {
    const count = grid.filter(r => r.stages[stage]).length;
    return String(count).padStart(5);
  }).join('│');

  console.log('TOTAL'.padEnd(22) + '│' + totals + '│');

  const pcts = stages.map(stage => {
    const count = grid.filter(r => r.stages[stage]).length;
    const pct = Math.round((count / grid.length) * 100);
    return (pct + '%').padStart(5);
  }).join('│');

  console.log('%'.padEnd(22) + '│' + pcts + '│');

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');
  console.log(`TOTAL SHIPMENTS: ${grid.length}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════════════');

  // Workflow distribution
  console.log('');
  console.log('WORKFLOW DISTRIBUTION:');
  const workflowCounts: Record<string, number> = {};
  for (const row of grid) {
    workflowCounts[row.workflow] = (workflowCounts[row.workflow] || 0) + 1;
  }
  for (const [wf, count] of Object.entries(workflowCounts).sort((a, b) => b[1] - a[1])) {
    const bar = '█'.repeat(Math.floor((count / grid.length) * 40));
    console.log(`  ${wf.padEnd(30)} ${String(count).padStart(3)} ${bar}`);
  }
}

documentGrid().catch(console.error);
