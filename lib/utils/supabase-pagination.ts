/**
 * ============================================================================
 * SUPABASE PAGINATION UTILITIES
 * ============================================================================
 *
 * Supabase has a default 1000-row limit on queries. These utilities properly
 * handle pagination to get accurate data across entire tables.
 *
 * USAGE:
 *   import { getAllUniqueValues, getAllRows, getGroupedCounts } from '@/lib/utils/supabase-pagination';
 *
 *   // Get all unique email IDs from entity_extractions
 *   const emailIds = await getAllUniqueValues(supabase, 'entity_extractions', 'email_id');
 *
 *   // Get all shipment_documents rows
 *   const docs = await getAllRows<{ email_id: string; shipment_id: string }>(
 *     supabase, 'shipment_documents', 'email_id, shipment_id'
 *   );
 *
 *   // Get counts grouped by document_type
 *   const typeCounts = await getGroupedCounts(supabase, 'document_classifications', 'document_type');
 */

import { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_BATCH_SIZE = 1000;

/**
 * Paginate through all rows to get unique values for a single column
 */
export async function getAllUniqueValues(
  supabase: SupabaseClient,
  table: string,
  column: string,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<Set<string>> {
  const uniqueValues = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`[Pagination] Error fetching ${table}.${column}:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const value = row[column];
      if (value !== null && value !== undefined) {
        uniqueValues.add(String(value));
      }
    }

    offset += batchSize;
    if (data.length < batchSize) break;
  }

  return uniqueValues;
}

/**
 * Paginate through all rows and return them as an array
 */
export async function getAllRows<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`[Pagination] Error fetching ${table}:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allRows.push(...(data as T[]));
    offset += batchSize;
    if (data.length < batchSize) break;
  }

  return allRows;
}

/**
 * Paginate and count values by group (simulates GROUP BY + COUNT)
 */
export async function getGroupedCounts(
  supabase: SupabaseClient,
  table: string,
  column: string,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`[Pagination] Error fetching ${table}.${column}:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    for (const row of data) {
      const value = row[column] !== null && row[column] !== undefined
        ? String(row[column])
        : 'null';
      counts[value] = (counts[value] || 0) + 1;
    }

    offset += batchSize;
    if (data.length < batchSize) break;
  }

  return counts;
}

/**
 * Get total count using paginated count (for tables without count permission)
 */
export async function getTotalCount(
  supabase: SupabaseClient,
  table: string
): Promise<number> {
  // First try the efficient count method
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (!error && count !== null) {
    return count;
  }

  // Fallback to pagination if count fails
  let total = 0;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .range(offset, offset + DEFAULT_BATCH_SIZE - 1);

    if (error || !data || data.length === 0) break;

    total += data.length;
    offset += DEFAULT_BATCH_SIZE;
    if (data.length < DEFAULT_BATCH_SIZE) break;
  }

  return total;
}

/**
 * Paginate with a filter condition
 */
export async function getAllRowsWithFilter<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  filterColumn: string,
  filterValue: string | boolean | number,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq(filterColumn, filterValue)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`[Pagination] Error fetching ${table} with filter:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allRows.push(...(data as T[]));
    offset += batchSize;
    if (data.length < batchSize) break;
  }

  return allRows;
}

/**
 * Paginate with multiple IDs (for IN queries)
 * Handles Supabase's limit on IN clause size
 */
export async function getRowsByIds<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  idColumn: string,
  ids: string[],
  inClauseBatchSize: number = 100
): Promise<T[]> {
  const allRows: T[] = [];

  // Process IDs in batches to avoid IN clause limits
  for (let i = 0; i < ids.length; i += inClauseBatchSize) {
    const batchIds = ids.slice(i, i + inClauseBatchSize);

    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in(idColumn, batchIds);

    if (error) {
      console.error(`[Pagination] Error fetching ${table} by IDs:`, error.message);
      continue;
    }

    if (data) {
      allRows.push(...(data as T[]));
    }
  }

  return allRows;
}
