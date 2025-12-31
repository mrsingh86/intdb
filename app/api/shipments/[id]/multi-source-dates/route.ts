import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/multi-source-dates
 *
 * Get ETD/ETA values from multiple document sources for conflict detection.
 * Returns date values grouped by source document type with confidence scores.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();

    // Get all linked documents for this shipment with their entity extractions
    const { data: shipmentDocs, error: docsError } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type, link_confidence_score')
      .eq('shipment_id', id);

    if (docsError) {
      throw new Error(`Failed to fetch shipment documents: ${docsError.message}`);
    }

    if (!shipmentDocs || shipmentDocs.length === 0) {
      return NextResponse.json({
        etd_sources: [],
        eta_sources: [],
        hasEtdConflict: false,
        hasEtaConflict: false,
      });
    }

    const emailIds = shipmentDocs.map(d => d.email_id).filter(Boolean);

    // Fetch entity extractions for ETD, ETA, and Cutoffs
    const { data: entities, error: entitiesError } = await supabase
      .from('entity_extractions')
      .select(`
        entity_type,
        entity_value,
        confidence_score,
        source_document_type,
        email_id,
        created_at
      `)
      .in('email_id', emailIds)
      .in('entity_type', ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff']);

    if (entitiesError) {
      throw new Error(`Failed to fetch entities: ${entitiesError.message}`);
    }

    // Get email subjects for context
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject')
      .in('id', emailIds);

    const emailSubjectMap = new Map(emails?.map(e => [e.id, e.subject]) || []);
    const docTypeMap = new Map(shipmentDocs.map(d => [d.email_id, d.document_type]));

    // Group by entity type
    const etdSources = (entities || [])
      .filter(e => e.entity_type === 'etd')
      .map(e => ({
        documentType: e.source_document_type || docTypeMap.get(e.email_id) || 'unknown',
        value: e.entity_value,
        extractedAt: e.created_at,
        emailSubject: emailSubjectMap.get(e.email_id),
        confidence: e.confidence_score,
      }));

    const etaSources = (entities || [])
      .filter(e => e.entity_type === 'eta')
      .map(e => ({
        documentType: e.source_document_type || docTypeMap.get(e.email_id) || 'unknown',
        value: e.entity_value,
        extractedAt: e.created_at,
        emailSubject: emailSubjectMap.get(e.email_id),
        confidence: e.confidence_score,
      }));

    // Detect conflicts
    const hasEtdConflict = detectConflict(etdSources.map(s => s.value));
    const hasEtaConflict = detectConflict(etaSources.map(s => s.value));

    return NextResponse.json({
      etd_sources: etdSources,
      eta_sources: etaSources,
      hasEtdConflict,
      hasEtaConflict,
    });
  } catch (error: any) {
    console.error('[API:GET /shipments/[id]/multi-source-dates] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

function detectConflict(dates: string[]): boolean {
  if (dates.length < 2) return false;

  const normalizedDates = dates.map(d => {
    try {
      return new Date(d).toDateString();
    } catch {
      return d;
    }
  });

  const uniqueDates = new Set(normalizedDates);
  return uniqueDates.size > 1;
}
