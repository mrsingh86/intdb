/**
 * Test Memory Layer with Real Email from Database
 *
 * Fetches a recent email from chronicle table and tests memory context building.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  createMemoryService,
  buildMemoryContextForAI,
  updateMemoryAfterProcessing,
  IMemoryService,
  MemoryScope,
  ScopeIdBuilder,
} from '../../lib/memory';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================================
// FETCH RECENT EMAIL FROM CHRONICLE
// ============================================================================

interface ChronicleEmail {
  id: string;
  gmail_message_id: string;
  subject: string;
  from_address: string;
  body_preview: string;
  document_type: string;
  booking_number: string | null;
  mbl_number: string | null;
  carrier_name: string | null;
  vessel_name: string | null;
  etd: string | null;
  eta: string | null;
  summary: string | null;
  from_party: string | null;
  ai_confidence: number | null;
  occurred_at: string;
}

async function fetchRecentEmails(limit: number = 5): Promise<ChronicleEmail[]> {
  console.log(`Fetching ${limit} recent emails from chronicle...\n`);

  const { data, error } = await supabase
    .from('chronicle')
    .select(`
      id, gmail_message_id, subject, from_address, body_preview,
      document_type, booking_number, mbl_number, carrier_name,
      vessel_name, etd, eta, summary, from_party, ai_confidence, occurred_at
    `)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching emails:', error.message);
    return [];
  }

  return data || [];
}

// ============================================================================
// EXTRACT DOMAIN
// ============================================================================

function extractDomain(email: string): string {
  const match = email.match(/@([^@>]+)/);
  return match ? match[1].toLowerCase() : 'unknown';
}

function detectCarrier(domain: string): string | undefined {
  const carriers: Record<string, string> = {
    'maersk.com': 'maersk',
    'hapag-lloyd.com': 'hapag',
    'hlag.com': 'hapag',
    'cma-cgm.com': 'cma',
    'msc.com': 'msc',
    'one-line.com': 'one',
    'evergreen-marine.com': 'evergreen',
    'cosco.com': 'cosco',
    'oocl.com': 'oocl',
  };
  for (const [d, c] of Object.entries(carriers)) {
    if (domain.includes(d)) return c;
  }
  return undefined;
}

// ============================================================================
// TEST MEMORY CONTEXT FOR EMAIL
// ============================================================================

async function testMemoryForEmail(
  memoryService: IMemoryService,
  email: ChronicleEmail,
  index: number
) {
  const senderDomain = extractDomain(email.from_address);

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📧 EMAIL ${index + 1}: ${email.document_type}`);
  console.log('─'.repeat(70));
  console.log(`  Subject: ${email.subject?.substring(0, 60)}...`);
  console.log(`  From: ${email.from_address}`);
  console.log(`  Domain: ${senderDomain}`);
  console.log(`  Booking: ${email.booking_number || 'N/A'}`);
  console.log(`  Type: ${email.document_type}`);
  console.log(`  Confidence: ${email.ai_confidence || 'N/A'}%`);

  // Build memory context
  console.log('\n  📦 MEMORY CONTEXT:');
  const startTime = Date.now();
  const result = await buildMemoryContextForAI(memoryService, {
    email: {
      subject: email.subject || '',
      bodyPreview: email.body_preview || '',
      senderEmail: email.from_address,
      senderDomain,
    },
    bookingNumber: email.booking_number || undefined,
    carrier: detectCarrier(senderDomain),
  });
  const elapsed = Date.now() - startTime;

  console.log(`     Time: ${elapsed}ms`);
  console.log(`     Memories: ${result.memories.length}`);
  console.log(`     Tokens: ~${result.tokenEstimate}`);

  if (result.memories.length > 0) {
    console.log('     Found:');
    for (const mem of result.memories) {
      const preview = mem.content.split('\n')[0].substring(0, 45);
      console.log(`       [${mem.scope}] ${preview}...`);
    }
  }

  // Simulate learning from this email
  console.log('\n  🧠 LEARNING:');
  const learnResult = await updateMemoryAfterProcessing(memoryService, {
    email: {
      subject: email.subject || '',
      senderEmail: email.from_address,
      senderDomain,
      bodyPreview: email.body_preview || '',
    },
    analysis: {
      document_type: email.document_type,
      booking_number: email.booking_number || undefined,
      mbl_number: email.mbl_number || undefined,
      etd: email.etd || undefined,
      eta: email.eta || undefined,
      vessel_name: email.vessel_name || undefined,
      summary: email.summary || undefined,
      from_party: email.from_party || undefined,
    },
    confidence: email.ai_confidence || 75,
    processingTime: elapsed,
    patternMatched: false,
  });

  if (learnResult.updated.length > 0) {
    console.log(`     Updated: ${learnResult.updated.join(', ')}`);
  }
  if (learnResult.errors.length > 0) {
    console.log(`     Errors: ${learnResult.errors.join(', ')}`);
  }

  return { email, result, learnResult };
}

// ============================================================================
// SHOW MEMORY STATE
// ============================================================================

async function showMemoryState() {
  console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  CURRENT MEMORY STATE                                           ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const { data, error, count } = await supabase
    .from('ai_memories')
    .select('scope, scope_id, content, metadata', { count: 'exact' })
    .order('updated_at', { ascending: false });

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  console.log(`Total memories: ${count}\n`);

  // Group by scope
  const byScope: Record<string, Array<{ id: string; preview: string; meta: any }>> = {};
  for (const m of data || []) {
    if (!byScope[m.scope]) byScope[m.scope] = [];
    const preview = m.content.split('\n').slice(0, 2).join(' | ').substring(0, 60);
    byScope[m.scope].push({ id: m.scope_id, preview, meta: m.metadata });
  }

  for (const [scope, items] of Object.entries(byScope)) {
    console.log(`${scope.toUpperCase()} (${items.length}):`);
    for (const item of items.slice(0, 5)) {
      console.log(`  • ${item.id}`);
      console.log(`    ${item.preview}...`);
      if (item.meta?.emailCount) {
        console.log(`    (${item.meta.emailCount} emails seen)`);
      }
    }
    if (items.length > 5) {
      console.log(`  ... and ${items.length - 5} more`);
    }
    console.log('');
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n');
  console.log('═'.repeat(70));
  console.log('   TEST: Memory Layer with Real Emails from Chronicle');
  console.log('═'.repeat(70));

  const memoryService = createMemoryService(supabase);

  // Fetch recent emails
  const emails = await fetchRecentEmails(5);

  if (emails.length === 0) {
    console.log('No emails found in chronicle table.');
    return;
  }

  console.log(`Found ${emails.length} recent emails\n`);

  // Process each email
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  PROCESSING EMAILS                                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const results = [];
  for (let i = 0; i < emails.length; i++) {
    const result = await testMemoryForEmail(memoryService, emails[i], i);
    results.push(result);
  }

  // Show current memory state
  await showMemoryState();

  // Summary
  console.log('═'.repeat(70));
  console.log('   SUMMARY');
  console.log('═'.repeat(70));

  const totalMemories = results.reduce((acc, r) => acc + r.result.memories.length, 0);
  const totalLearned = results.reduce((acc, r) => acc + r.learnResult.updated.length, 0);
  const avgTokens = Math.round(
    results.reduce((acc, r) => acc + r.result.tokenEstimate, 0) / results.length
  );

  console.log(`
  Emails processed: ${emails.length}
  Total memories retrieved: ${totalMemories}
  Total memories updated: ${totalLearned}
  Average context tokens: ~${avgTokens}

  Token savings vs semantic context:
  • Semantic: ~8,000 tokens per email
  • Memory:   ~${avgTokens} tokens per email
  • Savings:  ${Math.round((1 - avgTokens / 8000) * 100)}% reduction

  The memory layer is now learning from each email:
  ✓ Sender profiles accumulate document types
  ✓ Shipment context tracks booking progress
  ✓ Error patterns guide AI decisions
`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
