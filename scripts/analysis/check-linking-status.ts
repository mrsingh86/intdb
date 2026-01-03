/**
 * Check why linking isn't running
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkLinkingService() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              LINKING SERVICE STATUS CHECK');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Check processing_logs for linking runs
  console.log('1. PROCESSING LOGS - LINKING RUNS');
  const { data: logs } = await supabase
    .from('processing_logs')
    .select('id, run_type, status, emails_processed, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (logs && logs.length > 0) {
    console.log('   Recent runs:');
    logs.forEach(l => {
      console.log(`   ${l.run_type?.padEnd(30) || 'N/A'.padEnd(30)} | ${l.status?.padEnd(10) || 'N/A'} | ${l.emails_processed || 0} emails | ${l.created_at}`);
    });
  } else {
    console.log('   NO RUNS FOUND IN LOGS');
  }

  // 2. Check how existing documents were linked
  console.log('');
  console.log('2. SHIPMENT_DOCUMENTS LINK SOURCES');
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('link_source, link_confidence')
    .limit(2000);

  const sources: Record<string, number> = {};
  (docs || []).forEach(d => {
    sources[d.link_source || 'null'] = (sources[d.link_source || 'null'] || 0) + 1;
  });
  console.log('   Link sources:', sources);

  // 3. Check if there's a dedicated linking cron
  console.log('');
  console.log('3. LINKING SERVICE USAGE');

  // Check raw_emails processing_status
  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  const { count: processedEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('processing_status', 'processed');

  const { count: pendingEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('processing_status', 'pending');

  console.log(`   Total emails: ${totalEmails}`);
  console.log(`   Processed: ${processedEmails}`);
  console.log(`   Pending: ${pendingEmails}`);

  // 4. Check shipment_link_candidates in detail
  console.log('');
  console.log('4. LINK CANDIDATES DETAIL');
  const { data: candidates } = await supabase
    .from('shipment_link_candidates')
    .select('*')
    .limit(20);

  console.log(`   Total candidates: ${candidates?.length || 0}`);
  if (candidates && candidates.length > 0) {
    console.log('   Samples:');
    candidates.slice(0, 5).forEach(c => {
      console.log(`     ${c.link_type?.padEnd(15)} | ${c.matched_value?.padEnd(15) || 'N/A'} | conf: ${c.confidence_score} | confirmed: ${c.is_confirmed}`);
    });
  }

  // 5. Check if entity extraction is running
  console.log('');
  console.log('5. ENTITY EXTRACTION STATUS');
  const { count: totalEntities } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  // Sample: check if recent emails have entities
  const { data: recentEmails } = await supabase
    .from('raw_emails')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(10);

  let recentWithEntities = 0;
  for (const email of recentEmails || []) {
    const { count } = await supabase
      .from('entity_extractions')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', email.id);
    if (count && count > 0) recentWithEntities++;
  }

  console.log(`   Total entities: ${totalEntities}`);
  console.log(`   Recent 10 emails with entities: ${recentWithEntities}/10`);

  // 6. Check shipment_documents creation source
  console.log('');
  console.log('6. DOCUMENT LINKING ANALYSIS');

  // Get emails that are linked but check HOW they got linked
  const { data: linkedDocs } = await supabase
    .from('shipment_documents')
    .select('email_id, link_source, link_confidence, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  console.log('   Recent linked documents:');
  (linkedDocs || []).slice(0, 10).forEach(d => {
    console.log(`     source: ${(d.link_source || 'null').padEnd(20)} | conf: ${d.link_confidence || 'N/A'} | ${d.created_at}`);
  });
}

checkLinkingService().catch(console.error);
