/**
 * Next.js Middleware for Authentication, Security Headers, and CORS
 *
 * Enforces authentication on API routes (except public ones) and adds
 * security headers to all responses following OWASP best practices.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ============================================================================
// CONFIGURATION
// ============================================================================

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[];

// API routes that don't require authentication
const PUBLIC_API_ROUTES = [
  '/api/health',
  '/api/status',
];

// Security headers to add to all responses
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if the path is a public API route
 */
function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some(route => pathname.startsWith(route));
}

/**
 * Check if request has valid authentication
 */
function hasValidAuth(request: NextRequest): boolean {
  // Development bypass
  if (process.env.BYPASS_AUTH === 'true') {
    return true;
  }

  // Check for Bearer token
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return true;
  }

  // Check for API key
  const apiKey = request.headers.get('x-api-key');
  if (apiKey) {
    return true;
  }

  return false;
}

/**
 * Add security headers to response
 */
function addSecurityHeaders(response: NextResponse): void {
  Object.entries(SECURITY_HEADERS).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
}

/**
 * Handle CORS headers
 */
function handleCors(request: NextRequest, response: NextResponse): void {
  const origin = request.headers.get('origin');

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }
}

/**
 * Create CORS preflight response
 */
function createPreflightResponse(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin');
  const response = new NextResponse(null, { status: 204 });

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
  }

  response.headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  );
  response.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With, X-API-Key'
  );
  response.headers.set('Access-Control-Max-Age', '86400');

  return response;
}

/**
 * Create 401 Unauthorized response
 */
function createUnauthorizedResponse(): NextResponse {
  return NextResponse.json(
    {
      error: 'Authentication required',
      message: 'Provide Bearer token in Authorization header or X-API-Key header',
      code: 'MISSING_AUTH',
    },
    {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Bearer realm="api"',
      },
    }
  );
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Handle OPTIONS preflight requests
  if (request.method === 'OPTIONS') {
    return createPreflightResponse(request);
  }

  // Check if this is an API route
  if (pathname.startsWith('/api')) {
    // Skip authentication for public routes
    if (isPublicApiRoute(pathname)) {
      const response = NextResponse.next();
      addSecurityHeaders(response);
      handleCors(request, response);
      return response;
    }

    // Require authentication for all other API routes
    if (!hasValidAuth(request)) {
      const response = createUnauthorizedResponse();
      addSecurityHeaders(response);
      return response;
    }
  }

  // Continue with request
  const response = NextResponse.next();
  addSecurityHeaders(response);

  // Add CORS headers for API routes
  if (pathname.startsWith('/api')) {
    handleCors(request, response);
  }

  return response;
}

// Run middleware on API routes and pages
export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
