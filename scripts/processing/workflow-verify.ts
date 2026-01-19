/**
 * Workflow State Verification Script
 *
 * Uses WorkflowStateManagementService to:
 * 1. Verify all workflow states
 * 2. Show gaps in classification/linking
 * 3. Optionally run backfill
 *
 * Usage:
 *   npx tsx scripts/workflow-verify.ts           # Verify only
 *   npx tsx scripts/workflow-verify.ts --backfill # Verify and backfill
 */
import { createClient } from '@supabase/supabase-js';
import { WorkflowStateManagementService } from '../lib/services/workflow-state-management-service';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  const service = new WorkflowStateManagementService(supabase);

  // Run verification
  const report = await service.verify();
  service.printReport(report);

  // Check if backfill requested
  if (process.argv.includes('--backfill')) {
    console.log('\n=== RUNNING BACKFILL ===\n');
    const result = await service.backfillFromDocuments();

    console.log(`Updated: ${result.updated}`);
    console.log(`Skipped: ${result.skipped}`);
    console.log(`Errors: ${result.errors}`);

    if (result.changes.length > 0) {
      console.log('\nChanges:');
      result.changes.slice(0, 20).forEach(c => {
        console.log(`  ${c.bookingNumber}: ${c.oldState} → ${c.newState}`);
      });
      if (result.changes.length > 20) {
        console.log(`  ... and ${result.changes.length - 20} more`);
      }
    }

    // Re-run verification after backfill
    console.log('\n=== POST-BACKFILL VERIFICATION ===\n');
    const postReport = await service.verify();
    service.printReport(postReport);
  }
}

run().catch(console.error);
