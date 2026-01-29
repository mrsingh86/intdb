/**
 * Authentication Module
 *
 * Server-side authentication utilities for API routes.
 * Supports both Supabase Auth (user sessions) and API keys (server-to-server).
 *
 * @example
 * import { getAuthenticatedUser, withAuth, AuthenticationError } from '@/lib/auth';
 *
 * // In API route:
 * const user = await getAuthenticatedUser(request);
 */

export {
  // Error types
  AuthenticationError,

  // Types
  type AuthenticatedUser,
  type AuthOptions,

  // Functions
  getAuthenticatedUser,
  getOptionalUser,
  withAuth,
  withOptionalAuth,
} from './server-auth';
