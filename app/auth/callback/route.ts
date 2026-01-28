import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const ALLOWED_DOMAIN = 'intoglo.com';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

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
              // Ignore errors in server component
            }
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      // Check if email is from intoglo.com domain
      const email = data.user.email || '';
      const domain = email.split('@')[1];

      if (domain !== ALLOWED_DOMAIN) {
        // Sign out the user and redirect to login with error
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `${origin}/login?error=unauthorized_domain&message=Only @intoglo.com accounts are allowed`
        );
      }

      // Authorized - redirect to next page
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // OAuth error - redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
