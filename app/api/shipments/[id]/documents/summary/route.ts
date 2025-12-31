import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { classifyEmailParty } from '@/lib/config/email-parties';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/documents/summary
 *
 * Returns document summary for a shipment:
 * - Total count
 * - Latest document with party classification
 * - Count by document type
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
      .select('id, email_id, document_type, is_primary')
      .eq('shipment_id', shipmentId);

    if (docsError) {
      throw docsError;
    }

    if (!docs || docs.length === 0) {
      return NextResponse.json({
        total_count: 0,
        latest_document: null,
        by_type: {
          booking_confirmation: 0,
          booking_amendment: 0,
          bill_of_lading: 0,
          shipping_instruction: 0,
          invoice: 0,
          other: 0
        }
      });
    }

    // Get email details for all docs
    const emailIds = [...new Set(docs.map(d => d.email_id))];
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, sender_email, subject, received_at')
      .in('id', emailIds);

    const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

    // Find latest document by received_at
    let latestDoc = null;
    let latestTime = 0;

    for (const doc of docs) {
      const email = emailMap.get(doc.email_id);
      if (email) {
        const time = new Date(email.received_at).getTime();
        if (time > latestTime) {
          latestTime = time;
          latestDoc = { doc, email };
        }
      }
    }

    // Count by type
    const byType = {
      booking_confirmation: 0,
      booking_amendment: 0,
      bill_of_lading: 0,
      shipping_instruction: 0,
      invoice: 0,
      other: 0
    };

    for (const doc of docs) {
      const type = doc.document_type as keyof typeof byType;
      if (type in byType) {
        byType[type]++;
      } else {
        byType.other++;
      }
    }

    // Build latest document info with party classification
    let latestDocInfo = null;
    if (latestDoc) {
      const { party, direction } = classifyEmailParty(latestDoc.email.sender_email);
      latestDocInfo = {
        type: latestDoc.doc.document_type,
        direction,
        party: {
          type: party.type,
          name: party.name,
          shortName: party.shortName,
          color: party.color
        },
        sender: latestDoc.email.sender_email,
        received_at: latestDoc.email.received_at,
        subject: latestDoc.email.subject
      };
    }

    return NextResponse.json({
      total_count: docs.length,
      latest_document: latestDocInfo,
      by_type: byType
    });
  } catch (error) {
    console.error('Error fetching document summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch document summary' },
      { status: 500 }
    );
  }
});
