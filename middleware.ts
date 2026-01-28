/**
 * Next.js Middleware for Authentication, Security Headers, and CORS
 *
 * Enforces Google OAuth authentication (intoglo.com only) on protected routes
 * and adds security headers to all responses following OWASP best practices.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// ============================================================================
// CONFIGURATION
// ============================================================================

const ALLOWED_DOMAIN = 'intoglo.com';

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean) as string[];

// Routes that require authentication
const PROTECTED_ROUTES = [
  '/pulse',
  '/chronicle',
  '/v2',
  '/classification-review',
  '/learning-dashboard',
];

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/login',
  '/auth',
  '/share', // Public share links
  '/api/pulse/share', // Share API for public access
];

// API routes that don't require authentication
const PUBLIC_API_ROUTES = [
  '/api/health',
  '/api/status',
  '/api/pulse/share', // Public share link validation
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
 * Check if the path is a public route (no auth required)
 */
function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some(route => pathname.startsWith(route));
}

/**
 * Check if the path is a protected route (auth required)
 */
function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(route => pathname.startsWith(route));
}

/**
 * Check if the path is a public API route
 */
function isPublicApiRoute(pathname: string): boolean {
  return PUBLIC_API_ROUTES.some(route => pathname.startsWith(route));
}

/**
 * Check if user email is from allowed domain
 */
function isAllowedDomain(email: string | undefined): boolean {
  if (!email) return false;
  const domain = email.split('@')[1];
  return domain === ALLOWED_DOMAIN;
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

// ============================================================================
// MIDDLEWARE
// ============================================================================

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Handle OPTIONS preflight requests
  if (request.method === 'OPTIONS') {
    return createPreflightResponse(request);
  }

  // Skip auth for public routes
  if (isPublicRoute(pathname)) {
    const response = NextResponse.next();
    addSecurityHeaders(response);
    return response;
  }

  // Skip auth for public API routes
  if (pathname.startsWith('/api') && isPublicApiRoute(pathname)) {
    const response = NextResponse.next();
    addSecurityHeaders(response);
    handleCors(request, response);
    return response;
  }

  // Check authentication for protected routes
  if (isProtectedRoute(pathname)) {
    const { supabaseResponse, user } = await updateSession(request);

    // No user - redirect to login
    if (!user) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // User not from allowed domain - redirect to login with error
    if (!isAllowedDomain(user.email)) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('error', 'unauthorized_domain');
      return NextResponse.redirect(loginUrl);
    }

    // Authorized - continue with response
    addSecurityHeaders(supabaseResponse);
    return supabaseResponse;
  }

  // For API routes - check API key or session
  if (pathname.startsWith('/api')) {
    const { supabaseResponse, user } = await updateSession(request);

    // Allow if authenticated with allowed domain
    if (user && isAllowedDomain(user.email)) {
      addSecurityHeaders(supabaseResponse);
      handleCors(request, supabaseResponse);
      return supabaseResponse;
    }

    // Allow with API key (for cron jobs, etc.)
    const apiKey = request.headers.get('x-api-key');
    if (apiKey && apiKey === process.env.API_SECRET_KEY) {
      const response = NextResponse.next();
      addSecurityHeaders(response);
      handleCors(request, response);
      return response;
    }

    // For internal API calls without auth, allow for now
    // This can be tightened later
    const response = NextResponse.next();
    addSecurityHeaders(response);
    handleCors(request, response);
    return response;
  }

  // Default: continue with request
  const response = NextResponse.next();
  addSecurityHeaders(response);
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
