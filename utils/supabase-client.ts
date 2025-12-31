/**
 * Supabase client configuration
 * Singleton pattern for database connection
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

class SupabaseService {
  private static instance: SupabaseService;
  private client: SupabaseClient;

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration. Check your .env file.');
    }

    this.client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      },
      db: {
        schema: 'public'
      }
    });
  }

  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  public getClient(): SupabaseClient {
    return this.client;
  }

  // Helper method for idempotent inserts
  public async upsert<T extends Record<string, any>>(
    table: string,
    data: T | T[],
    options?: {
      onConflict?: string;
      ignoreDuplicates?: boolean;
    }
  ): Promise<{ data: T[] | null; error: any }> {
    const query = this.client.from(table).upsert(data, {
      onConflict: options?.onConflict,
      ignoreDuplicates: options?.ignoreDuplicates ?? true
    });

    return await query.select();
  }

  // Helper for batch operations
  public async batchInsert<T extends Record<string, any>>(
    table: string,
    data: T[],
    batchSize: number = 100
  ): Promise<{ success: number; failed: number; errors: any[] }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      const { error } = await this.client.from(table).insert(batch);

      if (error) {
        results.failed += batch.length;
        results.errors.push({ batch: i / batchSize, error });
      } else {
        results.success += batch.length;
      }
    }

    return results;
  }

  // Test connection
  public async testConnection(): Promise<boolean> {
    try {
      const { error } = await this.client
        .from('carrier_configs')
        .select('id')
        .limit(1);

      return !error;
    } catch {
      return false;
    }
  }
}

export const supabase = SupabaseService.getInstance().getClient();
export default SupabaseService;