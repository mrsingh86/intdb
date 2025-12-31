/**
 * Server-side Authentication Utility
 *
 * Provides authentication for API routes supporting:
 * 1. Supabase Auth (cookie-based user sessions)
 * 2. API Key authentication (for server-to-server, cron jobs)
 *
 * Usage:
 *   const user = await getAuthenticatedUser(request);
 *   // Returns user object or throws AuthenticationError
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

// ============================================================================
// ERROR TYPES
// ============================================================================

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: 'MISSING_AUTH' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'INVALID_API_KEY'
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }

  toJSON() {
    return {
      error: 'Authentication required',
      message: this.message,
      code: this.code,
    };
  }
}

// ============================================================================
// TYPES
// ============================================================================

export interface AuthenticatedUser {
  id: string;
  email?: string;
  role: 'user' | 'admin' | 'service';
  source: 'supabase' | 'api_key';
}

export interface AuthOptions {
  /** Allow API key authentication (default: true for backwards compatibility) */
  allowApiKey?: boolean;
  /** Require specific roles */
  requiredRoles?: ('user' | 'admin' | 'service')[];
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Extract API key from X-API-Key header
 */
function extractApiKey(request: NextRequest): string | null {
  return request.headers.get('x-api-key');
}

/**
 * Validate API key against environment variable
 */
function validateApiKey(apiKey: string): AuthenticatedUser | null {
  const validApiKey = process.env.INTERNAL_API_KEY;

  if (!validApiKey) {
    console.warn('[Auth] INTERNAL_API_KEY not configured');
    return null;
  }

  if (apiKey === validApiKey) {
    return {
      id: 'service-account',
      role: 'service',
      source: 'api_key',
    };
  }

  return null;
}

/**
 * Validate Supabase JWT token
 */
async function validateSupabaseToken(token: string): Promise<AuthenticatedUser | null> {
  const supabase = createClient();

  // Verify the JWT token
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    role: user.user_metadata?.role || 'user',
    source: 'supabase',
  };
}

/**
 * Get authenticated user from request
 *
 * @throws AuthenticationError if authentication fails
 */
export async function getAuthenticatedUser(
  request: NextRequest,
  options: AuthOptions = {}
): Promise<AuthenticatedUser> {
  const { allowApiKey = true, requiredRoles } = options;

  // Development bypass - allow unauthenticated access when BYPASS_AUTH is set
  const bypassAuth = process.env.BYPASS_AUTH;
  console.log('[Auth] BYPASS_AUTH:', bypassAuth);
  if (bypassAuth === 'true') {
    console.log('[Auth] Bypassing authentication for development');
    return {
      id: 'dev-user',
      email: 'dev@localhost',
      role: 'admin',
      source: 'api_key',
    };
  }

  // Try API key first (for service accounts, cron jobs)
  if (allowApiKey) {
    const apiKey = extractApiKey(request);
    if (apiKey) {
      const serviceUser = validateApiKey(apiKey);
      if (serviceUser) {
        return serviceUser;
      }
      throw new AuthenticationError('Invalid API key', 'INVALID_API_KEY');
    }
  }

  // Try Bearer token (Supabase Auth)
  const token = extractBearerToken(request);
  if (token) {
    const user = await validateSupabaseToken(token);
    if (user) {
      // Check required roles
      if (requiredRoles && !requiredRoles.includes(user.role)) {
        throw new AuthenticationError(
          `Insufficient permissions. Required: ${requiredRoles.join(', ')}`,
          'INVALID_TOKEN'
        );
      }
      return user;
    }
    throw new AuthenticationError('Invalid or expired token', 'INVALID_TOKEN');
  }

  throw new AuthenticationError(
    'Authentication required. Provide Bearer token or X-API-Key header.',
    'MISSING_AUTH'
  );
}

/**
 * Optional authentication - returns null if not authenticated
 */
export async function getOptionalUser(
  request: NextRequest,
  options: AuthOptions = {}
): Promise<AuthenticatedUser | null> {
  try {
    return await getAuthenticatedUser(request, options);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return null;
    }
    throw error;
  }
}

// ============================================================================
// MIDDLEWARE WRAPPER
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteContext = { params?: any; user: AuthenticatedUser };

type ApiHandler = (
  request: NextRequest,
  context: RouteContext
) => Promise<NextResponse> | NextResponse;

/**
 * Wrap an API route handler with authentication
 *
 * Usage:
 *   export const GET = withAuth(async (request, { user }) => {
 *     // user is guaranteed to be authenticated
 *     return NextResponse.json({ userId: user.id });
 *   });
 */
export function withAuth(handler: ApiHandler, options: AuthOptions = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (request: NextRequest, context?: any): Promise<NextResponse> => {
    try {
      const user = await getAuthenticatedUser(request, options);
      return await handler(request, { ...context, user });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return NextResponse.json(error.toJSON(), { status: 401 });
      }
      console.error('[Auth] Unexpected error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OptionalRouteContext = { params?: any; user: AuthenticatedUser | null };

/**
 * Wrap handler - auth optional, user passed as null if not authenticated
 */
export function withOptionalAuth(
  handler: (
    request: NextRequest,
    context: OptionalRouteContext
  ) => Promise<NextResponse> | NextResponse,
  options: AuthOptions = {}
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (request: NextRequest, context?: any): Promise<NextResponse> => {
    try {
      const user = await getOptionalUser(request, options);
      return await handler(request, { ...context, user });
    } catch (error) {
      console.error('[Auth] Unexpected error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}
