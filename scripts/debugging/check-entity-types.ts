import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkEntityTypes() {
  const { data } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value')
    .limit(200);

  const types = [...new Set(data?.map(e => e.entity_type) || [])];
  console.log('Available entity types:\n');
  console.log(types.sort().join('\n'));

  console.log('\n\nSample entities by type:\n');
  types.sort().forEach(type => {
    const samples = data?.filter(e => e.entity_type === type).slice(0, 2) || [];
    console.log(`${type}:`);
    samples.forEach(s => console.log(`  - ${s.entity_value}`));
  });
}

checkEntityTypes();
