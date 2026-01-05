/**
 * Backfill Classification with Direction & Workflow State
 *
 * Updates all classifications with direction and workflow_state.
 * Uses existing document_type + detected direction to derive workflow_state.
 */

import { createClient } from '@supabase/supabase-js';
import { classifyDocument, getWorkflowState } from '../lib/services/unified-classification-service';
import { detectDirection } from '../lib/utils/direction-detector';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function backfillClassification() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('       CLASSIFICATION BACKFILL (Direction & Workflow State)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Fetch all classifications with their email sender
  console.log('Step 1: Fetching classifications with email data...');

  let allData: any[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('document_classifications')
      .select(`
        id,
        email_id,
        document_type,
        document_direction,
        workflow_state,
        raw_emails!inner(sender_email, true_sender_email)
      `)
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error fetching:', error);
      break;
    }

    if (!data || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < limit) break;
    offset += limit;
    process.stdout.write(`   Fetched ${allData.length}...\r`);
  }

  console.log(`   Found ${allData.length} classifications                    `);

  // Step 2: Update each classification
  console.log('\nStep 2: Updating direction and workflow_state...\n');

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  const directionCounts = { inbound: 0, outbound: 0 };
  const workflowStateCounts: Record<string, number> = {};

  for (let i = 0; i < allData.length; i++) {
    const row = allData[i];

    try {
      const email = (row as any).raw_emails || {};
      const senderEmail = email.true_sender_email || email.sender_email || '';

      // Detect direction from sender
      const direction = detectDirection(senderEmail);
      directionCounts[direction]++;

      // Get workflow state from EXISTING document_type + direction
      const documentType = row.document_type || 'unknown';
      const workflowState = getWorkflowState(documentType, direction);

      if (workflowState) {
        workflowStateCounts[workflowState] = (workflowStateCounts[workflowState] || 0) + 1;
      }

      // Only update if something changed
      if (row.document_direction !== direction || row.workflow_state !== workflowState) {
        const { error } = await supabase
          .from('document_classifications')
          .update({
            document_direction: direction,
            workflow_state: workflowState,
          })
          .eq('id', row.id);

        if (error) {
          errors++;
        } else {
          updated++;
        }
      } else {
        skipped++;
      }

      // Progress
      if ((i + 1) % 200 === 0) {
        process.stdout.write(`   Processed ${i + 1}/${allData.length} (${updated} updated, ${skipped} skipped)\r`);
      }
    } catch (err) {
      errors++;
    }
  }

  // Summary
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Summary:');
  console.log('─'.repeat(60));
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Errors:   ${errors}`);
  console.log('');
  console.log('Direction Distribution:');
  console.log('─'.repeat(60));
  console.log(`  Inbound:  ${directionCounts.inbound} (${(directionCounts.inbound / allData.length * 100).toFixed(1)}%)`);
  console.log(`  Outbound: ${directionCounts.outbound} (${(directionCounts.outbound / allData.length * 100).toFixed(1)}%)`);
  console.log('');
  console.log('Top Workflow States:');
  console.log('─'.repeat(60));
  Object.entries(workflowStateCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([state, count]) => {
      console.log(`  ${state.padEnd(40)} ${count.toString().padStart(5)}`);
    });

  // Count nulls
  const nullCount = allData.length - Object.values(workflowStateCounts).reduce((a, b) => a + b, 0);
  console.log(`  (no workflow state)                          ${nullCount.toString().padStart(5)}`);
  console.log('');
}

backfillClassification().catch(console.error);
