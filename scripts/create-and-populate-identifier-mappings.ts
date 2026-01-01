/**
 * Create identifier_mappings table and populate from entity_extractions
 *
 * Logic: If an email has both booking_number AND container/BL/MBL/HBL,
 * those identifiers are related and should be mapped.
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function createTable() {
  console.log('1. Creating identifier_mappings table...');

  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      CREATE TABLE IF NOT EXISTS identifier_mappings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        booking_number VARCHAR(50),
        container_number VARCHAR(20),
        bl_number VARCHAR(50),
        mbl_number VARCHAR(50),
        hbl_number VARCHAR(50),
        source VARCHAR(30) NOT NULL,
        source_email_id UUID,
        confidence_score INTEGER DEFAULT 80,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_identifier_mappings_booking ON identifier_mappings(booking_number);
      CREATE INDEX IF NOT EXISTS idx_identifier_mappings_container ON identifier_mappings(container_number);
      CREATE INDEX IF NOT EXISTS idx_identifier_mappings_bl ON identifier_mappings(bl_number);
      CREATE INDEX IF NOT EXISTS idx_identifier_mappings_mbl ON identifier_mappings(mbl_number);
      CREATE INDEX IF NOT EXISTS idx_identifier_mappings_hbl ON identifier_mappings(hbl_number);
    `
  });

  if (error) {
    // Try direct table creation
    console.log('   RPC not available, checking if table exists...');
    const { error: checkError } = await supabase
      .from('identifier_mappings')
      .select('id')
      .limit(1);

    if (checkError && checkError.code === '42P01') {
      console.log('   Table does not exist. Please run the migration SQL manually.');
      console.log('   File: supabase/migrations/20250102_create_identifier_mappings.sql');
      return false;
    } else if (checkError) {
      console.log('   Error:', checkError.message);
      return false;
    } else {
      console.log('   Table already exists ✓');
      return true;
    }
  }

  console.log('   Table created ✓');
  return true;
}

// Pagination helper
async function fetchAll<T>(
  table: string,
  select: string,
  filter?: { column: string; value: any }
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + 999);
    if (filter) query = query.eq(filter.column, filter.value);
    const { data } = await query;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    offset += 1000;
    if (data.length < 1000) break;
  }
  return all;
}

async function populateMappings() {
  console.log('\n2. Fetching entity extractions...');

  // Get all extractions grouped by email
  const extractions = await fetchAll<{
    email_id: string;
    entity_type: string;
    entity_value: string;
  }>('entity_extractions', 'email_id, entity_type, entity_value');

  console.log(`   Total extractions: ${extractions.length}`);

  // Group by email_id
  const byEmail = new Map<string, Map<string, string>>();
  for (const e of extractions) {
    if (!byEmail.has(e.email_id)) {
      byEmail.set(e.email_id, new Map());
    }
    // Only keep first value per type per email
    if (!byEmail.get(e.email_id)!.has(e.entity_type)) {
      byEmail.get(e.email_id)!.set(e.entity_type, e.entity_value);
    }
  }

  console.log(`   Unique emails: ${byEmail.size}`);

  // Build mappings - only for emails that have booking + at least one other identifier
  console.log('\n3. Building identifier mappings...');

  const mappings: {
    booking_number: string;
    container_number: string | null;
    bl_number: string | null;
    mbl_number: string | null;
    hbl_number: string | null;
    source: string;
    source_email_id: string;
    confidence_score: number;
  }[] = [];

  const seenMappings = new Set<string>();

  for (const [emailId, entities] of byEmail) {
    const booking = entities.get('booking_number');
    if (!booking) continue;

    const container = entities.get('container_number') || null;
    const bl = entities.get('bl_number') || null;
    const mbl = entities.get('mbl_number') || null;
    const hbl = entities.get('hbl_number') || null;

    // Skip if no secondary identifiers
    if (!container && !bl && !mbl && !hbl) continue;

    // Create unique key to avoid duplicates
    const key = `${booking}|${container || ''}|${bl || ''}|${mbl || ''}|${hbl || ''}`;
    if (seenMappings.has(key)) continue;
    seenMappings.add(key);

    mappings.push({
      booking_number: booking,
      container_number: container,
      bl_number: bl,
      mbl_number: mbl,
      hbl_number: hbl,
      source: 'email_extraction',
      source_email_id: emailId,
      confidence_score: 85,
    });
  }

  console.log(`   Mappings to insert: ${mappings.length}`);

  // Insert mappings
  if (mappings.length > 0) {
    console.log('\n4. Inserting mappings...');

    let inserted = 0;
    let errors = 0;
    const batchSize = 50;

    for (let i = 0; i < mappings.length; i += batchSize) {
      const batch = mappings.slice(i, i + batchSize);

      const { error } = await supabase
        .from('identifier_mappings')
        .insert(batch);

      if (error) {
        errors++;
        if (errors <= 3) {
          console.log(`   Error: ${error.message}`);
        }
      } else {
        inserted += batch.length;
      }

      if ((i + batchSize) % 200 === 0) {
        console.log(`   Inserted ${inserted} / ${mappings.length}`);
      }
    }

    console.log(`\n   Total inserted: ${inserted}`);
    if (errors > 0) console.log(`   Batches with errors: ${errors}`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('MAPPING SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const { count: totalMappings } = await supabase
    .from('identifier_mappings')
    .select('*', { count: 'exact', head: true });

  console.log(`\n   Total mappings in table: ${totalMappings}`);

  // Count by identifier type
  const { data: sample } = await supabase
    .from('identifier_mappings')
    .select('booking_number, container_number, bl_number, mbl_number, hbl_number')
    .limit(1000);

  let withContainer = 0, withBl = 0, withMbl = 0, withHbl = 0;
  for (const m of sample || []) {
    if (m.container_number) withContainer++;
    if (m.bl_number) withBl++;
    if (m.mbl_number) withMbl++;
    if (m.hbl_number) withHbl++;
  }

  console.log(`\n   Mappings with container: ${withContainer}`);
  console.log(`   Mappings with BL: ${withBl}`);
  console.log(`   Mappings with MBL: ${withMbl}`);
  console.log(`   Mappings with HBL: ${withHbl}`);

  // Show sample
  console.log('\n   Sample mappings:');
  for (const m of (sample || []).slice(0, 5)) {
    console.log(`   - ${m.booking_number} → container:${m.container_number || 'N/A'}, bl:${m.bl_number || 'N/A'}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('CREATE AND POPULATE IDENTIFIER MAPPINGS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Check if table exists
  const { error: checkError } = await supabase
    .from('identifier_mappings')
    .select('id')
    .limit(1);

  if (checkError && checkError.code === '42P01') {
    console.log('\n⚠️  Table does not exist. Creating via SQL...\n');

    // Create table using raw SQL via REST API
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY!,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          sql: `
            CREATE TABLE IF NOT EXISTS identifier_mappings (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              booking_number VARCHAR(50),
              container_number VARCHAR(20),
              bl_number VARCHAR(50),
              mbl_number VARCHAR(50),
              hbl_number VARCHAR(50),
              source VARCHAR(30) NOT NULL,
              source_email_id UUID,
              confidence_score INTEGER DEFAULT 80,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
          `
        })
      }
    );

    if (!response.ok) {
      console.log('   Cannot create table via API. Please run this SQL in Supabase dashboard:\n');
      console.log(`
CREATE TABLE identifier_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_number VARCHAR(50),
  container_number VARCHAR(20),
  bl_number VARCHAR(50),
  mbl_number VARCHAR(50),
  hbl_number VARCHAR(50),
  source VARCHAR(30) NOT NULL,
  source_email_id UUID,
  confidence_score INTEGER DEFAULT 80,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_identifier_mappings_booking ON identifier_mappings(booking_number);
CREATE INDEX idx_identifier_mappings_container ON identifier_mappings(container_number);
CREATE INDEX idx_identifier_mappings_bl ON identifier_mappings(bl_number);
CREATE INDEX idx_identifier_mappings_mbl ON identifier_mappings(mbl_number);
CREATE INDEX idx_identifier_mappings_hbl ON identifier_mappings(hbl_number);
      `);
      return;
    }
  } else {
    console.log('\n   Table exists ✓');
  }

  await populateMappings();
}

main().catch(console.error);
