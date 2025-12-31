import { config } from 'dotenv';
config();

async function checkSchema() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              CHECKING CORRECT PROJECT                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  console.log(`Using Supabase URL: ${supabaseUrl}\n`);

  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      'apikey': apiKey
    }
  });

  const schema = await response.json();
  const paths = Object.keys(schema.paths || {});
  const tables = paths.filter(p => !p.startsWith('/rpc') && p !== '/').map(p => p.replace('/', '')).sort();

  const targetTables = ['raw_emails', 'document_classifications', 'entity_extractions', 'raw_attachments'];

  console.log('🎯 Looking for our NEW tables:');
  targetTables.forEach(table => {
    const found = tables.includes(table);
    console.log(`   ${found ? '✅' : '❌'} ${table}${found ? '' : ' - NOT FOUND'}`);
  });

  console.log(`\n📊 Total tables visible: ${tables.length}\n`);
}

checkSchema().catch(console.error);
