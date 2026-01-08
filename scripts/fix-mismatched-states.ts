import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Document type to workflow state mapping (in priority order)
const WORKFLOW_PROGRESSION: Array<{
  docTypes: string[];
  state: string;
  phase: string;
  priority: number;
}> = [
  { docTypes: ['booking_confirmation'], state: 'booking_confirmed', phase: 'booking', priority: 10 },
  { docTypes: ['booking_amendment'], state: 'booking_amended', phase: 'booking', priority: 15 },
  { docTypes: ['shipping_instruction', 'si_draft', 'si_submission'], state: 'si_submitted', phase: 'pre_departure', priority: 20 },
  { docTypes: ['vgm_confirmation', 'vgm_submission'], state: 'vgm_submitted', phase: 'pre_departure', priority: 25 },
  { docTypes: ['gate_in_confirmation'], state: 'container_gated_in', phase: 'pre_departure', priority: 30 },
  { docTypes: ['hbl_draft'], state: 'hbl_draft_sent', phase: 'pre_departure', priority: 35 },
  { docTypes: ['bill_of_lading', 'house_bl'], state: 'bl_received', phase: 'pre_departure', priority: 45 },
  { docTypes: ['sob_confirmation', 'shipment_notice'], state: 'departed', phase: 'in_transit', priority: 50 },
  { docTypes: ['isf_filing', 'isf_submission'], state: 'isf_filed', phase: 'in_transit', priority: 55 },
  { docTypes: ['arrival_notice'], state: 'arrival_notice_received', phase: 'arrival', priority: 60 },
  { docTypes: ['entry_summary', 'draft_entry'], state: 'customs_cleared', phase: 'arrival', priority: 65 },
  { docTypes: ['delivery_order'], state: 'delivery_order_received', phase: 'arrival', priority: 70 },
  { docTypes: ['container_release'], state: 'container_released', phase: 'arrival', priority: 75 },
  { docTypes: ['proof_of_delivery'], state: 'delivered', phase: 'delivery', priority: 85 },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase');

  console.log('Checking', shipments?.length, 'shipments for state mismatches...');
  console.log(dryRun ? '(DRY RUN - no changes will be made)\n' : '\n');

  let fixed = 0;
  const fixes: Array<{ booking: string; from: string; to: string }> = [];

  for (const s of shipments || []) {
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type')
      .eq('shipment_id', s.id);

    const docTypes = docs?.map(d => d.document_type).filter(Boolean) || [];

    if (docTypes.length === 0) continue;

    // Find the highest priority matching state
    let bestMatch: { state: string; phase: string; priority: number } | null = null;

    for (const rule of WORKFLOW_PROGRESSION) {
      const hasMatch = rule.docTypes.some(dt => docTypes.includes(dt));
      if (hasMatch) {
        if (!bestMatch || rule.priority > bestMatch.priority) {
          bestMatch = rule;
        }
      }
    }

    if (!bestMatch) {
      bestMatch = { state: 'booking_confirmed', phase: 'booking', priority: 0 };
    }

    // Check if current state matches what it should be
    if (s.workflow_state !== bestMatch.state || s.workflow_phase !== bestMatch.phase) {
      fixes.push({
        booking: s.booking_number,
        from: `${s.workflow_state} / ${s.workflow_phase}`,
        to: `${bestMatch.state} / ${bestMatch.phase}`
      });

      if (!dryRun) {
        await supabase
          .from('shipments')
          .update({
            workflow_state: bestMatch.state,
            workflow_phase: bestMatch.phase,
            updated_at: new Date().toISOString()
          })
          .eq('id', s.id);
      }
      fixed++;
    }
  }

  console.log('Shipments with mismatched states:', fixed);
  console.log('');

  for (const f of fixes.slice(0, 10)) {
    console.log(f.booking);
    console.log('  FROM:', f.from);
    console.log('  TO:  ', f.to);
    console.log('');
  }

  if (fixes.length > 10) {
    console.log('... and', fixes.length - 10, 'more');
  }

  console.log(dryRun ? '\nRun without --dry-run to apply fixes' : '\nAll fixes applied!');
}

main().catch(console.error);
