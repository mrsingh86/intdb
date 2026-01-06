/**
 * Test Classification on Deep Threaded Emails
 *
 * Tests the ClassificationOrchestrator on emails with:
 * - RE: RE: RE: chains (deep replies)
 * - FW: FW: chains (multiple forwards)
 * - Mixed RE:/FW: chains
 * - Quoted content in body
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { createClassificationOrchestrator } from '../lib/services/classification/index.js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const orchestrator = createClassificationOrchestrator();

async function testDeepThreadedEmails() {
  console.log('='.repeat(80));
  console.log('DEEP THREADED EMAIL CLASSIFICATION TEST');
  console.log('='.repeat(80));

  // Find emails with deep thread prefixes (RE: RE:, FW: FW:, etc.)
  const { data: threadedEmails, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      true_sender_email,
      body_text
    `)
    .or('subject.ilike.%RE: RE:%,subject.ilike.%FW: FW:%,subject.ilike.%Fwd: Fwd:%,subject.ilike.%RE: FW:%')
    .not('subject', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !threadedEmails || threadedEmails.length === 0) {
    console.log('No deep threaded emails found, testing with synthetic examples...');
    await testSyntheticThreads();
    return;
  }

  console.log(`\nFound ${threadedEmails.length} deep threaded emails\n`);

  for (let i = 0; i < threadedEmails.length; i++) {
    const email = threadedEmails[i];
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`Email ${i + 1}/${threadedEmails.length}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Sender: ${email.sender_email}`);
    if (email.true_sender_email) {
      console.log(`True Sender: ${email.true_sender_email}`);
    }

    // Get attachment filenames
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename')
      .eq('email_id', email.id);
    const attachmentFilenames = attachments?.map(a => a.filename).filter(Boolean) || [];
    if (attachmentFilenames.length > 0) {
      console.log(`Attachments: ${attachmentFilenames.join(', ')}`);
    }

    // Run classification
    const result = orchestrator.classify({
      subject: email.subject || '',
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email || null,
      bodyText: email.body_text || '',
      attachmentFilenames,
    });

    console.log(`\n📋 Classification Results:`);
    console.log(`  Thread Context:`);
    console.log(`    - Is Thread: ${result.threadContext.isThread}`);
    console.log(`    - Is Reply: ${result.threadContext.isReply}`);
    console.log(`    - Is Forward: ${result.threadContext.isForward}`);
    console.log(`    - Thread Depth: ${result.threadContext.threadDepth}`);
    console.log(`    - Clean Subject: "${result.threadContext.cleanSubject}"`);
    if (result.threadContext.forwardInfo) {
      console.log(`    - Forward Info: From ${result.threadContext.forwardInfo.originalSender}`);
    }

    console.log(`\n  Document Classification:`);
    console.log(`    - Type: ${result.documentType} (${result.documentConfidence}%)`);
    console.log(`    - Method: ${result.documentMethod}`);
    console.log(`    - Source: ${result.documentSource}`);
    if (result.documentMatchedPattern) {
      console.log(`    - Pattern: ${result.documentMatchedPattern}`);
    }

    console.log(`\n  Email Classification:`);
    console.log(`    - Type: ${result.emailType} (${result.emailTypeConfidence}%)`);
    console.log(`    - Category: ${result.emailCategory}`);
    console.log(`    - Sender: ${result.senderCategory}`);
    if (result.emailMatchedPatterns?.length) {
      console.log(`    - Patterns: ${result.emailMatchedPatterns.join(', ')}`);
    }

    console.log(`\n  Sentiment:`);
    console.log(`    - ${result.sentiment} (score: ${result.sentimentScore})`);
    if (result.sentimentPatterns?.length) {
      console.log(`    - Patterns: ${result.sentimentPatterns.join(', ')}`);
    }

    console.log(`\n  Direction: ${result.direction}`);
    console.log(`  True Sender: ${result.trueSender}`);
    console.log(`  Needs Manual Review: ${result.needsManualReview}`);
    console.log(`  Is Urgent: ${result.isUrgent}`);
  }

  // Summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const stats = {
    totalEmails: threadedEmails.length,
    threadTypes: { reply: 0, forward: 0, mixed: 0 },
    avgThreadDepth: 0,
    documentTypes: new Map<string, number>(),
    emailTypes: new Map<string, number>(),
    senderCategories: new Map<string, number>(),
  };

  for (const email of threadedEmails) {
    const result = orchestrator.classify({
      subject: email.subject || '',
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email || null,
      bodyText: email.body_text || '',
    });

    if (result.threadContext.isReply && result.threadContext.isForward) {
      stats.threadTypes.mixed++;
    } else if (result.threadContext.isReply) {
      stats.threadTypes.reply++;
    } else if (result.threadContext.isForward) {
      stats.threadTypes.forward++;
    }

    stats.avgThreadDepth += result.threadContext.threadDepth;

    const docType = result.documentType;
    stats.documentTypes.set(docType, (stats.documentTypes.get(docType) || 0) + 1);

    const emailType = result.emailType;
    stats.emailTypes.set(emailType, (stats.emailTypes.get(emailType) || 0) + 1);

    const sender = result.senderCategory;
    stats.senderCategories.set(sender, (stats.senderCategories.get(sender) || 0) + 1);
  }

  console.log(`\nThread Types:`);
  console.log(`  - Pure Replies (RE:): ${stats.threadTypes.reply}`);
  console.log(`  - Pure Forwards (FW:): ${stats.threadTypes.forward}`);
  console.log(`  - Mixed (RE: + FW:): ${stats.threadTypes.mixed}`);
  console.log(`  - Avg Thread Depth: ${(stats.avgThreadDepth / stats.totalEmails).toFixed(1)}`);

  console.log(`\nDocument Types:`);
  for (const [type, count] of [...stats.documentTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${type}: ${count}`);
  }

  console.log(`\nEmail Types:`);
  for (const [type, count] of [...stats.emailTypes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${type}: ${count}`);
  }

  console.log(`\nSender Categories:`);
  for (const [type, count] of [...stats.senderCategories.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${type}: ${count}`);
  }
}

async function testSyntheticThreads() {
  console.log('\n--- Testing with Synthetic Thread Examples ---\n');

  const syntheticEmails = [
    {
      subject: 'RE: RE: RE: Booking Confirmation - MAEU123456789',
      senderEmail: 'ops@intoglo.com',
      trueSenderEmail: 'in.export@maersk.com',
      bodyText: `Thanks for confirming.

> On Dec 15, 2024, ops@intoglo.com wrote:
> > On Dec 14, 2024, in.export@maersk.com wrote:
> > > Booking confirmed for MAEU123456789
> > > Vessel: MAERSK SELETAR
> > > ETD: 2024-12-20`,
    },
    {
      subject: 'FW: FW: SI Draft Approval Required - BKG987654321',
      senderEmail: 'operations@forwarder.com',
      trueSenderEmail: null,
      bodyText: `Please review and approve the attached SI draft.

---------- Forwarded message ---------
From: booking@hapag-lloyd.com
Subject: SI Draft Approval Required

Dear Shipper,
Please review the SI draft attached.
Deadline: Dec 18, 2024`,
    },
    {
      subject: 'RE: FW: URGENT - Bill of Lading Amendment Request',
      senderEmail: 'docs@shipper.com',
      trueSenderEmail: null,
      bodyText: `We need to change the consignee name urgently!

> Forwarded from: bl@carrier.com
> Please note the BL has been issued.
> BL Number: HLCU123456789`,
    },
  ];

  for (let i = 0; i < syntheticEmails.length; i++) {
    const email = syntheticEmails[i];
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Synthetic Email ${i + 1}`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Sender: ${email.senderEmail}`);

    const result = orchestrator.classify({
      subject: email.subject,
      senderEmail: email.senderEmail,
      trueSenderEmail: email.trueSenderEmail,
      bodyText: email.bodyText,
    });

    console.log(`\n📋 Results:`);
    console.log(`  Thread: depth=${result.threadContext.threadDepth}, reply=${result.threadContext.isReply}, forward=${result.threadContext.isForward}`);
    console.log(`  Clean Subject: "${result.threadContext.cleanSubject}"`);
    console.log(`  Document: ${result.documentType} (${result.documentConfidence}%)`);
    console.log(`  Email Type: ${result.emailType} (${result.emailTypeConfidence}%)`);
    console.log(`  Sender: ${result.senderCategory}`);
    console.log(`  Sentiment: ${result.sentiment}`);
    console.log(`  Direction: ${result.direction}`);
    console.log(`  Urgent: ${result.isUrgent}`);
  }
}

testDeepThreadedEmails().catch(console.error);
