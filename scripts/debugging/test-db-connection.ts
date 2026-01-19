/**
 * TEST DATABASE CONNECTION
 * Try different connection string formats
 */

import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const PASSWORD = process.env.DATABASE_PASSWORD || 'OMomSairam@123';
const URL_ENCODED_PASSWORD = encodeURIComponent(PASSWORD);

const connectionStrings = [
  {
    name: 'Pooler (Session Mode) - URL Encoded',
    url: `postgresql://postgres.jkvlggqkccozyouvipso:${URL_ENCODED_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:6543/postgres`
  },
  {
    name: 'Pooler (Transaction Mode) - URL Encoded',
    url: `postgresql://postgres.jkvlggqkccozyouvipso:${URL_ENCODED_PASSWORD}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`
  },
  {
    name: 'Direct Connection - URL Encoded',
    url: `postgresql://postgres:${URL_ENCODED_PASSWORD}@db.jkvlggqkccozyouvipso.supabase.co:5432/postgres`
  }
];

async function testConnection(name: string, connectionString: string) {
  const client = new Client({ connectionString });

  try {
    console.log(`\n🔍 Testing: ${name}`);
    await client.connect();
    console.log('   ✅ Connected!');

    // Test query
    const result = await client.query('SELECT COUNT(*) FROM raw_emails');
    console.log(`   ✅ Query successful: ${result.rows[0].count} emails found`);

    await client.end();
    return true;
  } catch (error: any) {
    console.log(`   ❌ Failed: ${error.message}`);
    try {
      await client.end();
    } catch {}
    return false;
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              TESTING DATABASE CONNECTIONS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  for (const conn of connectionStrings) {
    const success = await testConnection(conn.name, conn.url);
    if (success) {
      console.log(`\n✅ WORKING CONNECTION STRING:\n${conn.url.replace(PASSWORD, '****')}\n`);
      break;
    }
  }
}

main().catch(console.error);
