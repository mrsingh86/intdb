import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  type DocumentDetail,
  type DocumentDetailResponse,
  type ExtractedField,
  getDocumentTypeLabel,
  PARTY_TYPE_LABELS,
} from '@/lib/chronicle-v2';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET /api/chronicle-v2/documents/[id]
 *
 * Fetches detailed document/email content with extracted fields.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Fetch the document
    const { data: doc, error: docError } = await supabase
      .from('chronicle')
      .select('*')
      .eq('id', id)
      .single();

    if (docError || !doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    // Get previous and next documents in the same shipment
    let previousDocId: string | null = null;
    let nextDocId: string | null = null;

    if (doc.shipment_id) {
      // Get documents for this shipment, ordered by date
      const { data: siblings } = await supabase
        .from('chronicle')
        .select('id, occurred_at')
        .eq('shipment_id', doc.shipment_id)
        .order('occurred_at', { ascending: false });

      if (siblings) {
        const currentIndex = siblings.findIndex((s) => s.id === id);
        if (currentIndex > 0) {
          previousDocId = siblings[currentIndex - 1].id;
        }
        if (currentIndex < siblings.length - 1) {
          nextDocId = siblings[currentIndex + 1].id;
        }
      }
    }

    // Build extracted fields from various columns
    const extractedFields: ExtractedField[] = [];

    // Identifiers
    if (doc.booking_number) {
      extractedFields.push({
        key: 'booking_number',
        label: 'Booking Number',
        value: doc.booking_number,
        category: 'identifier',
      });
    }
    if (doc.mbl_number) {
      extractedFields.push({
        key: 'mbl_number',
        label: 'MBL Number',
        value: doc.mbl_number,
        category: 'identifier',
      });
    }
    if (doc.hbl_number) {
      extractedFields.push({
        key: 'hbl_number',
        label: 'HBL Number',
        value: doc.hbl_number,
        category: 'identifier',
      });
    }
    if (doc.container_numbers && doc.container_numbers.length > 0) {
      extractedFields.push({
        key: 'container_numbers',
        label: 'Containers',
        value: doc.container_numbers.join(', '),
        category: 'identifier',
      });
    }

    // Parties
    if (doc.shipper_name) {
      extractedFields.push({
        key: 'shipper_name',
        label: 'Shipper',
        value: doc.shipper_name,
        category: 'party',
      });
    }
    if (doc.consignee_name) {
      extractedFields.push({
        key: 'consignee_name',
        label: 'Consignee',
        value: doc.consignee_name,
        category: 'party',
      });
    }
    if (doc.notify_party_name) {
      extractedFields.push({
        key: 'notify_party_name',
        label: 'Notify Party',
        value: doc.notify_party_name,
        category: 'party',
      });
    }

    // Locations
    if (doc.pol_location) {
      extractedFields.push({
        key: 'pol',
        label: 'Port of Loading',
        value: doc.pol_location,
        category: 'location',
      });
    }
    if (doc.pod_location) {
      extractedFields.push({
        key: 'pod',
        label: 'Port of Discharge',
        value: doc.pod_location,
        category: 'location',
      });
    }

    // Dates
    if (doc.etd) {
      extractedFields.push({
        key: 'etd',
        label: 'ETD',
        value: doc.etd,
        category: 'date',
      });
    }
    if (doc.eta) {
      extractedFields.push({
        key: 'eta',
        label: 'ETA',
        value: doc.eta,
        category: 'date',
      });
    }
    if (doc.si_cutoff) {
      extractedFields.push({
        key: 'si_cutoff',
        label: 'SI Cutoff',
        value: doc.si_cutoff,
        category: 'date',
      });
    }
    if (doc.vgm_cutoff) {
      extractedFields.push({
        key: 'vgm_cutoff',
        label: 'VGM Cutoff',
        value: doc.vgm_cutoff,
        category: 'date',
      });
    }
    if (doc.cargo_cutoff) {
      extractedFields.push({
        key: 'cargo_cutoff',
        label: 'Cargo Cutoff',
        value: doc.cargo_cutoff,
        category: 'date',
      });
    }

    // Cargo
    if (doc.vessel_name) {
      extractedFields.push({
        key: 'vessel_name',
        label: 'Vessel',
        value: doc.vessel_name + (doc.voyage_number ? ` / ${doc.voyage_number}` : ''),
        category: 'cargo',
      });
    }
    if (doc.commodity) {
      extractedFields.push({
        key: 'commodity',
        label: 'Commodity',
        value: doc.commodity,
        category: 'cargo',
      });
    }

    // Build attachments
    const attachments = Array.isArray(doc.attachments)
      ? doc.attachments.map((att: { filename?: string; mimeType?: string; size?: number; attachmentId?: string }, idx: number) => ({
          id: `${id}-att-${idx}`,
          filename: att.filename || `Attachment ${idx + 1}`,
          mimeType: att.mimeType || 'application/octet-stream',
          size: att.size || 0,
          hasOcr: true,
          attachmentId: att.attachmentId, // Gmail attachment ID for fetching content
        }))
      : [];

    // Build response
    const documentDetail: DocumentDetail = {
      id: doc.id,
      gmailMessageId: doc.gmail_message_id,
      threadId: doc.thread_id,
      subject: doc.subject || '',
      sender: {
        email: doc.from_address || '',
        party: PARTY_TYPE_LABELS[doc.from_party] || doc.from_party || 'Unknown',
      },
      receivedAt: doc.occurred_at,
      documentType: getDocumentTypeLabel(doc.document_type || 'unknown'),
      messageType: doc.message_type || 'unknown',
      sentiment: doc.sentiment || 'neutral',
      summary: doc.summary || '',
      bodyPreview: doc.body_preview || doc.snippet || '',
      extractedFields,
      action: doc.has_action
        ? {
            description: doc.action_description || '',
            owner: doc.action_owner,
            deadline: doc.action_deadline,
            priority: doc.action_priority || 'medium',
            completed: !!doc.action_completed_at,
          }
        : null,
      issue: doc.has_issue
        ? {
            type: doc.issue_type || 'unknown',
            description: doc.issue_description || '',
          }
        : null,
      attachments,
      shipment: doc.shipment_id
        ? {
            id: doc.shipment_id,
            bookingNumber: doc.booking_number,
          }
        : null,
      previousDocId,
      nextDocId,
    };

    return NextResponse.json({
      document: documentDetail,
    } as DocumentDetailResponse);
  } catch (error) {
    console.error('Error fetching document:', error);
    return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 });
  }
}
