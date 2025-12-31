import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * POST /api/debug/backfill-lifecycle
 *
 * Backfills document_lifecycle from shipment_documents.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    // Get all shipment_documents
    const { data: shipmentDocs, error: fetchError } = await supabase
      .from('shipment_documents')
      .select('shipment_id, document_type, email_id, document_date, created_at')
      .order('created_at', { ascending: true });

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!shipmentDocs || shipmentDocs.length === 0) {
      return NextResponse.json({ message: 'No shipment_documents to process', created: 0 });
    }

    // Group by shipment_id + document_type to get unique combinations
    const uniqueDocs = new Map<string, (typeof shipmentDocs)[0]>();
    for (const doc of shipmentDocs) {
      const key = `${doc.shipment_id}:${doc.document_type}`;
      if (!uniqueDocs.has(key)) {
        uniqueDocs.set(key, doc);
      }
    }

    let created = 0;
    let skipped = 0;
    let errors: string[] = [];

    for (const [key, doc] of uniqueDocs) {
      // Check if already exists
      const { data: existing } = await supabase
        .from('document_lifecycle')
        .select('id')
        .eq('shipment_id', doc.shipment_id)
        .eq('document_type', doc.document_type)
        .single();

      if (existing) {
        skipped++;
        continue;
      }

      // Insert new lifecycle record
      const { error: insertError } = await supabase
        .from('document_lifecycle')
        .insert({
          shipment_id: doc.shipment_id,
          document_type: doc.document_type,
          lifecycle_status: 'draft',
          status_history: [{
            status: 'draft',
            changed_at: new Date().toISOString(),
            changed_by: 'system_backfill'
          }],
          quality_score: null,
          missing_fields: [],
          revision_count: 1,
          due_date: null
        });

      if (insertError) {
        errors.push(`${key}: ${insertError.message}`);
      } else {
        created++;
      }
    }

    // Get final count
    const { count } = await supabase
      .from('document_lifecycle')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      total_shipment_docs: shipmentDocs.length,
      unique_combinations: uniqueDocs.size,
      created,
      skipped,
      errors: errors.length,
      error_details: errors.slice(0, 10),
      total_lifecycle_records: count
    });

  } catch (error) {
    console.error('[API:POST /debug/backfill-lifecycle] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});

/**
 * GET /api/debug/backfill-lifecycle
 *
 * Check current counts.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    const { count: lifecycleCount } = await supabase
      .from('document_lifecycle')
      .select('*', { count: 'exact', head: true });

    const { count: shipmentDocsCount } = await supabase
      .from('shipment_documents')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      document_lifecycle_count: lifecycleCount,
      shipment_documents_count: shipmentDocsCount
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});
