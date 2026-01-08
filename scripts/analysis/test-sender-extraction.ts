/**
 * Test Sender-Aware Extraction on Sample Emails
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  createSenderAwareExtractor,
  createSenderCategoryDetector,
} from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function getSampleEmails(limit = 20) {
  const { data, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      gmail_message_id,
      sender_email,
      true_sender_email,
      subject,
      body_text,
      has_attachments
    `)
    .not('body_text', 'is', null)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching emails:', error);
    return [];
  }

  return data || [];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SENDER-AWARE EXTRACTION TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const detector = createSenderCategoryDetector();
  const extractor = createSenderAwareExtractor(supabase);

  console.log('Fetching sample emails...\n');
  const emails = await getSampleEmails(20);
  console.log(`Found ${emails.length} emails to process\n`);

  // Group by sender category first
  const bySender: Record<string, typeof emails> = {};
  for (const email of emails) {
    const sender = email.true_sender_email || email.sender_email || '';
    const category = detector.detect(sender);
    if (!bySender[category]) bySender[category] = [];
    bySender[category].push(email);
  }

  console.log('Emails by Sender Category:');
  for (const [category, categoryEmails] of Object.entries(bySender)) {
    console.log(`  ${category}: ${categoryEmails.length}`);
  }
  console.log('');

  // Process each email
  let totalExtractions = 0;
  let successCount = 0;
  const extractionsByType: Record<string, number> = {};
  const sampleResults: Array<{
    category: string;
    subject: string;
    extractions: Array<{ type: string; value: string; confidence: number }>;
  }> = [];

  for (const email of emails) {
    try {
      const result = await extractor.extract({
        emailId: email.id,
        senderEmail: email.sender_email || '',
        trueSenderEmail: email.true_sender_email,
        subject: email.subject || '',
        bodyText: email.body_text || '',
        sourceType: 'email',
      });

      successCount++;
      totalExtractions += result.extractions.length;

      // Count by type
      for (const ext of result.extractions) {
        extractionsByType[ext.entityType] = (extractionsByType[ext.entityType] || 0) + 1;
      }

      // Store sample for display
      if (result.extractions.length > 0 && sampleResults.length < 10) {
        sampleResults.push({
          category: result.senderCategory,
          subject: (email.subject || '').slice(0, 60),
          extractions: result.extractions.slice(0, 8).map((e) => ({
            type: e.entityType,
            value: e.entityValue.slice(0, 30),
            confidence: e.confidence,
          })),
        });
      }
    } catch (error) {
      console.error(`Error processing email ${email.id}:`, error);
    }
  }

  // Print summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  EXTRACTION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Emails Processed: ${successCount}/${emails.length}`);
  console.log(`Total Extractions: ${totalExtractions}`);
  console.log(`Avg per Email: ${(totalExtractions / successCount).toFixed(1)}\n`);

  console.log('Extractions by Entity Type:');
  const sortedTypes = Object.entries(extractionsByType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  for (const [type, count] of sortedTypes) {
    const bar = '█'.repeat(Math.min(count, 30));
    console.log(`  ${type.padEnd(25)} ${count.toString().padStart(4)} ${bar}`);
  }

  // Print sample results
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SAMPLE EXTRACTION RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const sample of sampleResults) {
    console.log(`┌─ [${sample.category.toUpperCase()}] ${sample.subject}...`);
    for (const ext of sample.extractions) {
      const confColor = ext.confidence >= 90 ? '✓' : ext.confidence >= 75 ? '○' : '?';
      console.log(`│  ${confColor} ${ext.type.padEnd(22)} ${ext.value.padEnd(30)} (${ext.confidence}%)`);
    }
    console.log('└─\n');
  }

  // Test specific sender categories
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CATEGORY-SPECIFIC TESTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Find one email per category for detailed test
  const categoriesToTest = ['maersk', 'hapag', 'customs_broker', 'freight_forwarder'];

  for (const targetCategory of categoriesToTest) {
    const categoryEmails = bySender[targetCategory] || [];
    if (categoryEmails.length === 0) {
      console.log(`[${targetCategory.toUpperCase()}] No emails found\n`);
      continue;
    }

    const email = categoryEmails[0];
    const result = await extractor.extract({
      emailId: email.id,
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email,
      subject: email.subject || '',
      bodyText: email.body_text || '',
      sourceType: 'email',
    });

    console.log(`[${targetCategory.toUpperCase()}]`);
    console.log(`  Subject: ${(email.subject || '').slice(0, 70)}...`);
    console.log(`  Sender: ${email.true_sender_email || email.sender_email}`);
    console.log(`  Extractions: ${result.extractions.length}`);
    console.log(`  Required Found: ${result.metadata.requiredFound}`);
    console.log(`  Required Missing: ${result.metadata.requiredMissing.join(', ') || 'None'}`);
    console.log(`  Avg Confidence: ${result.metadata.avgConfidence}%`);
    console.log(`  Processing Time: ${result.metadata.processingTimeMs}ms`);

    if (result.extractions.length > 0) {
      console.log('  Top Extractions:');
      for (const ext of result.extractions.slice(0, 5)) {
        console.log(`    - ${ext.entityType}: ${ext.entityValue.slice(0, 40)} (${ext.confidence}%)`);
      }
    }
    console.log('');
  }
}

main().catch(console.error);
