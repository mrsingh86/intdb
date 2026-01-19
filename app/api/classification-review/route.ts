import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

/**
 * GET /api/classification-review
 *
 * List records flagged for classification review.
 * Supports pagination and filtering.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const searchParams = request.nextUrl.searchParams;

    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const status = searchParams.get('status') || 'pending';
    const documentType = searchParams.get('documentType');

    const offset = (page - 1) * pageSize;

    // Build query
    let query = supabase
      .from('chronicle')
      .select('id, subject, document_type, summary, from_party, from_address, occurred_at, review_status, review_reason, original_document_type', { count: 'exact' })
      .eq('needs_review', true)
      .order('occurred_at', { ascending: false })
      .range(offset, offset + pageSize - 1);

    // Filter by review status
    if (status === 'pending') {
      query = query.or('review_status.is.null,review_status.eq.pending');
    } else if (status !== 'all') {
      query = query.eq('review_status', status);
    }

    // Filter by document type
    if (documentType && documentType !== 'all') {
      query = query.eq('document_type', documentType);
    }

    const { data: records, count, error } = await query;

    if (error) {
      console.error('[classification-review] Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get stats
    const { data: statsData } = await supabase
      .from('chronicle')
      .select('review_status')
      .eq('needs_review', true);

    const stats = {
      total: statsData?.length || 0,
      pending: statsData?.filter(r => !r.review_status || r.review_status === 'pending').length || 0,
      reviewed: statsData?.filter(r => r.review_status === 'reviewed').length || 0,
      skipped: statsData?.filter(r => r.review_status === 'skipped').length || 0,
    };

    return NextResponse.json({
      records: records || [],
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
      stats,
    });
  } catch (error) {
    console.error('[classification-review] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/classification-review
 *
 * Update a record's classification.
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = createClient();
    const body = await request.json();

    const { id, action, newDocumentType } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing record ID' }, { status: 400 });
    }

    if (action === 'skip') {
      // Skip this record
      const { error } = await supabase
        .from('chronicle')
        .update({
          needs_review: false,
          review_status: 'skipped',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, action: 'skipped' });
    }

    if (action === 'review' && newDocumentType) {
      // Get current document type for audit trail
      const { data: current } = await supabase
        .from('chronicle')
        .select('document_type')
        .eq('id', id)
        .single();

      const originalType = current?.document_type;

      // Update with new classification
      const { error } = await supabase
        .from('chronicle')
        .update({
          document_type: newDocumentType,
          original_document_type: originalType !== newDocumentType ? originalType : null,
          needs_review: false,
          review_status: 'reviewed',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        action: 'reviewed',
        changed: originalType !== newDocumentType,
        from: originalType,
        to: newDocumentType,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[classification-review] PUT Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
