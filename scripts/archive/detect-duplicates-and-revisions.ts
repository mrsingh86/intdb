/**
 * Duplicate Detection & Revision Type Extraction
 * Processes threads to:
 * 1. Generate content hashes
 * 2. Detect duplicate emails
 * 3. Extract revision types from subjects
 * 4. Update thread metadata
 */

import { supabase } from '../utils/supabase-client';
import crypto from 'crypto';

async function detectDuplicatesAndRevisions() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    DUPLICATE DETECTION & REVISION TYPE EXTRACTION                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Fetch all emails
  console.log('📥 Fetching emails from database...\n');

  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, thread_id, subject, body_text, snippet, received_at')
    .not('thread_id', 'is', null)
    .order('received_at', { ascending: true });

  if (error || !emails) {
    console.error('❌ Error fetching emails:', error);
    return;
  }

  console.log(`✅ Fetched ${emails.length} emails\n`);

  // Step 2: Group by thread
  console.log('📊 Grouping emails by thread...\n');

  const threads: Record<string, typeof emails> = {};
  emails.forEach(email => {
    if (!threads[email.thread_id]) {
      threads[email.thread_id] = [];
    }
    threads[email.thread_id].push(email);
  });

  console.log(`✅ Found ${Object.keys(threads).length} threads\n`);

  // Step 3: Process each thread
  console.log('⚙️  Processing threads...\n');
  console.log('─'.repeat(100) + '\n');

  let totalDuplicates = 0;
  let totalThreadsProcessed = 0;
  let totalRevisionsDetected = 0;

  for (const [threadId, threadEmails] of Object.entries(threads)) {
    console.log(`\n📧 Thread: ${threadId} (${threadEmails.length} emails)`);
    console.log(`   Subject: ${threadEmails[0].subject?.substring(0, 60)}...`);

    // Step 3a: Generate content hashes
    const emailsWithHashes = threadEmails.map((email, index) => ({
      ...email,
      content_hash: generateHash(email.body_text || email.snippet || ''),
      thread_position: index + 1
    }));

    // Step 3b: Find duplicates
    const duplicates = findDuplicates(emailsWithHashes);

    if (duplicates.length > 0) {
      console.log(`   🔍 Found ${duplicates.length} duplicate emails`);
      totalDuplicates += duplicates.length;

      // Mark duplicates
      for (const dup of duplicates) {
        await supabase
          .from('raw_emails')
          .update({
            is_duplicate: true,
            duplicate_of_email_id: dup.originalId,
            content_hash: dup.hash,
            thread_position: dup.position
          })
          .eq('id', dup.duplicateId);
      }
    }

    // Step 3c: Extract revision types
    let revisionsInThread = 0;

    for (const email of emailsWithHashes) {
      const revisionType = extractRevisionType(email.subject || '');

      if (revisionType) {
        revisionsInThread++;

        await supabase
          .from('raw_emails')
          .update({
            revision_type: revisionType,
            content_hash: email.content_hash,
            thread_position: email.thread_position
          })
          .eq('id', email.id);
      }
    }

    if (revisionsInThread > 0) {
      console.log(`   📋 Detected ${revisionsInThread} revision types`);
      totalRevisionsDetected += revisionsInThread;
    }

    // Step 3d: Create/update thread metadata
    const uniqueCount = threadEmails.length - duplicates.length;

    await supabase
      .from('email_thread_metadata')
      .upsert({
        thread_id: threadId,
        thread_subject: threadEmails[0].subject,
        email_count: threadEmails.length,
        unique_email_count: uniqueCount,
        duplicate_count: duplicates.length,
        first_email_id: threadEmails[0].id,
        latest_email_id: threadEmails[threadEmails.length - 1].id,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'thread_id'
      });

    totalThreadsProcessed++;
  }

  console.log('\n\n' + '═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log(`Threads Processed:       ${totalThreadsProcessed}`);
  console.log(`Duplicates Detected:     ${totalDuplicates}`);
  console.log(`Revisions Detected:      ${totalRevisionsDetected}`);
  console.log(`Thread Metadata Created: ${totalThreadsProcessed}`);
  console.log('');
  console.log('✅ Duplicate detection and revision extraction complete!\n');

  // Step 4: Show sample results
  console.log('📊 Sample Results:\n');

  const { data: sampleThreads } = await supabase
    .from('email_thread_metadata')
    .select('*')
    .order('email_count', { ascending: false })
    .limit(5);

  if (sampleThreads) {
    console.table(sampleThreads.map(t => ({
      Thread_ID: t.thread_id.substring(0, 12) + '...',
      Subject: t.thread_subject?.substring(0, 40) || 'N/A',
      Total: t.email_count,
      Unique: t.unique_email_count,
      Duplicates: t.duplicate_count
    })));
  }

  console.log('');
}

function generateHash(content: string): string {
  // Normalize content before hashing (remove whitespace variations)
  const normalized = content
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim()
    .toLowerCase();

  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex');
}

interface DuplicateInfo {
  duplicateId: string;
  originalId: string;
  hash: string;
  position: number;
}

function findDuplicates(emails: any[]): DuplicateInfo[] {
  const duplicates: DuplicateInfo[] = [];
  const seen: Record<string, { id: string, position: number }> = {};

  emails.forEach((email) => {
    if (seen[email.content_hash]) {
      // This is a duplicate
      duplicates.push({
        duplicateId: email.id,
        originalId: seen[email.content_hash].id,
        hash: email.content_hash,
        position: email.thread_position
      });
    } else {
      // First occurrence
      seen[email.content_hash] = {
        id: email.id,
        position: email.thread_position
      };
    }
  });

  return duplicates;
}

function extractRevisionType(subject: string): string | null {
  const subjectLower = subject.toLowerCase();

  // Check for explicit revision markers
  if (subjectLower.includes('original') ||
      (!subjectLower.includes('update') && !subjectLower.includes('amendment'))) {
    return 'original';
  }

  // Check for numbered updates
  const updateMatch = subject.match(/(\d+)(?:st|nd|rd|th)\s+update/i);
  if (updateMatch) {
    const num = parseInt(updateMatch[1]);
    if (num === 1) return '1st_update';
    if (num === 2) return '2nd_update';
    if (num === 3) return '3rd_update';
    if (num === 4) return '4th_update';
    if (num === 5) return '5th_update';
    return `${num}th_update`;
  }

  // Check for generic "update" or "amendment"
  if (subjectLower.includes('update')) {
    return '1st_update';  // Default to 1st update if not specified
  }

  if (subjectLower.includes('amendment') || subjectLower.includes('amm #')) {
    return 'amendment';
  }

  if (subjectLower.includes('cancellation') || subjectLower.includes('cancelled')) {
    return 'cancellation';
  }

  return null;  // No revision type detected
}

detectDuplicatesAndRevisions().catch(console.error);
