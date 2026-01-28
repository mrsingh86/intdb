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
  console.log('[Dossier Search API] Request received');
  try {
    const body = await request.json();
    console.log('[Dossier Search API] Body:', body);
    const { bookingNumber, keyword } = body;

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
        from_address,
        from_party,
        body_preview,
        snippet,
        summary,
        occurred_at,
        document_type,
        attachments
      `)
      .eq('booking_number', bookingNumber)
      .order('occurred_at', { ascending: false });

    if (error) {
      console.error('[Dossier Search API] Query error:', error);
      return NextResponse.json(
        { success: false, error: 'Search failed', details: error.message },
        { status: 500 }
      );
    }

    console.log('[Dossier Search API] Found', emails?.length || 0, 'emails for booking', bookingNumber);

    // Filter and score results
    const results: SearchResult[] = [];

    for (const email of emails || []) {
      const subject = (email.subject || '').toLowerCase();
      const sender = (email.from_party || email.from_address || '').toLowerCase();
      const bodyPreview = (email.body_preview || '').toLowerCase();
      const summary = (email.summary || '').toLowerCase();
      const docType = (email.document_type || '').toLowerCase().replace(/_/g, ' ');

      // Check if keyword matches in any field
      const subjectMatch = subject.includes(searchTerm);
      const senderMatch = sender.includes(searchTerm);
      const bodyMatch = bodyPreview.includes(searchTerm);
      const summaryMatch = summary.includes(searchTerm);
      const docTypeMatch = docType.includes(searchTerm);

      if (subjectMatch || senderMatch || bodyMatch || summaryMatch || docTypeMatch) {
        // Extract snippet around the match
        let matchedText = '';
        let snippetText = '';

        if (bodyMatch) {
          const idx = bodyPreview.indexOf(searchTerm);
          const start = Math.max(0, idx - 50);
          const end = Math.min(bodyPreview.length, idx + searchTerm.length + 100);
          snippetText = (email.body_preview || '').substring(start, end);
          if (start > 0) snippetText = '...' + snippetText;
          if (end < bodyPreview.length) snippetText = snippetText + '...';
          matchedText = 'body';
        } else if (summaryMatch) {
          snippetText = email.summary || '';
          matchedText = 'summary';
        } else if (subjectMatch) {
          snippetText = email.subject || '';
          matchedText = 'subject';
        } else if (senderMatch) {
          snippetText = `From: ${email.from_party || email.from_address}`;
          matchedText = 'sender';
        } else if (docTypeMatch) {
          snippetText = `Document type: ${email.document_type?.replace(/_/g, ' ')}`;
          matchedText = 'document type';
        }

        const hasAttachment = email.attachments && Array.isArray(email.attachments) && email.attachments.length > 0;

        results.push({
          id: email.id,
          type: hasAttachment ? 'document' : 'email',
          subject: email.subject || '(No subject)',
          sender: email.from_party || email.from_address || 'Unknown',
          date: email.occurred_at,
          snippet: snippetText,
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
