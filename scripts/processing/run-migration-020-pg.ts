/**
 * Run Migration 020: Add Idempotency Constraints (using pg directly)
 */

import { Client } from 'pg';

// URL encode password for special characters
const PASSWORD = process.env.DB_PASSWORD || 'OMomSairam@123';
const URL_ENCODED_PASSWORD = encodeURIComponent(PASSWORD);
const connectionString = `postgresql://postgres.jkvlggqkccozyouvipso:${URL_ENCODED_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`;

async function runMigration() {
  const client = new Client({ connectionString });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected!\n');

    console.log('Running Migration 020: Add Idempotency Constraints\n');

    // Step 1: Unique constraint on notifications.email_id
    console.log('Step 1: Adding unique constraint on notifications.email_id...');
    try {
      await client.query('ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_email_id_key');
      await client.query('ALTER TABLE notifications ADD CONSTRAINT notifications_email_id_key UNIQUE (email_id)');
      console.log('  ✅ Success\n');
    } catch (err: any) {
      if (err.message.includes('already exists')) {
        console.log('  ⏭️ Constraint already exists\n');
      } else {
        console.log(`  ❌ Error: ${err.message}\n`);
      }
    }

    // Step 2: Unique constraint on stakeholder_extraction_queue.email_id
    console.log('Step 2: Adding unique constraint on stakeholder_extraction_queue.email_id...');
    try {
      await client.query('ALTER TABLE stakeholder_extraction_queue DROP CONSTRAINT IF EXISTS stakeholder_extraction_queue_email_id_key');
      await client.query('ALTER TABLE stakeholder_extraction_queue ADD CONSTRAINT stakeholder_extraction_queue_email_id_key UNIQUE (email_id)');
      console.log('  ✅ Success\n');
    } catch (err: any) {
      if (err.message.includes('already exists')) {
        console.log('  ⏭️ Constraint already exists\n');
      } else {
        console.log(`  ❌ Error: ${err.message}\n`);
      }
    }

    // Step 3: Create indexes
    console.log('Step 3: Creating performance indexes...');

    const indexes = [
      { name: 'idx_notifications_email_id', sql: 'CREATE INDEX IF NOT EXISTS idx_notifications_email_id ON notifications(email_id)' },
      { name: 'idx_stakeholder_extraction_email', sql: 'CREATE INDEX IF NOT EXISTS idx_stakeholder_extraction_email ON stakeholder_extraction_queue(email_id)' },
      { name: 'idx_doc_lifecycle_shipment_status', sql: 'CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_shipment_status ON document_lifecycle(shipment_id, lifecycle_status)' },
      { name: 'idx_notifications_overdue_critical', sql: `CREATE INDEX IF NOT EXISTS idx_notifications_overdue_critical ON notifications(deadline_date, priority) WHERE deadline_date IS NOT NULL AND status NOT IN ('actioned', 'dismissed')` },
    ];

    for (const index of indexes) {
      try {
        await client.query(index.sql);
        console.log(`  ✅ ${index.name} created`);
      } catch (err: any) {
        console.log(`  ❌ ${index.name}: ${err.message}`);
      }
    }

    // Step 4: Verify constraints exist
    console.log('\n\nStep 4: Verifying constraints...');
    const constraintResult = await client.query(`
      SELECT conname, conrelid::regclass as table_name
      FROM pg_constraint
      WHERE conname IN (
        'notifications_email_id_key',
        'stakeholder_extraction_queue_email_id_key',
        'document_lifecycle_shipment_document_unique'
      )
    `);

    console.log('\nExisting constraints:');
    for (const row of constraintResult.rows) {
      console.log(`  ✅ ${row.table_name}: ${row.conname}`);
    }

    // Step 5: Verify indexes exist
    console.log('\nVerifying indexes...');
    const indexResult = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE indexname IN (
        'idx_notifications_email_id',
        'idx_stakeholder_extraction_email',
        'idx_doc_lifecycle_shipment_status',
        'idx_notifications_overdue_critical'
      )
    `);

    console.log('\nExisting indexes:');
    for (const row of indexResult.rows) {
      console.log(`  ✅ ${row.tablename}: ${row.indexname}`);
    }

    console.log('\n✅ Migration 020 complete!');

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
