/**
 * Analyze Large Email Thread (10+ emails)
 * Shows storage structure and AI classification behavior
 */

import { supabase } from '../utils/supabase-client';

async function analyzeLargeThread() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                      LARGE THREAD ANALYSIS (10+ emails)                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Find thread with most emails
  const { data: threadMetadata } = await supabase
    .from('email_thread_metadata')
    .select('*')
    .order('email_count', { ascending: false })
    .limit(10);

  if (!threadMetadata || threadMetadata.length === 0) {
    console.log('No threads found. Let me search raw emails...\n');

    // Fallback: group by thread_id manually
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('thread_id, subject')
      .not('thread_id', 'is', null);

    if (!emails) {
      console.log('No emails found\n');
      return;
    }

    const threadCounts: Record<string, { count: number, subject: string }> = {};
    emails.forEach(e => {
      if (!threadCounts[e.thread_id]) {
        threadCounts[e.thread_id] = { count: 0, subject: e.subject || '' };
      }
      threadCounts[e.thread_id].count++;
    });

    const largestThreads = Object.entries(threadCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    console.log('📊 Largest Threads Found:\n');
    largestThreads.forEach(([threadId, data], idx) => {
      console.log(`${idx + 1}. Thread ${threadId.substring(0, 12)}... (${data.count} emails)`);
      console.log(`   Subject: ${data.subject?.substring(0, 60)}`);
    });

    // Use the largest thread
    const [largestThreadId] = largestThreads[0];
    await analyzeThread(largestThreadId);
  } else {
    console.log('📊 Thread Metadata Summary:\n');
    console.table(threadMetadata.map(t => ({
      Thread_ID: t.thread_id.substring(0, 12) + '...',
      Emails: t.email_count,
      Unique: t.unique_email_count,
      Duplicates: t.duplicate_count,
      Subject: t.thread_subject?.substring(0, 40) || 'N/A'
    })));

    // Find thread with 10+ emails
    const largeThread = threadMetadata.find(t => t.email_count >= 10);

    if (largeThread) {
      console.log(`\n✅ Found thread with ${largeThread.email_count} emails!\n`);
      await analyzeThread(largeThread.thread_id);
    } else {
      console.log('\n⚠️  No threads with 10+ emails found. Analyzing largest thread instead...\n');
      await analyzeThread(threadMetadata[0].thread_id);
    }
  }
}

async function analyzeThread(threadId: string) {
  console.log('═'.repeat(100));
  console.log(`DETAILED THREAD ANALYSIS: ${threadId}`);
  console.log('═'.repeat(100) + '\n');

  console.log(`🔍 Querying emails with thread_id: "${threadId}"\n`);

  // Fetch all emails in thread with classifications
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      gmail_message_id,
      thread_id,
      subject,
      sender_email,
      received_at,
      revision_type,
      is_duplicate,
      duplicate_of_email_id,
      thread_position,
      content_hash,
      document_classifications (
        id,
        document_type,
        confidence_score,
        classification_reason,
        classified_at,
        created_at
      )
    `)
    .eq('thread_id', threadId)
    .order('received_at', { ascending: true });

  if (error) {
    console.error('❌ Error querying emails:', error);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('⚠️  No emails found in thread\n');

    // Debug: Let's check if the thread_id exists at all
    const { data: allThreadIds } = await supabase
      .from('raw_emails')
      .select('thread_id')
      .limit(5);

    console.log('Sample thread_ids in database:', allThreadIds?.map(e => e.thread_id));
    return;
  }

  console.log(`📧 THREAD CONTAINS ${emails.length} EMAILS\n`);

  // Show storage structure
  console.log('📊 DATABASE STORAGE STRUCTURE:\n');
  console.log('─'.repeat(100));
  console.log('TABLE: raw_emails');
  console.log('─'.repeat(100));
  console.log('Each row = 1 email message\n');

  emails.forEach((email, idx) => {
    console.log(`\n┌─ EMAIL ${idx + 1} of ${emails.length} (Position ${email.thread_position || idx + 1} in thread) ──────────────────────────────────────`);
    console.log('│');
    console.log('│ 🗄️  RAW_EMAILS TABLE STORAGE:');
    console.log(`│    id:                    ${email.id}`);
    console.log(`│    gmail_message_id:      ${email.gmail_message_id}`);
    console.log(`│    thread_id:             ${email.thread_id} ← LINKS ALL EMAILS`);
    console.log(`│    subject:               ${email.subject?.substring(0, 50)}`);
    console.log(`│    sender_email:          ${email.sender_email}`);
    console.log(`│    received_at:           ${new Date(email.received_at).toLocaleString()}`);
    console.log(`│    revision_type:         ${email.revision_type || 'NULL'}`);
    console.log(`│    is_duplicate:          ${email.is_duplicate ? 'TRUE' : 'FALSE'}`);
    console.log(`│    duplicate_of_email_id: ${email.duplicate_of_email_id || 'NULL'}`);
    console.log(`│    thread_position:       ${email.thread_position || 'NULL'}`);
    console.log(`│    content_hash:          ${email.content_hash?.substring(0, 16)}... (SHA256)`);
    console.log('│');

    // Check for classification
    if (email.document_classifications && email.document_classifications.length > 0) {
      const classifications = email.document_classifications;

      console.log('│ 🏷️  DOCUMENT_CLASSIFICATIONS TABLE:');
      console.log(`│    Count:                 ${classifications.length} classification(s)`);
      console.log('│');

      classifications.forEach((c: any, cIdx: number) => {
        console.log(`│    ┌─ CLASSIFICATION ${cIdx + 1} ${classifications.length > 1 ? '(MULTIPLE FOUND!)' : ''} ──────────────────────────────`);
        console.log(`│    │  id:                 ${c.id}`);
        console.log(`│    │  document_type:      ${c.document_type}`);
        console.log(`│    │  confidence_score:   ${c.confidence_score}%`);
        console.log(`│    │  classified_at:      ${new Date(c.classified_at).toLocaleString()}`);
        console.log(`│    │  created_at:         ${new Date(c.created_at).toLocaleString()}`);

        console.log(`│    │  reasoning:          "${c.classification_reason?.substring(0, 50)}..."`);
        console.log('│    └──────────────────────────────────────────────────────────────────────');
      });

      // Analysis: Is this immutable or mutable?
      if (classifications.length > 1) {
        console.log('│');
        console.log('│ ⚠️  ALERT: MULTIPLE CLASSIFICATIONS DETECTED!');
        console.log('│    This email has been classified MORE THAN ONCE.');
        console.log('│    Storage behavior: NEW ROW INSERTED (not updated)');
        console.log('│    Result: Classification history is PRESERVED');
      } else {
        console.log('│');
        console.log('│ ✅  Classification is ORIGINAL (never reclassified)');
      }
    } else {
      console.log('│ 🏷️  DOCUMENT_CLASSIFICATIONS TABLE:');
      console.log('│    Count:                 0 (NOT YET CLASSIFIED)');
    }

    console.log('│');
    console.log('└──────────────────────────────────────────────────────────────────────────────────────────────');
  });

  // Thread-level summary
  console.log('\n\n' + '═'.repeat(100));
  console.log('THREAD-LEVEL ANALYSIS');
  console.log('═'.repeat(100) + '\n');

  const duplicates = emails.filter(e => e.is_duplicate).length;
  const withRevisionType = emails.filter(e => e.revision_type).length;
  const classified = emails.filter(e => e.document_classifications && e.document_classifications.length > 0).length;
  const multipleClassifications = emails.filter(e =>
    e.document_classifications && e.document_classifications.length > 1
  ).length;

  console.log(`📊 Storage Statistics:`);
  console.log(`   Total Emails:              ${emails.length}`);
  console.log(`   Unique Emails:             ${emails.length - duplicates}`);
  console.log(`   Duplicates:                ${duplicates}`);
  console.log(`   With Revision Type:        ${withRevisionType}`);
  console.log(`   Classified:                ${classified}`);
  console.log(`   Multiple Classifications:  ${multipleClassifications}`);
  console.log('');

  // Answer the immutability question
  console.log('❓ CLASSIFICATION IMMUTABILITY ANALYSIS:\n');
  console.log('─'.repeat(100));

  if (multipleClassifications > 0) {
    console.log('✅ ANSWER: Classifications are PRESERVED (immutable by insertion)');
    console.log('   Behavior: Each time AI classifies, a NEW row is inserted');
    console.log('   Result: Full classification history is kept');
    console.log(`   Evidence: ${multipleClassifications} email(s) have multiple classification records`);
  } else {
    console.log('⚠️  ANSWER: Cannot determine without reclassification test');
    console.log('   Current state: Each email has 0-1 classifications');
    console.log('   Need to reclassify an email to see if it:');
    console.log('     a) INSERTs new row (preserves history) ← IMMUTABLE');
    console.log('     b) UPDATEs existing row (overwrites) ← MUTABLE');
  }

  console.log('');
}

analyzeLargeThread().catch(console.error);
