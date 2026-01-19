/**
 * Missing Document Analysis - Shows documents received out of order
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function showMissingDocAnalysis() {
  // Get all shipments with their documents
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state');

  const docToStage: Record<string, string> = {
    'booking_confirmation': 'BKG',
    'booking_amendment': 'BKG',
    'commercial_invoice': 'INV',
    'invoice': 'INV',
    'packing_list': 'PKG',
    'si_draft': 'SI',
    'shipping_instruction': 'SI',
    'shipping_instructions': 'SI',
    'sob_confirmation': 'SI',
    'vgm_confirmation': 'VGM',
    'bl_draft': 'BL',
    'hbl_draft': 'BL',
    'bill_of_lading': 'BL',
    'bl_released': 'BL',
    'hbl_released': 'BL',
    'arrival_notice': 'ARR',
    'customs_clearance': 'CUS',
    'customs_document': 'CUS',
    'delivery_order': 'DEL',
    'pickup_notification': 'DEL',
  };

  // Prerequisites - what MUST come before
  const prerequisites: Record<string, string[]> = {
    'BL': ['SI'],           // BL requires SI to have been submitted
    'ARR': ['BL'],          // Arrival notice should have BL
    'DEL': ['ARR', 'CUS'],  // Delivery requires arrival and customs
  };

  const missingStats: Record<string, number> = {};
  let criticalMissing = 0;

  for (const ship of shipments || []) {
    const { data: docs } = await supabase
      .from('document_lifecycle')
      .select('document_type')
      .eq('shipment_id', ship.id);

    const stagesReceived = new Set<string>();
    for (const d of docs || []) {
      const stage = docToStage[d.document_type];
      if (stage) stagesReceived.add(stage);
    }

    // Check prerequisites
    for (const [stage, prereqs] of Object.entries(prerequisites)) {
      if (stagesReceived.has(stage)) {
        for (const prereq of prereqs) {
          if (!stagesReceived.has(prereq)) {
            const key = stage + ' without ' + prereq;
            missingStats[key] = (missingStats[key] || 0) + 1;
            criticalMissing++;
          }
        }
      }
    }
  }

  console.log('MISSING DOCUMENT ANALYSIS');
  console.log('═'.repeat(60));
  console.log('');
  console.log('Business Rule Violations (document arrived without prerequisite):');
  console.log('');

  for (const [violation, count] of Object.entries(missingStats).sort((a, b) => b[1] - a[1])) {
    console.log('  ⚠️  ' + violation + ': ' + count + ' shipments');
  }

  console.log('');
  console.log('Total critical missing: ' + criticalMissing);
  console.log('');
  console.log('These would generate MISSING DOCUMENT ALERTS in Action Center');
}

showMissingDocAnalysis().catch(console.error);
