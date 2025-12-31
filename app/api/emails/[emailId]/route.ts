import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/emails/[emailId]
 *
 * Get email details with classification and extracted entities.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ emailId: string }>);
    const { emailId } = resolvedParams;
    const supabase = createClient();

    // Fetch email
    const { data: email, error: emailError } = await supabase
      .from('raw_emails')
      .select('*')
      .eq('id', emailId)
      .single();

    if (emailError || !email) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      );
    }

    // Fetch classification
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('*')
      .eq('email_id', emailId)
      .single();

    // Fetch extracted entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('*')
      .eq('email_id', emailId);

    // Fetch linked shipment if any
    const { data: shipmentDoc } = await supabase
      .from('shipment_documents')
      .select('shipment_id, document_type')
      .eq('email_id', emailId)
      .single();

    let linkedShipment = null;
    if (shipmentDoc?.shipment_id) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id, booking_number, bl_number, status')
        .eq('id', shipmentDoc.shipment_id)
        .single();
      linkedShipment = shipment;
    }

    // Fetch attachments info
    const { data: attachments } = await supabase
      .from('email_attachments')
      .select('id, filename, mime_type, size_bytes, storage_path')
      .eq('email_id', emailId);

    return NextResponse.json({
      email,
      classification,
      entities: entities || [],
      linkedShipment,
      documentType: shipmentDoc?.document_type,
      attachments: attachments || [],
    });
  } catch (error: any) {
    console.error('[API:GET /emails/[emailId]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
