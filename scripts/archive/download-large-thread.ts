/**
 * Download Large Email Thread (10+ emails)
 * Searches Gmail for threads with many messages, downloads them, and analyzes extraction
 */

import { google } from 'googleapis';
import { supabase } from '../utils/supabase-client';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Gmail client
const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

async function downloadLargeThread() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                      DOWNLOAD & ANALYZE LARGE THREAD (10+ emails)                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Search for threads with many messages
  console.log('🔍 STEP 1: Searching Gmail for threads with many messages...\n');

  try {
    // Search for threads (Gmail returns threads by default)
    const response = await gmail.users.threads.list({
      userId: 'me',
      maxResults: 50,
      q: 'has:attachment OR subject:booking OR subject:HL- OR subject:MAEU'  // Likely to have threads
    });

    const threads = response.data.threads || [];
    console.log(`   Found ${threads.length} threads\n`);

    if (threads.length === 0) {
      console.log('⚠️  No threads found. Try different search query.\n');
      return;
    }

    // Step 2: Get detailed info for each thread to find one with 10+ messages
    console.log('🔍 STEP 2: Finding thread with 10+ messages...\n');

    let largeThread = null;
    const threadSizes: Array<{ id: string; messageCount: number; snippet: string }> = [];

    for (const thread of threads.slice(0, 20)) {  // Check first 20 threads
      const threadDetails = await gmail.users.threads.get({
        userId: 'me',
        id: thread.id!,
        format: 'metadata',
        metadataHeaders: ['Subject']
      });

      const messageCount = threadDetails.data.messages?.length || 0;
      const snippet = threadDetails.data.messages?.[0]?.snippet || '';

      threadSizes.push({ id: thread.id!, messageCount, snippet });

      if (messageCount >= 10 && !largeThread) {
        largeThread = threadDetails;
        console.log(`   ✅ Found thread with ${messageCount} messages!`);
        console.log(`      Thread ID: ${thread.id}`);
        console.log(`      Snippet: ${snippet.substring(0, 60)}...\n`);
      }
    }

    // Show all thread sizes
    console.log('📊 Thread sizes:\n');
    threadSizes
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 10)
      .forEach((t, idx) => {
        console.log(`   ${idx + 1}. ${t.messageCount} messages - ${t.snippet.substring(0, 50)}...`);
      });
    console.log('');

    if (!largeThread) {
      console.log('⚠️  No thread with 10+ messages found. Using largest available...\n');
      const largest = threadSizes.sort((a, b) => b.messageCount - a.messageCount)[0];

      largeThread = await gmail.users.threads.get({
        userId: 'me',
        id: largest.id,
        format: 'full'
      });

      console.log(`   Using thread with ${largest.messageCount} messages\n`);
    }

    // Step 3: Download and save all messages
    console.log('═'.repeat(100));
    console.log('STEP 3: Downloading thread messages');
    console.log('═'.repeat(100) + '\n');

    const messages = largeThread.data.messages || [];
    const threadId = largeThread.data.id!;

    console.log(`   Thread ID: ${threadId}`);
    console.log(`   Message count: ${messages.length}\n`);

    let saved = 0;
    let skipped = 0;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const messageId = message.id!;

      console.log(`   [${i + 1}/${messages.length}] Processing message ${messageId.substring(0, 16)}...`);

      // Check if already exists
      const { data: existing } = await supabase
        .from('raw_emails')
        .select('id')
        .eq('gmail_message_id', messageId)
        .single();

      if (existing) {
        console.log(`      ⏭️  Already exists, skipping`);
        skipped++;
        continue;
      }

      // Parse email data
      const headers = message.payload?.headers || [];
      const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

      const subject = getHeader('Subject');
      const from = getHeader('From');
      const to = getHeader('To');
      const date = getHeader('Date');

      // Get body
      let bodyText = '';
      if (message.payload?.body?.data) {
        bodyText = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
      } else if (message.payload?.parts) {
        const textPart = message.payload.parts.find((p: any) => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          bodyText = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      }

      // Check for attachments
      const hasAttachments = (message.payload?.parts || []).some((p: any) => p.filename && p.filename.length > 0);

      // Generate content hash
      const contentHash = crypto
        .createHash('sha256')
        .update((bodyText || message.snippet || '').replace(/\s+/g, ' ').trim().toLowerCase())
        .digest('hex');

      // Save to database
      const { error } = await supabase.from('raw_emails').insert({
        gmail_message_id: messageId,
        thread_id: threadId,
        subject: subject || 'No Subject',
        sender_email: from,
        recipient_emails: to ? [to] : [],
        body_text: bodyText,
        snippet: message.snippet,
        received_at: date || new Date().toISOString(),
        has_attachments: hasAttachments,
        thread_position: i + 1,
        content_hash: contentHash,
        labels: message.labelIds || []
      });

      if (error) {
        console.log(`      ❌ Error: ${error.message}`);
      } else {
        console.log(`      ✅ Saved`);
        saved++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`\n   Summary: ${saved} saved, ${skipped} skipped\n`);

    // Step 4: Run duplicate detection
    console.log('═'.repeat(100));
    console.log('STEP 4: Running duplicate detection & revision extraction');
    console.log('═'.repeat(100) + '\n');

    await runDuplicateDetection(threadId);

    // Step 5: Classify with thread context
    console.log('\n═'.repeat(100));
    console.log('STEP 5: Classifying emails with thread context');
    console.log('═'.repeat(100) + '\n');

    await classifyThread(threadId);

    // Step 6: Check extractions
    console.log('\n═'.repeat(100));
    console.log('STEP 6: Analyzing document data extraction');
    console.log('═'.repeat(100) + '\n');

    await analyzeExtractions(threadId);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

async function runDuplicateDetection(threadId: string) {
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, content_hash, received_at')
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });

  if (!emails) return;

  const seen: Record<string, string> = {};
  let duplicates = 0;

  for (const email of emails) {
    if (seen[email.content_hash]) {
      await supabase
        .from('raw_emails')
        .update({
          is_duplicate: true,
          duplicate_of_email_id: seen[email.content_hash]
        })
        .eq('id', email.id);
      duplicates++;
    } else {
      seen[email.content_hash] = email.id;
    }
  }

  console.log(`   ✅ Detected ${duplicates} duplicates\n`);
}

async function classifyThread(threadId: string) {
  const { data: emails } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      body_text,
      snippet,
      is_duplicate,
      document_classifications (id)
    `)
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });

  if (!emails) return;

  const unclassified = emails.filter(e =>
    (!e.document_classifications || e.document_classifications.length === 0) &&
    !e.is_duplicate
  );

  console.log(`   Total emails: ${emails.length}`);
  console.log(`   Unclassified: ${unclassified.length}`);
  console.log(`   Duplicates (will skip): ${emails.filter(e => e.is_duplicate).length}\n`);

  if (unclassified.length === 0) {
    console.log('   ✅ All unique emails already classified\n');
    return;
  }

  console.log('   ℹ️  Run classify-with-thread-context.ts to classify these emails\n');
}

async function analyzeExtractions(threadId: string) {
  // Get all emails in thread with their extractions
  const { data: emails } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      document_classifications (
        id,
        document_type,
        confidence_score
      ),
      entity_extractions (
        id,
        entity_type,
        entity_value,
        confidence_score
      )
    `)
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });

  if (!emails) return;

  console.log(`📧 Thread contains ${emails.length} emails\n`);

  let totalClassifications = 0;
  let totalExtractions = 0;

  emails.forEach((email: any, idx: number) => {
    const classifications = email.document_classifications || [];
    const extractions = email.entity_extractions || [];

    totalClassifications += classifications.length;
    totalExtractions += extractions.length;

    console.log(`┌─ EMAIL ${idx + 1} ───────────────────────────────────────────────────────────────`);
    console.log(`│  Subject: ${email.subject?.substring(0, 50)}`);
    console.log(`│  From: ${email.sender_email}`);
    console.log(`│`);
    console.log(`│  📊 Classifications: ${classifications.length}`);
    classifications.forEach((c: any) => {
      console.log(`│     • ${c.document_type} (${c.confidence_score}% confidence)`);
    });
    console.log(`│`);
    console.log(`│  📋 Extracted Entities: ${extractions.length}`);
    if (extractions.length > 0) {
      extractions.forEach((e: any) => {
        console.log(`│     • ${e.entity_type}: "${e.entity_value}" (${e.confidence_score}%)`);
      });
    } else {
      console.log(`│     ⚠️  No entities extracted`);
    }
    console.log(`└${'─'.repeat(75)}\n`);
  });

  // Summary
  console.log('═'.repeat(100));
  console.log('EXTRACTION SUMMARY');
  console.log('═'.repeat(100));
  console.log(`Total emails:          ${emails.length}`);
  console.log(`Total classifications: ${totalClassifications}`);
  console.log(`Total extractions:     ${totalExtractions}`);
  console.log(`Avg extractions/email: ${(totalExtractions / emails.length).toFixed(1)}`);
  console.log('');

  if (totalExtractions === 0) {
    console.log('⚠️  WARNING: No entities extracted from any email!');
    console.log('   Possible reasons:');
    console.log('   1. Entity extraction not running (check classify-with-thread-context.ts)');
    console.log('   2. AI not finding extractable entities');
    console.log('   3. Confidence threshold too high (currently 50%)');
    console.log('');
  } else {
    console.log('✅ Document data extraction is WORKING');
    console.log(`   Extracted ${totalExtractions} entities across ${emails.length} emails`);
    console.log('');
  }

  // Show entity type breakdown
  const entityTypes: Record<string, number> = {};
  emails.forEach((email: any) => {
    (email.entity_extractions || []).forEach((e: any) => {
      entityTypes[e.entity_type] = (entityTypes[e.entity_type] || 0) + 1;
    });
  });

  if (Object.keys(entityTypes).length > 0) {
    console.log('📊 Entity Types Extracted:');
    Object.entries(entityTypes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   • ${type}: ${count}`);
      });
    console.log('');
  }
}

downloadLargeThread().catch(console.error);
