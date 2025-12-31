/**
 * Test script for EmailIngestionAgent
 * Run this to verify the agent is working correctly
 */

import dotenv from 'dotenv';
import EmailIngestionAgent from '../agents/email-ingestion-agent';
import { supabase } from '../utils/supabase-client';

dotenv.config();

async function testEmailAgent() {
  console.log('\n🧪 Testing EmailIngestionAgent\n');
  console.log('=' . repeat(50));

  try {
    // Step 1: Test database connection
    console.log('\n1️⃣  Testing Database Connection...');
    const { data: carriers, error: dbError } = await supabase
      .from('carrier_configs')
      .select('id, carrier_name, enabled')
      .eq('enabled', true);

    if (dbError) {
      throw new Error(`Database connection failed: ${dbError.message}`);
    }

    console.log(`✅ Database connected. Found ${carriers?.length || 0} active carriers:`);
    carriers?.forEach(c => console.log(`   - ${c.carrier_name} (${c.id})`));

    // Step 2: Initialize agent
    console.log('\n2️⃣  Initializing EmailIngestionAgent...');
    const agent = new EmailIngestionAgent();
    console.log('✅ Agent initialized');

    // Step 3: Test connections
    console.log('\n3️⃣  Testing Gmail & Database Connections...');
    const connections = await agent.testConnections();

    if (!connections.gmail) {
      throw new Error('Gmail connection failed. Check your credentials.');
    }
    if (!connections.database) {
      throw new Error('Database connection failed. Check Supabase configuration.');
    }

    console.log('✅ Gmail connected');
    console.log('✅ Database connected');

    // Step 4: Check existing emails
    console.log('\n4️⃣  Checking existing emails in database...');
    const { data: existingEmails, error: countError } = await supabase
      .from('raw_emails')
      .select('processing_status')
      .order('created_at', { ascending: false })
      .limit(10);

    if (!countError) {
      const stats = {
        total: existingEmails?.length || 0,
        pending: existingEmails?.filter(e => e.processing_status === 'pending').length || 0,
        processed: existingEmails?.filter(e => e.processing_status === 'processed').length || 0,
        failed: existingEmails?.filter(e => e.processing_status === 'failed').length || 0
      };

      console.log(`📊 Recent emails: ${stats.total}`);
      console.log(`   - Pending: ${stats.pending}`);
      console.log(`   - Processed: ${stats.processed}`);
      console.log(`   - Failed: ${stats.failed}`);
    }

    // Step 5: Process emails (limited run)
    console.log('\n5️⃣  Processing new emails (test run - max 5 emails)...');

    // Override config for test
    process.env.MAX_EMAILS_PER_RUN = '5';
    const testAgent = new EmailIngestionAgent();

    const stats = await testAgent.processNewEmails();

    console.log('\n✅ Test run completed!');
    console.log('=' . repeat(50));
    console.log('\n📊 Processing Statistics:');
    console.log(`   Total emails found: ${stats.totalEmails}`);
    console.log(`   Processed: ${stats.processedEmails}`);
    console.log(`   Failed: ${stats.failedEmails}`);
    console.log(`   Duplicates: ${stats.duplicateEmails}`);
    console.log(`   Attachments saved: ${stats.attachmentsSaved}`);

    const duration = stats.endTime
      ? (stats.endTime.getTime() - stats.startTime.getTime()) / 1000
      : 0;
    console.log(`   Duration: ${duration.toFixed(2)} seconds`);

    // Step 6: Verify data in database
    if (stats.processedEmails > 0) {
      console.log('\n6️⃣  Verifying data in database...');

      const { data: newEmails } = await supabase
        .from('raw_emails')
        .select('gmail_message_id, subject, sender_email, has_attachments')
        .order('created_at', { ascending: false })
        .limit(stats.processedEmails);

      if (newEmails && newEmails.length > 0) {
        console.log(`\n📧 Sample of processed emails:`);
        newEmails.slice(0, 3).forEach((email, i) => {
          console.log(`\n   ${i + 1}. ${email.subject.substring(0, 50)}...`);
          console.log(`      From: ${email.sender_email}`);
          console.log(`      Attachments: ${email.has_attachments ? 'Yes' : 'No'}`);
        });
      }
    }

    console.log('\n' + '=' . repeat(50));
    console.log('✅ All tests passed successfully!');
    console.log('\n🎉 EmailIngestionAgent is ready for production!');
    console.log('\nNext steps:');
    console.log('1. Review the processed emails in your database');
    console.log('2. Set up a cron job to run the agent periodically');
    console.log('3. Monitor the processing_logs table for agent performance');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
testEmailAgent()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });