// Check raw_emails schema
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function checkSchema() {
  // Query information_schema to get column details
  const { data, error } = await supabase.rpc('execute_sql', {
    query: `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'raw_emails'
      ORDER BY ordinal_position;
    `
  });

  if (error) {
    console.log('Trying alternative method...');
    // Just try to select from the table
    const { data: tableData, error: tableError } = await supabase
      .from('raw_emails')
      .select('*')
      .limit(1);

    if (tableError) {
      console.error('Error:', tableError);
    } else {
      console.log('Sample record structure:');
      if (tableData && tableData.length > 0) {
        console.log(Object.keys(tableData[0]));
      } else {
        console.log('Table is empty, cannot determine columns');
      }
    }
  } else {
    console.log('raw_emails columns:');
    data.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
    });
  }
}

checkSchema();
