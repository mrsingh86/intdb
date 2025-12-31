// Simple Supabase connection test
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

console.log('🔍 Testing Supabase Connection...\n');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

console.log('URL:', url);
console.log('Key:', key ? `${key.substring(0, 20)}...` : 'NOT SET');
console.log('');

if (!url || !key) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function test() {
  try {
    console.log('📡 Attempting connection...');

    const { data, error } = await supabase
      .from('carrier_configs')
      .select("*").from("raw_emails").limit(0)
      .limit(3);

    if (error) {
      console.error('❌ Query error:', error.message);
      console.error('Details:', error);
      process.exit(1);
    }

    console.log('✅ Connection successful!');
    console.log('\n📊 Sample data from carrier_configs:');
    console.log(JSON.stringify(data, null, 2));

  } catch (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('Full error:', err);
    process.exit(1);
  }
}

test();
