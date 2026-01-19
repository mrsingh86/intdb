/**
 * TEST SUPABASE API ACCESS
 *
 * Run this after forcing schema reload to verify API is working
 */

import { supabase } from '../utils/supabase-client';

async function testAPIAccess() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                 TESTING SUPABASE API ACCESS                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  try {
    // Test 1: raw_emails
    console.log('📧 Testing raw_emails table...');
    const { data: emails, error: emailError, count: emailCount } = await supabase
      .from('raw_emails')
      .select('*', { count: 'exact', head: true });

    if (emailError) {
      console.error('❌ raw_emails FAILED:', emailError.message);
    } else {
      console.log(`✅ raw_emails OK - ${emailCount} rows\n`);
    }

    // Test 2: document_classifications
    console.log('📋 Testing document_classifications table...');
    const { data: classifications, error: classError, count: classCount } = await supabase
      .from('document_classifications')
      .select('*', { count: 'exact', head: true });

    if (classError) {
      console.error('❌ document_classifications FAILED:', classError.message);
    } else {
      console.log(`✅ document_classifications OK - ${classCount} rows\n`);
    }

    // Test 3: entity_extractions
    console.log('🔍 Testing entity_extractions table...');
    const { data: entities, error: entityError, count: entityCount } = await supabase
      .from('entity_extractions')
      .select('*', { count: 'exact', head: true });

    if (entityError) {
      console.error('❌ entity_extractions FAILED:', entityError.message);
    } else {
      console.log(`✅ entity_extractions OK - ${entityCount} rows\n`);
    }

    // Test 4: raw_attachments
    console.log('📎 Testing raw_attachments table...');
    const { data: attachments, error: attachError, count: attachCount } = await supabase
      .from('raw_attachments')
      .select('*', { count: 'exact', head: true });

    if (attachError) {
      console.error('❌ raw_attachments FAILED:', attachError.message);
    } else {
      console.log(`✅ raw_attachments OK - ${attachCount} rows\n`);
    }

    // Test 5: Fetch sample email
    console.log('📬 Testing sample email fetch...');
    const { data: sampleEmail, error: sampleError } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email')
      .limit(1)
      .single();

    if (sampleError) {
      console.error('❌ Sample fetch FAILED:', sampleError.message);
    } else {
      console.log('✅ Sample email fetched:');
      console.log(`   ID: ${sampleEmail.id}`);
      console.log(`   Subject: ${sampleEmail.subject}`);
      console.log(`   From: ${sampleEmail.sender_email}\n`);
    }

    // Summary
    const allPassed = !emailError && !classError && !entityError && !attachError && !sampleError;

    console.log('╔════════════════════════════════════════════════════════════════════╗');
    console.log('║                         SUMMARY                                    ║');
    console.log('╚════════════════════════════════════════════════════════════════════╝\n');

    if (allPassed) {
      console.log('🎉 ALL TESTS PASSED - Supabase API is working!\n');
      console.log('You can now run:');
      console.log('  npx tsx scripts/reclassify-all-emails.ts\n');
    } else {
      console.log('⚠️  SOME TESTS FAILED - Schema cache may still be stale\n');
      console.log('Options:');
      console.log('  1. Wait 5-10 minutes and try again');
      console.log('  2. Restart your Supabase project from dashboard');
      console.log('  3. Use direct PostgreSQL connection: npx tsx scripts/reclassify-via-postgres.ts\n');
    }

  } catch (error: any) {
    console.error('❌ Unexpected error:', error.message);
  }
}

testAPIAccess().catch(console.error);
