/**
 * Test Reprocess Script
 *
 * Run with: npx ts-node --transpile-only scripts/test-reprocess.ts
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

// Load environment
config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testPatternMatching() {
  console.log('=== Testing Pattern Matching ===\n');

  // Get patterns we added
  const { data: patterns } = await supabase
    .from('detection_patterns')
    .select('pattern, document_type')
    .in('pattern', [
      'One-time passcode',
      'Transport Plan has Changed.*Maersk',
      'CMA CGM.*Booking confirmation available',
      'Go Green for'
    ]);

  console.log('New patterns:', patterns?.length || 0);
  patterns?.forEach(p => console.log(`  - "${p.pattern}" → ${p.document_type}`));

  // Get test cases from baseline
  const { data: baseline } = await supabase
    .from('reanalysis_test_baseline')
    .select('chronicle_id, original_document_type, original_subject, test_category')
    .order('test_category');

  console.log('\n=== Test Cases by Category ===\n');

  const byCategory = new Map<string, typeof baseline>();
  baseline?.forEach(b => {
    if (!byCategory.has(b.test_category)) {
      byCategory.set(b.test_category, []);
    }
    byCategory.get(b.test_category)!.push(b);
  });

  for (const [category, items] of byCategory) {
    console.log(`\n${category.toUpperCase()} (${items.length} emails):`);

    // Group by current classification
    const byType = new Map<string, number>();
    items.forEach(i => {
      byType.set(i.original_document_type, (byType.get(i.original_document_type) || 0) + 1);
    });

    console.log('  Current classifications:');
    for (const [type, count] of byType) {
      console.log(`    - ${type}: ${count}`);
    }

    // Check if patterns would match
    let patternMatches = 0;
    for (const item of items) {
      const subject = item.original_subject;

      // Simple pattern check
      if (category === 'form_13' && /form.?13/i.test(subject)) {
        patternMatches++;
      } else if (category === 'system_notification' && /one-time passcode/i.test(subject)) {
        patternMatches++;
      } else if (category === 'schedule_update' && /transport plan.*changed.*maersk/i.test(subject)) {
        patternMatches++;
      } else if (category === 'internal_notification' && /cma cgm.*booking confirmation available/i.test(subject)) {
        patternMatches++;
      }
    }

    console.log(`  Pattern would match: ${patternMatches}/${items.length}`);
    console.log(`  Expected type: ${category}`);
  }

  // Check if form_13 is in AI prompt enum
  console.log('\n=== AI Enum Check ===\n');

  const promptFile = await import('../lib/chronicle/prompts/freight-forwarder.prompt');
  const schema = promptFile.ANALYZE_TOOL_SCHEMA;
  const docTypeEnum = (schema.input_schema as any).properties.document_type.enum as string[];

  console.log('form_13 in enum:', docTypeEnum.includes('form_13') ? 'YES ✓' : 'NO ✗');
  console.log('Total document types in enum:', docTypeEnum.length);
}

testPatternMatching().catch(console.error);
