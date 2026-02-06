/**
 * EXPLAIN: How Semantic Enhancements Changed Chronicle & Pulse
 *
 * This script shows BEFORE vs AFTER comparisons with real examples
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { createEmbeddingService } from '../lib/chronicle/embedding-service';
import { createUnifiedSearchService } from '../lib/chronicle/unified-search-service';
import { classifyQuery } from '../lib/chronicle/query-classifier';
import { ActionRulesService } from '../lib/chronicle/action-rules-service';
import { createSemanticGroupingService, CommunicationItem } from '../lib/chronicle-v2/services/semantic-grouping-service';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const embeddingService = createEmbeddingService(supabase);
const unifiedSearch = createUnifiedSearchService(supabase, embeddingService);

// ============================================================================
// CHANGE 1: PULSE SEARCH - Query Classification & Routing
// ============================================================================

async function explainPulseSearchChanges() {
  console.log('\n' + '═'.repeat(80));
  console.log('CHANGE 1: PULSE SEARCH - Smart Query Routing');
  console.log('═'.repeat(80));

  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│ WHAT CHANGED IN /api/pulse/search:                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ BEFORE: All searches used the same ILIKE query on limited fields            │
│ AFTER:  Queries are classified and routed to optimal search strategy        │
└─────────────────────────────────────────────────────────────────────────────┘
`);

  const testQueries = [
    { query: '261140854', description: 'Booking number search' },
    { query: 'MRKU8561193', description: 'Container number search' },
    { query: 'customs hold', description: 'Conceptual search' },
    { query: 'Marathon Brake', description: 'Company name search' },
  ];

  for (const { query, description } of testQueries) {
    console.log(`\n📝 Query: "${query}" (${description})`);
    console.log('─'.repeat(70));

    // Show classification
    const classification = classifyQuery(query);
    console.log(`\n   CLASSIFICATION:`);
    console.log(`   • Type: ${classification.queryType}`);
    console.log(`   • Strategy: ${classification.searchStrategy}`);
    console.log(`   • Confidence: ${classification.confidence}%`);

    // Show what happens with each strategy
    console.log(`\n   BEFORE (old approach):`);
    console.log(`   • Would search: subject ILIKE '%${query}%' OR body ILIKE '%${query}%'`);
    console.log(`   • Problem: Slow full-text scan, no semantic understanding`);

    console.log(`\n   AFTER (new approach):`);
    switch (classification.searchStrategy) {
      case 'keyword':
        const fields = classification.queryType === 'booking_number' ? 'booking_number' :
                       classification.queryType === 'container_number' ? 'container_numbers' :
                       classification.queryType === 'port_code' ? 'pol, pod' : 'subject';
        console.log(`   • Searches specific field: ${fields} = '${query}'`);
        console.log(`   • Benefit: Fast index lookup, exact matches`);
        break;
      case 'semantic':
        console.log(`   • Generates embedding for "${query}"`);
        console.log(`   • Uses pgvector similarity search (cosine distance)`);
        console.log(`   • Benefit: Finds related content even with different wording`);
        break;
      case 'hybrid':
        console.log(`   • Runs BOTH keyword AND semantic search in parallel`);
        console.log(`   • Merges results using RRF (Reciprocal Rank Fusion)`);
        console.log(`   • Benefit: Best of both - exact matches + related content`);
        break;
    }

    // Run actual search
    const results = await unifiedSearch.search(query, { limit: 3 });
    console.log(`\n   RESULTS: ${results.totalFound} found in ${results.searchTime}ms`);

    if (results.results.length > 0) {
      for (const r of results.results.slice(0, 2)) {
        console.log(`   • [${r.matchType}] ${r.documentType}: ${r.subject?.substring(0, 45)}...`);
      }
    }
  }
}

// ============================================================================
// CHANGE 2: ACTION DETERMINATION - Vector Intent Detection
// ============================================================================

async function explainActionChanges() {
  console.log('\n\n' + '═'.repeat(80));
  console.log('CHANGE 2: ACTION DETERMINATION - Smart Intent Detection');
  console.log('═'.repeat(80));

  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│ WHAT CHANGED IN Chronicle Action Rules:                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ BEFORE: Only exact keyword matching + database rules                        │
│ AFTER:  Adds vector similarity + learning from similar past emails          │
└─────────────────────────────────────────────────────────────────────────────┘

HOW ACTION IS DETERMINED (Priority Order):

   1. action_lookup table     → Exact match: document_type + from_party
   2. document_type_rules     → Default action + keyword flip
   3. Phrase matching         → "please respond", "confirmed", etc.
   4. [NEW] Vector intent     → Compare against intent anchor embeddings
   5. [NEW] Similar emails    → What actions did similar past emails have?
`);

  const actionRulesService = new ActionRulesService(supabase);
  actionRulesService.setEmbeddingService(embeddingService);

  // Example 1: Clear phrases
  console.log('\n📧 EXAMPLE 1: Email with clear action phrase');
  console.log('─'.repeat(70));
  console.log('   Subject: "RE: Booking Amendment"');
  console.log('   Body: "Please confirm the updated ETD at your earliest convenience."');

  const result1 = await actionRulesService.determineAction(
    'booking_amendment',
    'RE: Booking Amendment',
    'Please confirm the updated ETD at your earliest convenience.'
  );

  console.log(`\n   BEFORE: Would check "please confirm" against keyword list`);
  console.log(`   AFTER:  Same - phrase matching catches it`);
  console.log(`\n   Result: ${result1.hasAction ? '⚡ ACTION' : '✅ NO ACTION'}`);
  console.log(`   Source: ${result1.source}`);
  console.log(`   Reason: ${result1.reason}`);

  // Example 2: Ambiguous - needs vector detection
  console.log('\n\n📧 EXAMPLE 2: Ambiguous email (no clear phrases)');
  console.log('─'.repeat(70));
  console.log('   Subject: "Update on Shipment Status"');
  console.log('   Body: "The cargo is still at the terminal. We are monitoring the situation.');
  console.log('          Will keep you posted on any developments."');

  const result2 = await actionRulesService.determineAction(
    'tracking_update',
    'Update on Shipment Status',
    'The cargo is still at the terminal. We are monitoring the situation. Will keep you posted on any developments.'
  );

  console.log(`\n   BEFORE: No keyword match → default to rule (often wrong)`);
  console.log(`   AFTER:  Vector intent compares against "action required" anchors`);
  console.log(`\n   Result: ${result2.hasAction ? '⚡ ACTION' : '✅ NO ACTION'}`);
  console.log(`   Source: ${result2.source}`);
  console.log(`   Reason: ${result2.reason}`);

  // Example 3: Learning from similar
  console.log('\n\n📧 EXAMPLE 3: Learning from similar past emails');
  console.log('─'.repeat(70));
  console.log('   Subject: "Booking Confirmation - 123456"');
  console.log('   Body: "Your booking has been confirmed. Vessel: APL MERLION"');

  const result3 = await actionRulesService.determineAction(
    'booking_confirmation',
    'Booking Confirmation - 123456',
    'Your booking has been confirmed. Vessel: APL MERLION. ETD: Feb 15.'
  );

  console.log(`\n   BEFORE: Just use document_type default rule`);
  console.log(`   AFTER:  Also checks what happened with similar booking confirmations`);
  console.log(`\n   Result: ${result3.hasAction ? '⚡ ACTION' : '✅ NO ACTION'}`);
  console.log(`   Source: ${result3.source}`);
  console.log(`   Reason: ${result3.reason}`);
}

// ============================================================================
// CHANGE 3: AI SUMMARY - Semantic Grouping
// ============================================================================

async function explainSummaryChanges() {
  console.log('\n\n' + '═'.repeat(80));
  console.log('CHANGE 3: AI SUMMARY - Semantic Grouping of Communications');
  console.log('═'.repeat(80));

  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│ WHAT CHANGED IN HaikuSummaryService (AI Shipment Summaries):                │
├─────────────────────────────────────────────────────────────────────────────┤
│ BEFORE: AI sees communications in chronological order only                  │
│ AFTER:  AI ALSO sees communications grouped by topic                        │
└─────────────────────────────────────────────────────────────────────────────┘
`);

  // Get a real shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .not('booking_number', 'is', null)
    .limit(1)
    .single();

  if (!shipment) {
    console.log('No shipment found');
    return;
  }

  // Get communications
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('id, occurred_at, direction, from_party, document_type, summary, has_issue, issue_type, has_action, action_description, thread_id')
    .eq('shipment_id', shipment.id)
    .order('occurred_at', { ascending: false })
    .limit(15);

  if (!chronicles || chronicles.length === 0) {
    console.log('No communications found');
    return;
  }

  console.log(`\nUsing shipment: ${shipment.booking_number} with ${chronicles.length} messages\n`);

  // Show BEFORE (chronological)
  console.log('📋 BEFORE: What AI saw (chronological order only)');
  console.log('─'.repeat(70));
  console.log(`
## RECENT ACTIVITY (Last 7 Days)
`);
  for (const c of chronicles.slice(0, 8)) {
    const date = new Date(c.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const dir = c.direction === 'inbound' ? '←' : '→';
    console.log(`${date} ${dir} ${c.from_party}: ${c.summary?.substring(0, 55)}...`);
  }
  console.log(`... and ${chronicles.length - 8} more`);

  console.log(`
   Problem: AI sees a mixed timeline - customs, delivery, invoices all jumbled.
            Hard to understand what's happening with each TOPIC.
`);

  // Show AFTER (grouped)
  const groupingService = createSemanticGroupingService(supabase);
  const communications: CommunicationItem[] = chronicles.map(c => ({
    id: c.id,
    occurredAt: c.occurred_at,
    direction: c.direction,
    fromParty: c.from_party,
    documentType: c.document_type,
    summary: c.summary,
    hasIssue: c.has_issue,
    issueType: c.issue_type,
    hasAction: c.has_action,
    actionDescription: c.action_description,
    threadId: c.thread_id,
  }));

  const grouping = await groupingService.groupCommunications(shipment.id, communications);

  console.log('\n📋 AFTER: What AI NOW sees (grouped by topic)');
  console.log('─'.repeat(70));
  console.log(groupingService.buildPromptSection(grouping));

  console.log(`
   Benefit: AI can now see:
   • All customs-related messages together
   • All delivery-related messages together
   • All financial messages together
   • Which topics are ONGOING 🔴 vs RESOLVED ✅

   This helps AI generate better summaries by understanding the CONTEXT
   of each issue/topic, not just a random timeline of events.
`);
}

// ============================================================================
// CHANGE 4: API ENDPOINT CHANGES
// ============================================================================

function explainAPIChanges() {
  console.log('\n' + '═'.repeat(80));
  console.log('CHANGE 4: API ENDPOINT CHANGES');
  console.log('═'.repeat(80));

  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│ UPDATED API ENDPOINTS:                                                      │
└─────────────────────────────────────────────────────────────────────────────┘

1. /api/pulse/search (Main Pulse Search)
   ─────────────────────────────────────
   BEFORE: Simple ILIKE search on subject/body
   AFTER:
   • Classifies query type (booking, container, port, party, conceptual)
   • Routes to keyword/semantic/hybrid strategy
   • Returns queryType + searchStrategy in response
   • For booking/container queries → redirects to single dossier view

   Response now includes:
   {
     results: [...],
     queryType: "booking_number" | "container_number" | "conceptual" | etc,
     searchStrategy: "keyword" | "semantic" | "hybrid",
     confidence: 95
   }


2. /api/pulse/dossier-search (Search within a shipment)
   ─────────────────────────────────────────────────────
   BEFORE: Keyword-only search within booking's emails
   AFTER:
   • Still does keyword search first
   • For conceptual queries, ALSO does semantic search
   • Merges results, marking which came from keyword vs semantic

   Response now includes:
   {
     results: [...],
     keywordMatches: 5,
     semanticMatches: 3,
     queryType: "conceptual"
   }


3. /api/search (Site-wide search)
   ──────────────────────────────
   BEFORE: Parallel search across shipments, stakeholders, chronicle
   AFTER:
   • Same parallel search
   • Chronicle search now uses UnifiedSearchService
   • Returns matchType for each result (keyword/semantic/both)
`);
}

// ============================================================================
// SUMMARY
// ============================================================================

function showSummary() {
  console.log('\n' + '═'.repeat(80));
  console.log('SUMMARY: What Changed & Why It Matters');
  console.log('═'.repeat(80));

  console.log(`
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SEMANTIC ENHANCEMENTS SUMMARY                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. PULSE SEARCH                                                            │
│     • Query classification (booking, container, party, conceptual)          │
│     • Smart routing to keyword/semantic/hybrid search                       │
│     • Better results for conceptual queries like "customs hold"             │
│                                                                             │
│  2. ACTION DETERMINATION                                                    │
│     • Vector intent detection for ambiguous emails                          │
│     • Learning from similar past emails                                     │
│     • More accurate has_action decisions                                    │
│                                                                             │
│  3. AI SUMMARIES                                                            │
│     • Communications grouped by topic (customs, delivery, financial)        │
│     • AI understands context better                                         │
│     • Generates more relevant summaries                                     │
│                                                                             │
│  4. API RESPONSES                                                           │
│     • Include queryType, searchStrategy, confidence                         │
│     • Include matchType (keyword/semantic/both) per result                  │
│     • Frontend can show "semantic match" badges                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

FILES CHANGED:
─────────────────────────────────────────────────────────────────────────────

  lib/chronicle/
  ├── query-classifier.ts          [NEW] Query type classification
  ├── unified-search-service.ts    [NEW] Search orchestration + RRF merge
  ├── embedding-service.ts         [MODIFIED] Added generateEmbeddingFromText
  ├── action-rules-service.ts      [MODIFIED] Vector intent + similar emails
  └── index.ts                     [MODIFIED] Exports

  lib/chronicle-v2/services/
  └── semantic-grouping-service.ts [NEW] Topic grouping for AI
  └── haiku-summary-service.ts     [MODIFIED] Uses semantic grouping

  app/api/
  ├── pulse/search/route.ts        [MODIFIED] Uses UnifiedSearchService
  ├── pulse/dossier-search/route.ts [MODIFIED] Adds semantic search
  └── search/route.ts              [MODIFIED] Uses UnifiedSearchService
`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║     EXPLAINING SEMANTIC CHANGES TO CHRONICLE & PULSE                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝');

  await explainPulseSearchChanges();
  await explainActionChanges();
  await explainSummaryChanges();
  explainAPIChanges();
  showSummary();

  console.log('\n' + '═'.repeat(80));
  console.log('EXPLANATION COMPLETE');
  console.log('═'.repeat(80));
}

main().catch(e => console.error('Error:', e));
