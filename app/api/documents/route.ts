import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { DocumentLifecycleRepository } from '@/lib/repositories/document-lifecycle-repository';
import { DocumentLifecycleService } from '@/lib/services/document-lifecycle-service';
import { DocumentLifecycleStatus } from '@/types/intelligence-platform';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/documents
 *
 * List document lifecycles with filtering and pagination.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new DocumentLifecycleRepository(supabase);

    const searchParams = request.nextUrl.searchParams;

    // Parse filters
    const shipmentId = searchParams.get('shipment_id') || undefined;
    const documentType = searchParams.get('document_type') || undefined;
    const statusParam = searchParams.get('status');
    const lifecycleStatus = statusParam
      ? (statusParam.split(',') as DocumentLifecycleStatus[])
      : undefined;
    const hasMissingFields = searchParams.get('has_missing_fields') === 'true';
    const dueBefore = searchParams.get('due_before') || undefined;

    // Parse pagination
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const result = await repository.findAllLifecycles(
      {
        shipmentId,
        documentType,
        lifecycleStatus,
        hasMissingFields: hasMissingFields || undefined,
        dueBefore,
      },
      { page, limit }
    );

    return NextResponse.json({
      documents: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    console.error('[API:GET /documents] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/documents
 *
 * Create or update a document lifecycle.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const service = new DocumentLifecycleService(supabase);

    const body = await request.json();

    // Validate required fields
    if (!body.shipment_id || !body.document_type) {
      return NextResponse.json(
        { error: 'shipment_id and document_type are required' },
        { status: 400 }
      );
    }

    const lifecycle = await service.createLifecycleForDocument(
      body.shipment_id,
      body.document_type,
      {
        extractedFields: body.extracted_fields,
        revisionId: body.revision_id,
        receivedAt: body.received_at,
        dueDate: body.due_date,
      }
    );

    return NextResponse.json({ lifecycle }, { status: 201 });
  } catch (error) {
    console.error('[API:POST /documents] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
