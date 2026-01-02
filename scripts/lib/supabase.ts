/**
 * Shared Supabase client and pagination helpers for scripts
 *
 * Usage:
 *   import { supabase, fetchAll, fetchAllWithFilter } from './lib/supabase';
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

// Singleton Supabase client
export const supabase: SupabaseClient = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Default page size for pagination
export const PAGE_SIZE = 1000;

/**
 * Fetch all rows from a table with automatic pagination
 * Handles Supabase's 1000 row limit
 */
export async function fetchAll<T>(
  table: string,
  select: string,
  filter?: { column: string; op: 'eq' | 'ilike' | 'in' | 'neq'; value: unknown }
): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.from(table).select(select).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filter) {
      switch (filter.op) {
        case 'eq':
          query = query.eq(filter.column, filter.value);
          break;
        case 'ilike':
          query = query.ilike(filter.column, filter.value as string);
          break;
        case 'neq':
          query = query.neq(filter.column, filter.value);
          break;
        case 'in':
          query = query.in(filter.column, filter.value as unknown[]);
          break;
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error(`Error fetching from ${table}:`, error.message);
      throw error;
    }

    if (data && data.length > 0) {
      all = all.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }

  return all;
}

/**
 * Fetch rows using .in() with automatic batching
 * Handles Supabase's URL length limits for large .in() arrays
 */
export async function fetchByIds<T>(
  table: string,
  select: string,
  idColumn: string,
  ids: string[],
  batchSize: number = 100
): Promise<T[]> {
  const results: T[] = [];

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const { data, error } = await supabase.from(table).select(select).in(idColumn, batch);

    if (error) {
      console.error(`Error fetching from ${table}:`, error.message);
      throw error;
    }

    if (data) {
      results.push(...(data as T[]));
    }
  }

  return results;
}

/**
 * Check if sender is from Intoglo (outbound email)
 */
export function isIntoglo(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return e.includes('@intoglo.com') || e.includes('@intoglo.in');
}

/**
 * Check if sender is a major shipping carrier
 */
export function isCarrier(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  return (
    e.includes('maersk') ||
    e.includes('hlag') ||
    e.includes('cma-cgm') ||
    e.includes('hapag') ||
    e.includes('cosco') ||
    e.includes('evergreen') ||
    e.includes('one-line') ||
    e.includes('yangming') ||
    e.includes('msc.com') ||
    e.includes('oocl') ||
    e.includes('zim') ||
    e.includes('odex') ||
    e.includes('inttra') ||
    e.includes('cargowise')
  );
}
