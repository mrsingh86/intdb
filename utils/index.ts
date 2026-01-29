/**
 * Infrastructure Clients Module
 *
 * This folder contains external service clients and infrastructure setup.
 * These are stateful singletons for connecting to external services.
 *
 * IMPORTANT: This is different from /lib/utils/ which contains stateless
 * business logic utilities (date parsing, validation, etc.)
 *
 * @example
 * // Infrastructure clients (this folder)
 * import { createClient } from '@/utils/supabase/server';
 * import { logger } from '@/utils/logger';
 *
 * // Business utilities (/lib/utils/)
 * import { parseEntityDate, isValidContainerNumber } from '@/lib/utils';
 */

// Supabase clients
export { createClient as createServerClient } from './supabase/server';
export { createClient as createBrowserClient } from './supabase/client';

// Legacy Supabase client (for scripts)
export { SupabaseService, supabase } from './supabase-client';

// Gmail client
export { GmailClient, gmailClient } from './gmail-client';

// Logging
export { logger, LogLevel } from './logger';
