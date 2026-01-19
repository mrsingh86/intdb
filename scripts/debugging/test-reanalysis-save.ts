/**
 * Test Reanalysis Service - Verify dates are saved
 */

import { createClient } from '@supabase/supabase-js';
import { ReanalysisService } from '../../lib/chronicle/reanalysis-service';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
  console.log('Testing reanalysis service with date saving...\n');

  // Get a sample email that has dates in body
  const testId = 'b585b989-5a50-4597-90c3-0dc1d92d293f'; // Matangi arrival notice

  // Check before values
  const { data: before } = await supabase
    .from('chronicle')
    .select('id, subject, etd, eta, last_free_day, needs_reanalysis')
    .eq('id', testId)
    .single();

  console.log('BEFORE:');
  console.log(`  ETD: ${before?.etd || 'NULL'}`);
  console.log(`  ETA: ${before?.eta || 'NULL'}`);
  console.log(`  LFD: ${before?.last_free_day || 'NULL'}`);
  console.log(`  needs_reanalysis: ${before?.needs_reanalysis}`);

  // Reset this record and run reanalysis directly
  // First, clear needs_reanalysis on all others temporarily
  await supabase
    .from('chronicle')
    .update({ needs_reanalysis: false })
    .neq('id', testId)
    .eq('needs_reanalysis', true);

  // Mark only our test record
  await supabase
    .from('chronicle')
    .update({ needs_reanalysis: true, reanalyzed_at: null })
    .eq('id', testId);

  // Run reanalysis
  const service = new ReanalysisService(supabase);
  const result = await service.reanalyzeBatch(1);

  // Re-mark the others for later processing
  await supabase
    .from('chronicle')
    .update({ needs_reanalysis: true })
    .in('document_type', ['arrival_notice', 'booking_confirmation', 'delivery_order'])
    .is('needs_reanalysis', false)
    .gt('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  console.log(`\nReanalysis result: ${result.succeeded} succeeded, ${result.failed} failed`);

  // Check after values
  const { data: after } = await supabase
    .from('chronicle')
    .select('id, subject, etd, eta, last_free_day, needs_reanalysis, reanalyzed_at')
    .eq('id', testId)
    .single();

  console.log('\nAFTER:');
  console.log(`  ETD: ${after?.etd || 'NULL'}`);
  console.log(`  ETA: ${after?.eta || 'NULL'}`);
  console.log(`  LFD: ${after?.last_free_day || 'NULL'}`);
  console.log(`  needs_reanalysis: ${after?.needs_reanalysis}`);
  console.log(`  reanalyzed_at: ${after?.reanalyzed_at}`);

  // Verify dates were saved
  if (after?.eta || after?.last_free_day) {
    console.log('\n✅ SUCCESS - Dates were saved!');
  } else {
    console.log('\n⚠️ Dates still NULL - check if email body has dates');
  }
}

test().catch(console.error);
