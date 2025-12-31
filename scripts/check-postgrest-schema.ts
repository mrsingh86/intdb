/**
 * CHECK POSTGREST SCHEMA
 * List all tables PostgREST can see vs what exists in database
 */

import { supabase } from '../utils/supabase-client';

async function checkSchema() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              POSTGREST SCHEMA INVESTIGATION                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Try to fetch OpenAPI schema
  const response = await fetch('https://jkvlggqkccozyouvipso.supabase.co/rest/v1/', {
    headers: {
      'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprdmxnZ3FrY2NvenlvdXZpcHNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzM0OTU5MSwiZXhwIjoyMDc4OTI1NTkxfQ.tPe-CS4zRZSksZa_PAIOAsMOYLiNCT7eon3crO_LgKY'
    }
  });

  const schema = await response.json();
  const paths = Object.keys(schema.paths || {});

  const tables = paths
    .filter(p => !p.startsWith('/rpc') && p !== '/')
    .map(p => p.replace('/', ''))
    .sort();

  console.log('📊 Tables PostgREST CAN see:');
  console.log(`   Total: ${tables.length}\n`);

  const targetTables = ['raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments'];

  console.log('🎯 Looking for our NEW tables:');
  targetTables.forEach(table => {
    const found = tables.includes(table);
    console.log(`   ${found ? '✅' : '❌'} ${table}${found ? '' : ' - NOT FOUND'}`);
  });

  console.log('\n📋 First 20 tables PostgREST CAN see:');
  tables.slice(0, 20).forEach(table => {
    console.log(`   - ${table}`);
  });

  if (tables.length > 20) {
    console.log(`   ... and ${tables.length - 20} more`);
  }

  console.log('\n');
}

checkSchema().catch(console.error);
