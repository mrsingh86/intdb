/**
 * Test Classification Script
 *
 * Tests the new parallel classification system on real emails.
 * Reports coverage of sender categories and email types.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { createClassificationOrchestrator } from '../lib/services/classification/index.js';
import { getSenderCategory, detectSentiment, SENDER_CATEGORY_PATTERNS } from '../lib/config/email-type-config.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const orchestrator = createClassificationOrchestrator();

interface TestResult {
  emailId: string;
  subject: string;
  senderEmail: string;
  trueSender: string | null;
  senderCategory: string;
  documentType: string;
  documentConfidence: number;
  emailType: string;
  emailTypeConfidence: number;
  direction: string;
  sentiment: string;
  sentimentScore: number;
}

async function testClassification() {
  console.log('='.repeat(80));
  console.log('PARALLEL CLASSIFICATION TEST');
  console.log('='.repeat(80));

  // Get sample emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      true_sender_email,
      body_text,
      has_attachments
    `)
    .not('subject', 'is', null)
    .not('sender_email', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error || !emails) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log(`\nTesting ${emails.length} emails...\n`);

  // Track statistics
  const senderCategoryStats: Record<string, number> = {};
  const emailTypeStats: Record<string, number> = {};
  const documentTypeStats: Record<string, number> = {};
  const sentimentStats: Record<string, number> = {};
  const results: TestResult[] = [];

  // Get attachment filenames for each email
  for (const email of emails) {
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', email.id);

    const attachmentFilenames = attachments?.map(a => a.filename).filter(Boolean) || [];
    const pdfContent = attachments
      ?.filter(a => a.extracted_text && a.extracted_text.length > 50)
      .map(a => a.extracted_text)
      .join('\n\n') || undefined;

    // Run classification
    const result = orchestrator.classify({
      subject: email.subject || '',
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email || null,
      bodyText: email.body_text || '',
      attachmentFilenames,
      pdfContent,
    });

    // Detect sentiment
    const sentimentResult = detectSentiment(email.subject || '', email.body_text || '');

    // Track stats
    senderCategoryStats[result.senderCategory] = (senderCategoryStats[result.senderCategory] || 0) + 1;
    emailTypeStats[result.emailType] = (emailTypeStats[result.emailType] || 0) + 1;
    documentTypeStats[result.documentType] = (documentTypeStats[result.documentType] || 0) + 1;
    sentimentStats[sentimentResult.sentiment] = (sentimentStats[sentimentResult.sentiment] || 0) + 1;

    results.push({
      emailId: email.id.substring(0, 8),
      subject: email.subject?.substring(0, 60) || '',
      senderEmail: email.sender_email || '',
      trueSender: email.true_sender_email,
      senderCategory: result.senderCategory,
      documentType: result.documentType,
      documentConfidence: result.documentConfidence,
      emailType: result.emailType,
      emailTypeConfidence: result.emailTypeConfidence,
      direction: result.direction,
      sentiment: sentimentResult.sentiment,
      sentimentScore: sentimentResult.score,
    });
  }

  // Print sender category stats
  console.log('\n' + '='.repeat(80));
  console.log('SENDER CATEGORY DISTRIBUTION');
  console.log('='.repeat(80));
  const sortedSenderStats = Object.entries(senderCategoryStats)
    .sort((a, b) => b[1] - a[1]);
  for (const [category, count] of sortedSenderStats) {
    const pct = ((count / emails.length) * 100).toFixed(1);
    console.log(`  ${category.padEnd(20)} ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Print email type stats
  console.log('\n' + '='.repeat(80));
  console.log('EMAIL TYPE DISTRIBUTION');
  console.log('='.repeat(80));
  const sortedEmailTypeStats = Object.entries(emailTypeStats)
    .sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedEmailTypeStats) {
    const pct = ((count / emails.length) * 100).toFixed(1);
    console.log(`  ${type.padEnd(25)} ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Print document type stats
  console.log('\n' + '='.repeat(80));
  console.log('DOCUMENT TYPE DISTRIBUTION');
  console.log('='.repeat(80));
  const sortedDocTypeStats = Object.entries(documentTypeStats)
    .sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedDocTypeStats) {
    const pct = ((count / emails.length) * 100).toFixed(1);
    console.log(`  ${type.padEnd(25)} ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Print sentiment stats
  console.log('\n' + '='.repeat(80));
  console.log('SENTIMENT DISTRIBUTION');
  console.log('='.repeat(80));
  const sortedSentimentStats = Object.entries(sentimentStats)
    .sort((a, b) => b[1] - a[1]);
  for (const [sentiment, count] of sortedSentimentStats) {
    const pct = ((count / emails.length) * 100).toFixed(1);
    console.log(`  ${sentiment.padEnd(15)} ${count.toString().padStart(4)} (${pct}%)`);
  }

  // Print sample results grouped by email type
  console.log('\n' + '='.repeat(80));
  console.log('SAMPLE CLASSIFICATIONS BY EMAIL TYPE');
  console.log('='.repeat(80));

  const groupedByEmailType = results.reduce((acc, r) => {
    if (!acc[r.emailType]) acc[r.emailType] = [];
    acc[r.emailType].push(r);
    return acc;
  }, {} as Record<string, TestResult[]>);

  for (const [emailType, typeResults] of Object.entries(groupedByEmailType).sort()) {
    console.log(`\n--- ${emailType.toUpperCase()} (${typeResults.length}) ---`);
    // Show up to 3 samples per type
    for (const r of typeResults.slice(0, 3)) {
      console.log(`  Subject: ${r.subject}`);
      console.log(`  Sender: ${r.senderEmail} (${r.senderCategory})`);
      console.log(`  Document: ${r.documentType} (${r.documentConfidence}%)`);
      console.log(`  Email Type: ${r.emailType} (${r.emailTypeConfidence}%)`);
      console.log('');
    }
  }

  // Check for unknown senders
  console.log('\n' + '='.repeat(80));
  console.log('UNKNOWN SENDER EMAILS (Need Pattern Updates)');
  console.log('='.repeat(80));
  const unknownSenders = results.filter(r => r.senderCategory === 'unknown');
  const uniqueUnknownDomains = [...new Set(unknownSenders.map(r => {
    const email = r.trueSender || r.senderEmail;
    return email.split('@')[1];
  }))];

  console.log(`\nUnique domains not matched: ${uniqueUnknownDomains.length}`);
  for (const domain of uniqueUnknownDomains.slice(0, 20)) {
    const count = unknownSenders.filter(r =>
      (r.trueSender || r.senderEmail).includes(domain)
    ).length;
    console.log(`  ${domain} (${count} emails)`);
  }

  // Print urgent/escalated emails (high priority)
  console.log('\n' + '='.repeat(80));
  console.log('URGENT / ESCALATED EMAILS (High Priority)');
  console.log('='.repeat(80));
  const urgentEmails = results.filter(r => r.sentiment === 'urgent' || r.sentiment === 'escalated' || r.sentiment === 'negative');
  if (urgentEmails.length === 0) {
    console.log('  No urgent/escalated emails found');
  } else {
    for (const r of urgentEmails.slice(0, 10)) {
      console.log(`  [${r.sentiment.toUpperCase()}] ${r.subject}`);
      console.log(`    Sender: ${r.senderEmail} | Score: ${r.sentimentScore}`);
      console.log('');
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total emails tested: ${emails.length}`);
  console.log(`Sender categories found: ${Object.keys(senderCategoryStats).length}`);
  console.log(`Email types found: ${Object.keys(emailTypeStats).length}`);
  console.log(`Document types found: ${Object.keys(documentTypeStats).length}`);
  console.log(`Unknown senders: ${unknownSenders.length} (${((unknownSenders.length / emails.length) * 100).toFixed(1)}%)`);

  const classifiedEmailTypes = results.filter(r => r.emailType !== 'unknown' && r.emailType !== 'general_correspondence');
  console.log(`Classified email types: ${classifiedEmailTypes.length} (${((classifiedEmailTypes.length / emails.length) * 100).toFixed(1)}%)`);

  const urgentCount = results.filter(r => r.sentiment === 'urgent').length;
  const escalatedCount = results.filter(r => r.sentiment === 'escalated').length;
  const negativeCount = results.filter(r => r.sentiment === 'negative').length;
  console.log(`Urgent emails: ${urgentCount} | Escalated: ${escalatedCount} | Negative: ${negativeCount}`);
}

testClassification().catch(console.error);
