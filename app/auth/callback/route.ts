import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const ALLOWED_DOMAIN = 'intoglo.com';

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const next = requestUrl.searchParams.get('next') || '/';

  // Use the app URL from env or construct from request
  const origin = process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin;

  if (code) {
    const cookieStore = await cookies();

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Ignore - called from Server Component
            }
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const email = data.user.email || '';
      const domain = email.split('@')[1];

      // Check domain restriction
      if (domain !== ALLOWED_DOMAIN) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=unauthorized_domain`);
      }

      // Success - redirect to the app
      return NextResponse.redirect(`${origin}${next}`);
    }

    // Exchange failed
    console.error('[Auth Callback] Exchange error:', error);
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // No code provided
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
