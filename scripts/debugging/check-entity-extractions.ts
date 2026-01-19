/**
 * Check Entity Extractions Status
 * Shows what document data is being extracted
 */

import { supabase } from '../utils/supabase-client';

async function checkEntityExtractions() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                            ENTITY EXTRACTION STATUS                                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Count total extractions
  const { count: totalExtractions } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  // Count emails with extractions
  const { data: emailsWithExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .limit(1000);

  const uniqueEmailsWithExtractions = new Set(emailsWithExtractions?.map(e => e.email_id)).size;

  // Count total classified emails
  const { count: totalClassified } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });

  console.log('📊 OVERALL STATISTICS:\n');
  console.log(`   Total entity extractions:  ${totalExtractions || 0}`);
  console.log(`   Emails with extractions:   ${uniqueEmailsWithExtractions}`);
  console.log(`   Total classified emails:   ${totalClassified || 0}`);
  console.log(`   Extraction rate:           ${totalClassified ? ((uniqueEmailsWithExtractions / totalClassified) * 100).toFixed(1) : 0}%\n`);

  if (totalExtractions === 0) {
    console.log('⚠️  WARNING: NO ENTITY EXTRACTIONS FOUND!\n');
    console.log('   This means document data is NOT being extracted.\n');
    console.log('   Reasons:');
    console.log('   1. Entity extraction code not running during classification');
    console.log('   2. All emails have confidence < 50% (extraction threshold)');
    console.log('   3. AI not finding extractable entities in emails\n');
    return;
  }

  // Get entity type breakdown
  console.log('─'.repeat(100));
  console.log('ENTITY TYPE BREAKDOWN');
  console.log('─'.repeat(100) + '\n');

  const { data: allExtractions } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value, confidence_score')
    .limit(1000);

  const entityTypes: Record<string, number> = {};
  allExtractions?.forEach(e => {
    entityTypes[e.entity_type] = (entityTypes[e.entity_type] || 0) + 1;
  });

  const sortedTypes = Object.entries(entityTypes).sort((a, b) => b[1] - a[1]);

  console.table(sortedTypes.map(([type, count]) => ({
    Entity_Type: type,
    Count: count,
    Percentage: `${((count / (totalExtractions || 1)) * 100).toFixed(1)}%`
  })));

  // Show sample extractions
  console.log('\n' + '─'.repeat(100));
  console.log('SAMPLE EXTRACTIONS (Last 10)');
  console.log('─'.repeat(100) + '\n');

  const { data: samples } = await supabase
    .from('entity_extractions')
    .select(`
      entity_type,
      entity_value,
      confidence_score,
      created_at,
      raw_emails (
        subject,
        sender_email
      )
    `)
    .order('created_at', { ascending: false })
    .limit(10);

  samples?.forEach((s: any, idx: number) => {
    console.log(`${idx + 1}. ${s.entity_type.toUpperCase()}: "${s.entity_value}"`);
    console.log(`   Confidence: ${s.confidence_score}%`);
    console.log(`   From email: ${s.raw_emails?.subject?.substring(0, 50)}...`);
    console.log(`   Sender: ${s.raw_emails?.sender_email}`);
    console.log('');
  });

  // Check extraction methods
  const { data: methods } = await supabase
    .from('entity_extractions')
    .select('extraction_method')
    .limit(1000);

  const methodCounts: Record<string, number> = {};
  methods?.forEach(m => {
    methodCounts[m.extraction_method] = (methodCounts[m.extraction_method] || 0) + 1;
  });

  console.log('─'.repeat(100));
  console.log('EXTRACTION METHODS');
  console.log('─'.repeat(100) + '\n');

  Object.entries(methodCounts).forEach(([method, count]) => {
    console.log(`   ${method}: ${count} (${((count / (totalExtractions || 1)) * 100).toFixed(1)}%)`);
  });
  console.log('');

  // Final verdict
  console.log('═'.repeat(100));
  console.log('VERDICT');
  console.log('═'.repeat(100));

  if (totalExtractions && totalExtractions > 0) {
    console.log('\n✅ Entity extraction IS WORKING\n');
    console.log(`   • ${totalExtractions} entities extracted`);
    console.log(`   • ${uniqueEmailsWithExtractions} emails have extracted data`);
    console.log(`   • ${sortedTypes.length} different entity types found`);
    console.log(`   • Most common: ${sortedTypes[0][0]} (${sortedTypes[0][1]} extractions)\n`);
  } else {
    console.log('\n❌ Entity extraction NOT WORKING\n');
    console.log('   Run classify-with-thread-context.ts to extract entities from classified emails\n');
  }
}

checkEntityExtractions().catch(console.error);
