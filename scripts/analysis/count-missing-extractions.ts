/**
 * Count emails that need entity extraction
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE = 1000;

async function fetchAllEmailIds(table: string): Promise<string[]> {
  const allIds: string[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase
      .from(table)
      .select('email_id')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (data && data.length > 0) {
      allIds.push(...data.map((d: { email_id: string }) => d.email_id));
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return allIds;
}

async function fetchAllClassifications(): Promise<Array<{ email_id: string; document_type: string }>> {
  const all: Array<{ email_id: string; document_type: string }> = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (data && data.length > 0) {
      all.push(...data);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return all;
}

async function main() {
  console.log('Counting emails that need entity extraction...\n');

  // Get emails WITH entity extractions
  const entityEmailIds = await fetchAllEmailIds('entity_extractions');
  const emailsWithEntities = new Set(entityEmailIds);
  console.log('Emails WITH entities:', emailsWithEntities.size);

  // Get all classifications
  const classifications = await fetchAllClassifications();
  console.log('Total classifications:', classifications.length);

  // Find classifications with NO entity extraction
  const needsExtraction = classifications.filter(c => !emailsWithEntities.has(c.email_id));
  console.log('Need entity extraction:', needsExtraction.length);

  // Deduplicate by email_id
  const uniqueEmailIds = [...new Set(needsExtraction.map(c => c.email_id))];
  console.log('Unique emails needing extraction:', uniqueEmailIds.length);

  // Group by doc type
  const byType: Record<string, number> = {};
  needsExtraction.forEach(c => {
    byType[c.document_type] = (byType[c.document_type] || 0) + 1;
  });

  console.log('\nBy document type:');
  console.log('-'.repeat(50));
  Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log('  ' + type.padEnd(35) + count.toString().padStart(5));
    });
}

main().catch(console.error);
