/**
 * Supabase Server Client for Next.js API Routes
 * Uses service role key for elevated permissions in server-side operations
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Creates a Supabase client for server-side operations
 * This client uses the service role key which bypasses RLS policies
 * Only use this in secure server-side contexts (API routes, server components)
 */
export function createClient() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Validate environment variables
  if (!supabaseUrl) {
    throw new Error('[Supabase Server] Missing SUPABASE_URL environment variable')
  }

  if (!supabaseServiceKey) {
    throw new Error('[Supabase Server] Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  }

  // Log configuration in development (without exposing keys)
  if (process.env.NODE_ENV === 'development') {
    console.log('[Supabase Server] Initializing with service role')
    console.log('  URL:', supabaseUrl)
    console.log('  Service Key:', supabaseServiceKey.substring(0, 20) + '...')
  }

  // Create client with service role permissions
  return createSupabaseClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

/**
 * Default export for convenience
 * Note: This creates a new instance on each import
 * For better performance in high-traffic scenarios, consider using a singleton pattern
 */
export const supabase = createClient()