/**
 * Single Email Extraction API Route
 *
 * POST /api/extraction/[emailId] - Extract data from specific email
 * GET /api/extraction/[emailId] - Get extraction results for email
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EmailIngestionService } from '@/lib/services/email-ingestion-service';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface RouteParams {
  params: Promise<{
    emailId: string;
  }>;
}

/**
 * POST /api/extraction/[emailId]
 * Extract shipment data from a specific email
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const supabase = getSupabase();

  try {
    const { emailId } = await params;

    // Initialize service
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { reprocess = false, useAdvanced = false } = body;

    const ingestionService = new EmailIngestionService(
      supabase,
      anthropicKey,
      { useAdvancedModel: useAdvanced }
    );

    // Process the email
    const result = await ingestionService.ingestEmail(emailId, {
      forceReprocess: reprocess,
      useAdvancedModel: useAdvanced
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          emailId,
          error: result.error
        },
        { status: result.error === 'Email not found' ? 404 : 500 }
      );
    }

    return NextResponse.json({
      success: true,
      emailId,
      classification: result.classification,
      entities: result.entities,
      shipmentId: result.shipmentId,
      shipmentAction: result.shipmentAction,
      fieldsExtracted: result.fieldsExtracted,
      processingTime: result.processingTime
    });

  } catch (error: any) {
    console.error('[API:POST /extraction/:emailId] Error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/extraction/[emailId]
 * Get extraction results for a specific email
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const supabase = getSupabase();

  try {
    const { emailId } = await params;

    // Get email with classification
    const { data: email, error: emailError } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, received_at, processing_status')
      .eq('id', emailId)
      .single();

    if (emailError || !email) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      );
    }

    // Get classification
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('*')
      .eq('email_id', emailId)
      .limit(1);

    // Get entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('*')
      .eq('email_id', emailId)
      .order('entity_type');

    // Get linked shipment
    const { data: shipmentDocs } = await supabase
      .from('shipment_documents')
      .select('shipment_id, shipments(id, booking_number, bl_number, status)')
      .eq('email_id', emailId)
      .limit(1);

    return NextResponse.json({
      email: {
        id: email.id,
        subject: email.subject,
        sender: email.sender_email,
        receivedAt: email.received_at,
        processingStatus: email.processing_status
      },
      classification: classifications?.[0] || null,
      entities: entities || [],
      entityCount: entities?.length || 0,
      shipment: shipmentDocs?.[0]?.shipments || null
    });

  } catch (error: any) {
    console.error('[API:GET /extraction/:emailId] Error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
