import { createClient } from '@supabase/supabase-js';

console.log('=== CHECKING BOTH SUPABASE PROJECTS ===\n');

// Project 1: jkvlggqkccozyouvipso
const project1 = createClient(
  'https://jkvlggqkccozyouvipso.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprdmxnZ3FrY2NvenlvdXZpcHNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzM0OTU5MSwiZXhwIjoyMDc4OTI1NTkxfQ.tPe-CS4zRZSksZa_PAIOAsMOYLiNCT7eon3crO_LgKY'
);

// Project 2: fdmcdbvkfdmrdowfjrcz
const project2 = createClient(
  'https://fdmcdbvkfdmrdowfjrcz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkbWNkYnZrZmRtcmRvd2ZqcmN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzMxMTI4NSwiZXhwIjoyMDc4ODg3Mjg1fQ.bFblX9iooMq5S2I7kMPWoQ_d8Iu-FQ9kz-vYaClvh_k'
);

(async () => {
  // Check Project 1
  console.log('Project 1: jkvlggqkccozyouvipso');
  const { count: p1_emails } = await project1
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });
  const { count: p1_classifications } = await project1
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });
  const { count: p1_entities } = await project1
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  console.log(`  Raw Emails: ${p1_emails || 0}`);
  console.log(`  Classifications: ${p1_classifications || 0}`);
  console.log(`  Entity Extractions: ${p1_entities || 0}`);

  // Check Project 2
  console.log('\nProject 2: fdmcdbvkfdmrdowfjrcz');
  const { count: p2_emails } = await project2
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });
  const { count: p2_classifications } = await project2
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });
  const { count: p2_entities } = await project2
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  console.log(`  Raw Emails: ${p2_emails || 0}`);
  console.log(`  Classifications: ${p2_classifications || 0}`);
  console.log(`  Entity Extractions: ${p2_entities || 0}`);

  console.log('\n=== SUMMARY ===');
  if ((p1_emails || 0) > 0) {
    console.log(`✓ Data found in Project 1 (jkvlggqkccozyouvipso): ${p1_emails} emails`);
  }
  if ((p2_emails || 0) > 0) {
    console.log(`✓ Data found in Project 2 (fdmcdbvkfdmrdowfjrcz): ${p2_emails} emails`);
  }
  if ((p1_emails || 0) === 0 && (p2_emails || 0) === 0) {
    console.log('⚠️  No emails found in either project!');
  }
})();
