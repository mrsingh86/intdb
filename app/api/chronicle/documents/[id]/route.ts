import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get chronicle document
    const { data: chronicle, error: chronicleError } = await supabase
      .from('chronicle')
      .select(`
        id,
        gmail_message_id,
        thread_id,
        subject,
        from_address,
        from_party,
        occurred_at,
        document_type,
        message_type,
        carrier_name,
        ai_confidence,
        ai_response,
        summary,
        body_preview,
        snippet,
        has_action,
        action_description,
        action_owner,
        action_deadline,
        action_priority,
        has_issue,
        issue_type,
        issue_description,
        attachments,
        shipment_id,
        booking_number,
        mbl_number,
        hbl_number,
        vessel_name,
        voyage_number,
        etd,
        eta,
        pol_location,
        pod_location,
        shipper_name,
        consignee_name,
        created_at
      `)
      .eq('id', id)
      .single();

    if (chronicleError) {
      if (chronicleError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      throw chronicleError;
    }

    // Get linked shipment if exists
    let linkedShipment = null;
    if (chronicle.shipment_id) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id, booking_number, bl_number, stage, vessel_name')
        .eq('id', chronicle.shipment_id)
        .single();
      linkedShipment = shipment;
    }

    // Get related documents in same thread
    const { data: relatedDocs } = await supabase
      .from('chronicle')
      .select('id, subject, document_type, occurred_at, ai_confidence')
      .eq('thread_id', chronicle.thread_id)
      .neq('id', id)
      .order('occurred_at', { ascending: true })
      .limit(10);

    // Build extraction display from ai_response
    const extractedFields = buildExtractedFields(chronicle);

    // Parse attachments
    const attachments = parseAttachments(chronicle.attachments);

    // Transform response
    const response = {
      chronicle: {
        id: chronicle.id,
        messageId: chronicle.gmail_message_id,
        threadId: chronicle.thread_id,
        subject: chronicle.subject,
        sender: {
          email: chronicle.from_address,
          name: chronicle.from_party,
        },
        receivedAt: chronicle.occurred_at,
        documentType: chronicle.document_type,
        messageType: chronicle.message_type,
        carrier: chronicle.carrier_name,
        classification: {
          type: chronicle.document_type,
          confidence: chronicle.ai_confidence || 85,
          reasoning: chronicle.summary,
        },
        extraction: {
          data: chronicle.ai_response,
          confidence: chronicle.ai_confidence,
          fields: extractedFields,
        },
        processing: {
          status: 'processed',
          error: null,
        },
        content: {
          bodyText: chronicle.body_preview || chronicle.snippet,
          bodyHtml: null,
          hasAttachments: attachments.length > 0,
          attachmentCount: attachments.length,
        },
        action: chronicle.has_action ? {
          description: chronicle.action_description,
          owner: chronicle.action_owner,
          deadline: chronicle.action_deadline,
          priority: chronicle.action_priority,
        } : null,
        issue: chronicle.has_issue ? {
          type: chronicle.issue_type,
          description: chronicle.issue_description,
        } : null,
        createdAt: chronicle.created_at,
      },
      linkedShipment: linkedShipment ? {
        id: linkedShipment.id,
        bookingNumber: linkedShipment.booking_number || linkedShipment.bl_number,
        blNumber: linkedShipment.bl_number,
        phase: linkedShipment.stage,
        vessel: linkedShipment.vessel_name,
      } : null,
      attachments,
      relatedDocuments: relatedDocs?.map(d => ({
        id: d.id,
        subject: d.subject,
        documentType: d.document_type,
        receivedAt: d.occurred_at,
        confidence: d.ai_confidence || 85,
      })) || [],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching chronicle document:', error);
    return NextResponse.json({ error: 'Failed to fetch document' }, { status: 500 });
  }
}

interface ExtractedField {
  key: string;
  label: string;
  value: string | number | null;
  category: 'identifier' | 'party' | 'location' | 'date' | 'cargo' | 'financial' | 'other';
}

function buildExtractedFields(chronicle: Record<string, unknown>): ExtractedField[] {
  const fields: ExtractedField[] = [];

  const fieldConfig: Record<string, { label: string; category: ExtractedField['category'] }> = {
    booking_number: { label: 'Booking Number', category: 'identifier' },
    mbl_number: { label: 'MBL Number', category: 'identifier' },
    hbl_number: { label: 'HBL Number', category: 'identifier' },
    container_numbers: { label: 'Container Numbers', category: 'identifier' },
    shipper_name: { label: 'Shipper', category: 'party' },
    consignee_name: { label: 'Consignee', category: 'party' },
    vessel_name: { label: 'Vessel', category: 'other' },
    voyage_number: { label: 'Voyage', category: 'other' },
    pol_location: { label: 'Port of Loading', category: 'location' },
    pod_location: { label: 'Port of Discharge', category: 'location' },
    etd: { label: 'ETD', category: 'date' },
    eta: { label: 'ETA', category: 'date' },
    si_cutoff: { label: 'SI Cutoff', category: 'date' },
    vgm_cutoff: { label: 'VGM Cutoff', category: 'date' },
    cargo_cutoff: { label: 'Cargo Cutoff', category: 'date' },
    commodity: { label: 'Commodity', category: 'cargo' },
    weight: { label: 'Weight', category: 'cargo' },
    pieces: { label: 'Pieces', category: 'cargo' },
    amount: { label: 'Amount', category: 'financial' },
    currency: { label: 'Currency', category: 'financial' },
    invoice_number: { label: 'Invoice Number', category: 'identifier' },
  };

  // Extract from chronicle direct fields
  for (const [key, config] of Object.entries(fieldConfig)) {
    const value = chronicle[key];
    if (value !== null && value !== undefined && value !== '') {
      fields.push({
        key,
        label: config.label,
        value: Array.isArray(value) ? value.join(', ') : String(value),
        category: config.category,
      });
    }
  }

  // Extract from ai_response if present
  const aiResponse = chronicle.ai_response as Record<string, unknown> | null;
  if (aiResponse && typeof aiResponse === 'object') {
    for (const [key, value] of Object.entries(aiResponse)) {
      if (value === null || value === undefined || value === '') continue;
      if (fieldConfig[key]) continue; // Already added from direct fields

      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if (typeof value === 'string' || typeof value === 'number') {
        fields.push({
          key,
          label,
          value: value,
          category: 'other',
        });
      }
    }
  }

  // Sort by category
  const categoryOrder = ['identifier', 'party', 'location', 'date', 'cargo', 'financial', 'other'];
  fields.sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));

  return fields;
}

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  hasOcr: boolean;
  ocrText?: string;
  extractedData?: Record<string, unknown>;
}

function parseAttachments(attachments: unknown): Attachment[] {
  if (!attachments || !Array.isArray(attachments)) return [];

  return attachments.map((att, index) => ({
    id: att.id || `att-${index}`,
    filename: att.filename || att.name || 'Unknown',
    mimeType: att.mimeType || att.mime_type || 'application/octet-stream',
    size: att.size || att.size_bytes || 0,
    hasOcr: !!att.ocr_text,
    ocrText: att.ocr_text,
    extractedData: att.extracted_data,
  }));
}
