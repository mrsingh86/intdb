import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/debug/entities
 *
 * Debug endpoint to check entity extractions data.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    // Check entity_extractions count and sample
    const { data: entities, error: eeError, count: eeCount } = await supabase
      .from('entity_extractions')
      .select('*', { count: 'exact' })
      .limit(10);

    // Check shipment_documents
    const { data: shipmentDocs, error: sdError, count: sdCount } = await supabase
      .from('shipment_documents')
      .select('*', { count: 'exact' })
      .limit(10);

    // Check document_classifications with sample
    const { data: classifications, error: dcError } = await supabase
      .from('document_classifications')
      .select('id, email_id, document_type, confidence_score')
      .limit(10);

    // Get unique entity types
    const { data: entityTypes } = await supabase
      .from('entity_extractions')
      .select('entity_type')
      .limit(100);

    const uniqueTypes = [...new Set(entityTypes?.map(e => e.entity_type) || [])];

    // Get unique source_document_types
    const { data: sourceTypes } = await supabase
      .from('entity_extractions')
      .select('source_document_type')
      .not('source_document_type', 'is', null)
      .limit(100);

    const uniqueSourceTypes = [...new Set(sourceTypes?.map(e => e.source_document_type) || [])];

    return NextResponse.json({
      entity_extractions: {
        count: eeCount,
        error: eeError?.message,
        sample: entities?.slice(0, 3),
        uniqueEntityTypes: uniqueTypes,
        uniqueSourceDocTypes: uniqueSourceTypes,
      },
      shipment_documents: {
        count: sdCount,
        error: sdError?.message,
        sample: shipmentDocs?.slice(0, 3),
      },
      document_classifications: {
        error: dcError?.message,
        sample: classifications?.slice(0, 5),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});
