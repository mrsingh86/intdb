import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { classifyEmailParty, PartyType } from '@/lib/config/email-parties';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/documents
 *
 * Returns all documents for a shipment with email details and party classification.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id: shipmentId } = resolvedParams;
    const supabase = createClient();

    // Get all documents for this shipment
    const { data: docs, error: docsError } = await supabase
      .from('shipment_documents')
      .select('id, email_id, document_type, is_primary, linked_at')
      .eq('shipment_id', shipmentId);

    if (docsError) {
      throw docsError;
    }

    if (!docs || docs.length === 0) {
      return NextResponse.json({ documents: [] });
    }

    // Get email details for all docs
    const emailIds = Array.from(new Set(docs.map(d => d.email_id)));
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, sender_email, recipient_emails, subject, received_at')
      .in('id', emailIds);

    const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

    // Build document list with email details and party info
    const documents = docs.map(doc => {
      const email = emailMap.get(doc.email_id);

      if (!email) {
        return {
          id: doc.id,
          email_id: doc.email_id,
          document_type: doc.document_type,
          is_primary: doc.is_primary,
          sender: 'Unknown',
          sender_party: { type: 'unknown' as PartyType, name: 'Unknown', shortName: '???', color: 'bg-gray-100 text-gray-600' },
          recipients: [],
          direction: 'incoming' as const,
          received_at: null,
          subject: 'Unknown'
        };
      }

      const { party: senderParty, direction } = classifyEmailParty(email.sender_email);

      // Parse recipients and classify them
      const recipientEmails = Array.isArray(email.recipient_emails)
        ? email.recipient_emails
        : email.recipient_emails ? [email.recipient_emails] : [];

      const recipients = recipientEmails.slice(0, 3).map((r: string) => {
        const { party } = classifyEmailParty(r);
        return {
          email: r,
          party: { type: party.type, name: party.name, shortName: party.shortName }
        };
      });

      return {
        id: doc.id,
        email_id: doc.email_id,
        document_type: doc.document_type,
        is_primary: doc.is_primary,
        sender: email.sender_email,
        sender_party: {
          type: senderParty.type,
          name: senderParty.name,
          shortName: senderParty.shortName,
          color: senderParty.color
        },
        recipients,
        direction,
        received_at: email.received_at,
        subject: email.subject
      };
    });

    // Sort by received_at (oldest first)
    documents.sort((a, b) => {
      if (!a.received_at) return 1;
      if (!b.received_at) return -1;
      return new Date(a.received_at).getTime() - new Date(b.received_at).getTime();
    });

    return NextResponse.json({ documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json(
      { error: 'Failed to fetch documents' },
      { status: 500 }
    );
  }
});
