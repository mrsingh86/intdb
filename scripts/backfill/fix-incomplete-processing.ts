/**
 * Fix Incomplete Processing
 *
 * Resets emails that were marked 'processed' without going through
 * the full pipeline (missing classification/extraction).
 *
 * This allows the production process-emails cron to re-process them correctly.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function fixIncompleteProcessing() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           FIX INCOMPLETE EMAIL PROCESSING                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Find emails marked processed but missing classification
  console.log('Step 1: Finding emails marked processed but missing classification...');

  const { data: processed } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('processing_status', 'processed');

  const { data: classified } = await supabase
    .from('email_classifications')
    .select('email_id');

  const classifiedIds = new Set(classified?.map(c => c.email_id));

  const incompleteEmails = processed?.filter(e => !classifiedIds.has(e.id)) || [];
  console.log('  Found ' + incompleteEmails.length + ' emails missing classification');

  if (incompleteEmails.length === 0) {
    console.log('\n✅ No incomplete emails found. All processed emails have classifications.');
    return;
  }

  // Step 2: Reset these emails to 'pending' status
  console.log('\nStep 2: Resetting ' + incompleteEmails.length + ' emails to pending status...');

  const emailIds = incompleteEmails.map(e => e.id);

  const { error: updateError } = await supabase
    .from('raw_emails')
    .update({
      processing_status: 'pending',
      updated_at: new Date().toISOString(),
    })
    .in('id', emailIds);

  if (updateError) {
    console.error('  Error resetting emails:', updateError);
    return;
  }

  console.log('  ✅ Reset ' + emailIds.length + ' emails to pending');

  // Step 3: Verify the reset
  console.log('\nStep 3: Verifying reset...');

  const { data: pendingAfter } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('processing_status', 'pending');

  console.log('  Pending emails after reset: ' + (pendingAfter?.length || 0));

  // Step 4: Summary
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                     SUMMARY                                        ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('Reset ' + incompleteEmails.length + ' emails from "processed" to "pending"');
  console.log('\nNEXT STEPS:');
  console.log('1. Run PDF extraction: curl http://localhost:3000/api/cron/extract-attachments');
  console.log('2. Run email processing: curl http://localhost:3000/api/cron/process-emails');
  console.log('3. Re-run tests: npx tsx scripts/pipeline-test.ts');
}

fixIncompleteProcessing().catch(console.error);
