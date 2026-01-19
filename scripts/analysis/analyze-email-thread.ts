/**
 * Analyze Complex Email Threads
 * Shows how database stores threads and how AI classifies each message
 */

import { supabase } from '../utils/supabase-client';

async function analyzeEmailThread() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                         EMAIL THREAD ANALYSIS - HOW THREADS ARE HANDLED                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Find threads (emails with same thread_id)
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('thread_id, subject')
    .not('thread_id', 'is', null)
    .order('received_at', { ascending: false })
    .limit(100);

  if (!allEmails) {
    console.log('No emails found\n');
    return;
  }

  // Group by thread_id to find threads with multiple emails
  const threadCounts: Record<string, number> = {};
  allEmails.forEach(email => {
    if (email.thread_id) {
      threadCounts[email.thread_id] = (threadCounts[email.thread_id] || 0) + 1;
    }
  });

  // Find threads with 3+ emails (complex conversations)
  const complexThreads = Object.entries(threadCounts)
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  console.log(`Found ${complexThreads.length} complex threads (3+ emails in conversation)\n`);

  for (const [threadId, emailCount] of complexThreads) {
    console.log('═'.repeat(100));
    console.log(`📧 THREAD: ${threadId} (${emailCount} emails in conversation)`);
    console.log('═'.repeat(100) + '\n');

    // Fetch all emails in this thread
    const { data: threadEmails } = await supabase
      .from('raw_emails')
      .select(`
        id,
        gmail_message_id,
        thread_id,
        subject,
        sender_email,
        sender_name,
        recipient_emails,
        body_text,
        snippet,
        received_at,
        labels,
        document_classifications (
          id,
          document_type,
          confidence_score,
          classification_reason
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

    if (!threadEmails) continue;

    console.log(`  CONVERSATION TIMELINE (${threadEmails.length} messages):`);
    console.log('  ' + '─'.repeat(97) + '\n');

    threadEmails.forEach((email, idx) => {
      console.log(`  ┌─ MESSAGE ${idx + 1} of ${threadEmails.length} ─────────────────────────────────────────────────────────────────────────`);
      console.log(`  │`);
      console.log(`  │ 📧 RAW EMAIL DATA:`);
      console.log(`  │    Email ID:     ${email.id.substring(0, 20)}...`);
      console.log(`  │    Gmail Msg ID: ${email.gmail_message_id}`);
      console.log(`  │    Thread ID:    ${email.thread_id} ← Links all emails in conversation`);
      console.log(`  │    Subject:      ${email.subject?.substring(0, 60) || 'N/A'}`);
      console.log(`  │    From:         ${email.sender_email}${email.sender_name ? ' (' + email.sender_name + ')' : ''}`);
      console.log(`  │    To:           ${email.recipient_emails?.slice(0, 2).join(', ') || 'N/A'}`);
      console.log(`  │    Sent:         ${new Date(email.received_at).toLocaleString()}`);
      console.log(`  │    Labels:       ${email.labels?.join(', ') || 'None'}`);

      // Show email direction
      const isOutgoing = email.sender_email?.includes('@intoglo.com');
      const direction = isOutgoing ? '📤 OUTGOING (Intoglo → External)' : '📥 INCOMING (External → Intoglo)';
      console.log(`  │    Direction:    ${direction}`);

      if (email.snippet) {
        console.log(`  │`);
        console.log(`  │    Snippet: "${email.snippet.substring(0, 80)}..."`);
      }

      console.log(`  │`);
      console.log(`  │ 🏷️  AI CLASSIFICATION:`);

      if (email.document_classifications && email.document_classifications.length > 0) {
        const c = email.document_classifications[0];
        const confidenceIcon = c.confidence_score >= 85 ? '✅' : c.confidence_score >= 50 ? '⚠️' : '❌';
        console.log(`  │    Type:         ${c.document_type} (${c.confidence_score}% ${confidenceIcon})`);
        console.log(`  │    Reasoning:    "${c.classification_reason?.substring(0, 70)}..."`);
      } else {
        console.log(`  │    Status:       ⚠️  Not yet classified`);
      }

      console.log(`  │`);
      console.log(`  │ 📊 EXTRACTED ENTITIES:`);

      if (email.entity_extractions && email.entity_extractions.length > 0) {
        // Remove duplicates
        const unique = email.entity_extractions.reduce((acc: any[], curr: any) => {
          const exists = acc.find(e =>
            e.entity_type === curr.entity_type && e.entity_value === curr.entity_value
          );
          if (!exists) acc.push(curr);
          return acc;
        }, []);

        console.log(`  │    Count:        ${unique.length} entities`);
        unique.slice(0, 5).forEach((e: any) => {
          const icon = e.confidence_score >= 70 ? '✅' : '⚠️';
          console.log(`  │    • ${e.entity_type.padEnd(20)} ${e.entity_value.padEnd(20)} (${e.confidence_score}% ${icon})`);
        });
        if (unique.length > 5) {
          console.log(`  │    ... and ${unique.length - 5} more`);
        }
      } else {
        console.log(`  │    Status:       No entities extracted`);
      }

      console.log(`  │`);
      console.log(`  └${'─'.repeat(97)}\n`);
    });

    // Thread summary
    console.log(`  📊 THREAD SUMMARY:`);
    console.log('  ' + '─'.repeat(97));

    const outgoing = threadEmails.filter(e => e.sender_email?.includes('@intoglo.com')).length;
    const incoming = threadEmails.length - outgoing;
    const classified = threadEmails.filter(e => e.document_classifications?.length > 0).length;
    const withEntities = threadEmails.filter(e => e.entity_extractions?.length > 0).length;

    console.log(`  Total Messages:      ${threadEmails.length}`);
    console.log(`  📤 Outgoing:         ${outgoing} (from Intoglo team)`);
    console.log(`  📥 Incoming:         ${incoming} (from external parties)`);
    console.log(`  🏷️  Classified:       ${classified} (${(classified/threadEmails.length*100).toFixed(0)}%)`);
    console.log(`  📊 With Entities:    ${withEntities} (${(withEntities/threadEmails.length*100).toFixed(0)}%)`);

    // Document types in thread
    const docTypes = threadEmails
      .filter(e => e.document_classifications?.length > 0)
      .map(e => e.document_classifications![0].document_type);

    if (docTypes.length > 0) {
      console.log(`  📋 Doc Types:        ${[...new Set(docTypes)].join(', ')}`);
    }

    console.log('\n');

    // Only show first thread in detail for readability
    break;
  }

  console.log('═'.repeat(100));
  console.log('✅ Thread analysis complete!\n');
}

analyzeEmailThread().catch(console.error);
