/**
 * Supabase Client for Next.js App Router
 * Re-exports the existing Supabase client for UI components
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Use NEXT_PUBLIC_ prefixed variables for client-side access
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY!

// Log configuration in development for debugging
if (process.env.NODE_ENV === 'development') {
  console.log('[Supabase Client] Initializing with:')
  console.log('  URL:', supabaseUrl)
  console.log('  Key:', supabaseKey?.substring(0, 20) + '...')
}

export function createClient() {
  if (!supabaseUrl || !supabaseKey) {
    console.error('[Supabase Client] Missing environment variables!')
    console.error('  NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl)
    console.error('  NEXT_PUBLIC_SUPABASE_KEY:', !!supabaseKey)
  }

  return createSupabaseClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

// Default export for convenience
export const supabase = createClient()
