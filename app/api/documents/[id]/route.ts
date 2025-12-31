import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { DocumentLifecycleRepository } from '@/lib/repositories/document-lifecycle-repository';
import { DocumentLifecycleService } from '@/lib/services/document-lifecycle-service';
import { DocumentLifecycleStatus } from '@/types/intelligence-platform';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/documents/[id]
 *
 * Get a specific document lifecycle with related data.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const repository = new DocumentLifecycleRepository(supabase);

    const lifecycle = await repository.findLifecycleById(id);

    if (!lifecycle) {
      return NextResponse.json(
        { error: 'Document lifecycle not found' },
        { status: 404 }
      );
    }

    // Get related comparisons and alerts
    const [comparisons, alerts, shipmentDocs] = await Promise.all([
      repository.findAllComparisons({ shipmentId: lifecycle.shipment_id }),
      repository.findAllAlerts({ shipmentId: lifecycle.shipment_id }),
      // Get shipment documents for this type (may have multiple emails)
      supabase
        .from('shipment_documents')
        .select('id, classification_id, email_id, document_number, document_date')
        .eq('shipment_id', lifecycle.shipment_id)
        .eq('document_type', lifecycle.document_type)
        .order('created_at', { ascending: false }),
    ]);

    const shipmentDoc = shipmentDocs.data?.[0] || null;
    const allEmailIds = shipmentDocs.data?.map(d => d.email_id).filter(Boolean) || [];

    // Get extracted entities via multiple methods
    let documentEntities: Array<{
      entity_type: string;
      entity_value: string;
      entity_normalized: string | null;
      confidence_score: number;
    }> = [];

    // Method 1: Try via email_id from shipment_documents
    if (allEmailIds.length > 0) {
      const { data: emailEntities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value, entity_normalized, confidence_score')
        .in('email_id', allEmailIds)
        .order('entity_type');

      if (emailEntities && emailEntities.length > 0) {
        documentEntities = emailEntities;
      }
    }

    // Method 2: Try via classification_id
    if (documentEntities.length === 0 && shipmentDoc?.classification_id) {
      const { data: classificationEntities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value, entity_normalized, confidence_score')
        .eq('classification_id', shipmentDoc.classification_id)
        .order('entity_type');

      if (classificationEntities && classificationEntities.length > 0) {
        documentEntities = classificationEntities;
      }
    }

    // Method 3: Try via source_document_type
    if (documentEntities.length === 0) {
      const { data: typeEntities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value, entity_normalized, confidence_score')
        .eq('source_document_type', lifecycle.document_type)
        .limit(50)
        .order('entity_type');

      if (typeEntities && typeEntities.length > 0) {
        documentEntities = typeEntities;
      }
    }

    // Get the source email for context
    let sourceEmail = null;
    if (shipmentDoc?.email_id) {
      const { data: email } = await supabase
        .from('raw_emails')
        .select('id, subject, sender_email, received_at, snippet')
        .eq('id', shipmentDoc.email_id)
        .single();
      sourceEmail = email;
    }

    // Group entities by type for easier display
    const extractedData: Record<string, { value: string; normalized?: string; confidence: number }[]> = {};
    for (const entity of documentEntities) {
      const type = entity.entity_type;
      if (!extractedData[type]) {
        extractedData[type] = [];
      }
      extractedData[type].push({
        value: entity.entity_value,
        normalized: entity.entity_normalized ?? undefined,
        confidence: entity.confidence_score,
      });
    }

    return NextResponse.json({
      lifecycle,
      comparisons: comparisons.data.filter(
        c =>
          c.source_document_type === lifecycle.document_type ||
          c.target_document_type === lifecycle.document_type
      ),
      alerts: alerts.data.filter(
        a => a.document_type === lifecycle.document_type
      ),
      extractedData,
      sourceEmail,
      documentDetails: shipmentDoc,
    });
  } catch (error) {
    console.error('[API:GET /documents/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/documents/[id]
 *
 * Update a document lifecycle (status transition, quality score, etc.).
 * Requires authentication.
 */
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const repository = new DocumentLifecycleRepository(supabase);
    const service = new DocumentLifecycleService(supabase);

    const body = await request.json();

    // Check if lifecycle exists
    const existing = await repository.findLifecycleById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Document lifecycle not found' },
        { status: 404 }
      );
    }

    // Handle status transition
    if (body.lifecycle_status) {
      const result = await service.transitionStatus(
        id,
        body.lifecycle_status as DocumentLifecycleStatus,
        body.changed_by || 'user'
      );

      if (!result.success) {
        return NextResponse.json(
          { error: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({ lifecycle: result.lifecycle });
    }

    // Handle quality score update
    if (body.extracted_fields) {
      const updated = await service.updateQualityScore(id, body.extracted_fields);
      return NextResponse.json({ lifecycle: updated });
    }

    // General update
    const updated = await repository.updateLifecycle(id, {
      due_date: body.due_date,
      current_revision_id: body.current_revision_id,
    });

    return NextResponse.json({ lifecycle: updated });
  } catch (error) {
    console.error('[API:PATCH /documents/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/documents/[id]
 *
 * Perform actions on a document lifecycle.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const service = new DocumentLifecycleService(supabase);
    const repository = new DocumentLifecycleRepository(supabase);

    const body = await request.json();
    const action = body.action;

    // Verify document exists
    const existing = await repository.findLifecycleById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Document lifecycle not found' },
        { status: 404 }
      );
    }

    switch (action) {
      case 'approve':
        const approveResult = await service.transitionStatus(id, 'approved', body.approved_by || 'user');
        if (!approveResult.success) {
          return NextResponse.json({ error: approveResult.error }, { status: 400 });
        }
        return NextResponse.json({ lifecycle: approveResult.lifecycle });

      case 'send':
        const sendResult = await service.transitionStatus(id, 'sent', body.sent_by || 'user');
        if (!sendResult.success) {
          return NextResponse.json({ error: sendResult.error }, { status: 400 });
        }
        return NextResponse.json({ lifecycle: sendResult.lifecycle });

      case 'supersede':
        const supersedeResult = await service.transitionStatus(id, 'superseded', 'system');
        if (!supersedeResult.success) {
          return NextResponse.json({ error: supersedeResult.error }, { status: 400 });
        }
        return NextResponse.json({ lifecycle: supersedeResult.lifecycle });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[API:POST /documents/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
