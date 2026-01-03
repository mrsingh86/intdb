/**
 * Supabase Query Utility
 *
 * Handles pagination automatically for large result sets.
 * Usage: npx tsx scripts/utils/supabase-query.ts <table> [select] [filters]
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Fetch ALL rows from a table with automatic pagination
 * Supabase default limit is 1000 - this fetches all pages
 */
export async function fetchAll<T = any>(
  table: string,
  select: string = '*',
  filters?: Record<string, any>,
  orderBy?: { column: string; ascending?: boolean }
): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allData: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from(table)
      .select(select)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    // Apply filters
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      }
    }

    // Apply ordering
    if (orderBy) {
      query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    if (data && data.length > 0) {
      allData = allData.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

/**
 * Get count of rows in a table
 */
export async function getCount(
  table: string,
  filters?: Record<string, any>
): Promise<number> {
  let query = supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        query = query.eq(key, value);
      }
    }
  }

  const { count, error } = await query;

  if (error) {
    throw new Error(`Supabase error: ${error.message}`);
  }

  return count || 0;
}

/**
 * Execute a raw SQL query via RPC
 */
export async function rawQuery<T = any>(sql: string): Promise<T[]> {
  const { data, error } = await supabase.rpc('exec_sql', { query: sql });

  if (error) {
    throw new Error(`SQL error: ${error.message}`);
  }

  return data as T[];
}

// CLI usage
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx tsx scripts/utils/supabase-query.ts <table> [select] [--count]');
    console.log('');
    console.log('Examples:');
    console.log('  npx tsx scripts/utils/supabase-query.ts raw_emails --count');
    console.log('  npx tsx scripts/utils/supabase-query.ts raw_emails "id,subject,sender_email"');
    console.log('  npx tsx scripts/utils/supabase-query.ts shipment_documents "document_type"');
    process.exit(0);
  }

  const table = args[0];
  const isCount = args.includes('--count');
  const select = args[1] && !args[1].startsWith('--') ? args[1] : '*';

  (async () => {
    try {
      if (isCount) {
        const count = await getCount(table);
        console.log(`${table}: ${count} rows`);
      } else {
        console.log(`Fetching all rows from ${table}...`);
        const data = await fetchAll(table, select);
        console.log(`Fetched ${data.length} rows`);

        // Output as JSON
        const outputFile = `/tmp/${table}_all.json`;
        require('fs').writeFileSync(outputFile, JSON.stringify(data, null, 2));
        console.log(`Saved to ${outputFile}`);
      }
    } catch (err) {
      console.error('Error:', err);
      process.exit(1);
    }
  })();
}
