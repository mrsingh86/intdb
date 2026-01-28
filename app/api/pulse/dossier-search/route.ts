/**
 * Pulse Dossier Search API - Deep search within a shipment
 *
 * Searches full email bodies and document content for a booking
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SearchResult {
  id: string;
  type: 'email' | 'document';
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  matchedText: string;
  gmailLink?: string;
  emailViewUrl?: string;
  documentType?: string;
}

export async function POST(request: NextRequest) {
  try {
    const { bookingNumber, keyword } = await request.json();

    if (!bookingNumber || !keyword) {
      return NextResponse.json(
        { success: false, error: 'Booking number and keyword required' },
        { status: 400 }
      );
    }

    const searchTerm = keyword.trim().toLowerCase();
    if (searchTerm.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Search term too short' },
        { status: 400 }
      );
    }

    // Search in chronicle table for this booking
    const { data: emails, error } = await supabase
      .from('chronicle')
      .select(`
        id,
        gmail_message_id,
        subject,
        sender_email,
        sender_name,
        body_text,
        body_html,
        occurred_at,
        document_type,
        has_attachment
      `)
      .eq('booking_number', bookingNumber)
      .order('occurred_at', { ascending: false });

    if (error) {
      console.error('[Dossier Search] Query error:', error);
      return NextResponse.json(
        { success: false, error: 'Search failed' },
        { status: 500 }
      );
    }

    // Filter and score results
    const results: SearchResult[] = [];

    for (const email of emails || []) {
      const subject = (email.subject || '').toLowerCase();
      const sender = (email.sender_name || email.sender_email || '').toLowerCase();
      const bodyText = (email.body_text || '').toLowerCase();

      // Check if keyword matches
      const subjectMatch = subject.includes(searchTerm);
      const senderMatch = sender.includes(searchTerm);
      const bodyMatch = bodyText.includes(searchTerm);

      if (subjectMatch || senderMatch || bodyMatch) {
        // Extract snippet around the match
        let matchedText = '';
        let snippet = '';

        if (bodyMatch) {
          const idx = bodyText.indexOf(searchTerm);
          const start = Math.max(0, idx - 50);
          const end = Math.min(bodyText.length, idx + searchTerm.length + 100);
          snippet = (email.body_text || '').substring(start, end);
          if (start > 0) snippet = '...' + snippet;
          if (end < bodyText.length) snippet = snippet + '...';
          matchedText = 'body';
        } else if (subjectMatch) {
          snippet = email.subject || '';
          matchedText = 'subject';
        } else if (senderMatch) {
          snippet = `From: ${email.sender_name || email.sender_email}`;
          matchedText = 'sender';
        }

        results.push({
          id: email.id,
          type: email.has_attachment ? 'document' : 'email',
          subject: email.subject || '(No subject)',
          sender: email.sender_name || email.sender_email || 'Unknown',
          date: email.occurred_at,
          snippet,
          matchedText,
          gmailLink: email.gmail_message_id ? `https://mail.google.com/mail/u/0/#inbox/${email.gmail_message_id}` : undefined,
          emailViewUrl: `/api/chronicle-v2/email-view/${email.id}`,
          documentType: email.document_type,
        });
      }
    }

    return NextResponse.json({
      success: true,
      keyword: searchTerm,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error('[Dossier Search] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Search failed' },
      { status: 500 }
    );
  }
}
