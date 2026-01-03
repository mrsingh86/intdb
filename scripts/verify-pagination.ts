import { createClient } from '@supabase/supabase-js';
import { getAllRows, getTotalCount } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
  console.log('=== PAGINATION VERIFICATION ===\n');
  
  // Verify each table
  const tables = ['shipments', 'shipment_documents', 'raw_emails', 'document_classifications'];
  
  for (const table of tables) {
    const count = await getTotalCount(supabase, table);
    const rows = await getAllRows(supabase, table, 'id');
    console.log(table + ':');
    console.log('  DB count:', count);
    console.log('  Fetched:', rows.length);
    console.log('  Match:', count === rows.length ? 'YES' : 'NO - PAGINATION ISSUE!');
    console.log('');
  }
}

verify();
