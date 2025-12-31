import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/debug/emails
 *
 * Debug endpoint to list email subjects for notification analysis.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, received_at')
      .order('received_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      count: emails?.length || 0,
      emails: emails?.map(e => ({
        id: e.id,
        subject: e.subject,
        sender: e.sender_email,
        received: e.received_at
      }))
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});
