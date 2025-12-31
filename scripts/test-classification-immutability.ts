/**
 * Test Classification Immutability
 * Reclassifies an already-classified email to see if:
 * a) New row is inserted (IMMUTABLE) or
 * b) Existing row is updated (MUTABLE)
 */

import { supabase } from '../utils/supabase-client';

async function testImmutability() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         CLASSIFICATION IMMUTABILITY TEST                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Email 1 from thread HL-35897776
  const testEmailId = 'fff8f524-5d41-4442-a07e-b6aa5e9bfbb1';
  const testEmailSubject = 'HL-35897776 USSAV ACCUM';

  console.log(`📧 Test Email: ${testEmailSubject}`);
  console.log(`   Email ID: ${testEmailId}\n`);

  // Step 1: Check current classifications
  console.log('STEP 1: Check existing classifications\n');
  const { data: existingClassifications } = await supabase
    .from('document_classifications')
    .select('*')
    .eq('email_id', testEmailId)
    .order('created_at', { ascending: true });

  console.log(`   Found ${existingClassifications?.length || 0} existing classification(s):\n`);
  existingClassifications?.forEach((c: any, idx: number) => {
    console.log(`   ${idx + 1}. ID: ${c.id}`);
    console.log(`      Type: ${c.document_type} (${c.confidence_score}% confidence)`);
    console.log(`      Created: ${new Date(c.created_at).toLocaleString()}`);
    console.log('');
  });

  // Step 2: Attempt to INSERT a new classification
  console.log('─'.repeat(100));
  console.log('STEP 2: Insert new classification (different type)\n');

  try {
    const { data: newClassification, error } = await supabase
      .from('document_classifications')
      .insert({
        email_id: testEmailId,
        document_type: 'amendment',  // Different from original 'booking_confirmation'
        confidence_score: 88,
        model_name: 'claude-3-5-haiku',
        model_version: '20241022',
        classification_reason: 'TEST: Reclassifying to check immutability',
        matched_patterns: { test: true }
      })
      .select();

    if (error) {
      console.log('   ❌ INSERT FAILED:');
      console.log(`      Error: ${error.message}`);
      console.log(`      Code: ${error.code}`);

      if (error.code === '23505') {
        console.log('\n   🔍 ANALYSIS: Unique constraint violation');
        console.log('      Result: Classifications are MUTABLE (can only have 1 per email)');
        console.log('      Behavior: Must UPDATE existing row to change classification');
      }
    } else {
      console.log('   ✅ INSERT SUCCESSFUL:');
      console.log(`      New classification ID: ${newClassification?.[0]?.id}`);
      console.log(`      Type: ${newClassification?.[0]?.document_type}`);
      console.log('\n   🔍 ANALYSIS: New row inserted');
      console.log('      Result: Classifications are IMMUTABLE (preserves history)');
      console.log('      Behavior: Each classification creates new row');
    }
  } catch (err: any) {
    console.error('   ❌ Unexpected error:', err.message);
  }

  // Step 3: Check final state
  console.log('\n' + '─'.repeat(100));
  console.log('STEP 3: Check final state\n');

  const { data: finalClassifications } = await supabase
    .from('document_classifications')
    .select('*')
    .eq('email_id', testEmailId)
    .order('created_at', { ascending: true });

  console.log(`   Total classifications now: ${finalClassifications?.length || 0}\n`);
  finalClassifications?.forEach((c: any, idx: number) => {
    console.log(`   ${idx + 1}. ID: ${c.id}`);
    console.log(`      Type: ${c.document_type} (${c.confidence_score}% confidence)`);
    console.log(`      Created: ${new Date(c.created_at).toLocaleString()}`);
    console.log(`      Reason: ${c.classification_reason?.substring(0, 50)}...`);
    console.log('');
  });

  // Step 4: Cleanup (delete test classification if inserted)
  if (finalClassifications && finalClassifications.length > 1) {
    console.log('─'.repeat(100));
    console.log('STEP 4: Cleanup - Removing test classification\n');

    // Delete the newest one (the test)
    const testClassification = finalClassifications[finalClassifications.length - 1];
    await supabase
      .from('document_classifications')
      .delete()
      .eq('id', testClassification.id);

    console.log(`   ✅ Deleted test classification ${testClassification.id}\n`);
  }

  // Final answer
  console.log('═'.repeat(100));
  console.log('FINAL ANSWER');
  console.log('═'.repeat(100));

  if (finalClassifications && finalClassifications.length > 1) {
    console.log('\n✅ Classifications are IMMUTABLE (by insertion)\n');
    console.log('   • Each reclassification creates a NEW row');
    console.log('   • Classification history is PRESERVED');
    console.log('   • You can see progression: booking_confirmation → amendment → etc.');
    console.log('   • No data is lost when AI reclassifies\n');
  } else {
    console.log('\n⚠️  Classifications are MUTABLE (by update) or CONSTRAINED\n');
    console.log('   • Only ONE classification per email allowed');
    console.log('   • Reclassification would OVERWRITE previous classification');
    console.log('   • Classification history is LOST');
    console.log('   • Need unique constraint on (email_id) to prevent duplicates\n');
  }
}

testImmutability().catch(console.error);
